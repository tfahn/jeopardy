const socket = io({ query: { role: 'player' } });
const app = document.getElementById('app');
let state = null;
let playerName = localStorage.getItem('jeopardy-name') || '';
let joinedTeamId = null;
let hasBuzzed = false;
let buzzerLocked = false;
let isEliminated = false;
let playerMap = null;
let playerMarker = null;
let chatSent = false;
let chatRevealedMessage = null;

let teamMessages = [];
let chatOpen = false;
let unreadCount = 0;

socket.on('connect', () => socket.emit('register', 'player'));

socket.on('team-msg-history', msgs => { teamMessages = msgs; renderTeamChat(); });
socket.on('team-msg-new', entry => {
  teamMessages.push(entry);
  if (!chatOpen) unreadCount++;
  renderTeamChat();
});

socket.on('state', s => {
  const questionChanged = !state || state.phase !== s.phase ||
    state.currentQuestion?.row !== s.currentQuestion?.row ||
    state.currentQuestion?.col !== s.currentQuestion?.col;
  state = s;
  if (questionChanged) {
    hasBuzzed = false;
    buzzerLocked = false;
    isEliminated = false;
    chatSent = false;
    chatRevealedMessage = null;
  }
  buzzerLocked = s.buzzerLocked || false;
  if (s.chatRevealed && s.teamChatMessage) {
    chatRevealedMessage = s.teamChatMessage.message;
  }
  render();
});

socket.on('buzzer-locked', () => { buzzerLocked = true; updateBuzzerUI(); });
socket.on('buzzer-unlocked', data => {
  buzzerLocked = false;
  if (data.buzzerOut) isEliminated = data.buzzerOut.includes(socket.id);
  hasBuzzed = false;
  updateBuzzerUI();
});

function updateBuzzerUI() {
  const btn = document.querySelector('.buzz-btn');
  if (!btn) return;
  if (isEliminated) {
    btn.classList.add('buzzed'); btn.textContent = 'GESPERRT'; btn.disabled = true;
  } else if (buzzerLocked) {
    btn.classList.add('buzzed'); btn.textContent = 'GESPERRT'; btn.disabled = true;
  } else {
    btn.classList.remove('buzzed'); btn.textContent = 'BUZZ!'; btn.disabled = false;
    hasBuzzed = false;
  }
}

// ---- Timer ----
let playerTimerInterval = null;
socket.on('start-timer', seconds => {
  clearInterval(playerTimerInterval);
  let remaining = seconds;
  showPlayerTimer(remaining);
  playerTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(playerTimerInterval); removePlayerTimer(); return; }
    showPlayerTimer(remaining);
  }, 1000);
});
socket.on('stop-timer', () => { clearInterval(playerTimerInterval); removePlayerTimer(); });
function showPlayerTimer(sec) {
  let el = document.getElementById('player-timer');
  if (!el) { el = document.createElement('div'); el.id = 'player-timer'; document.body.appendChild(el); }
  el.className = 'timer-display timer-player';
  el.textContent = sec;
  if (sec <= 5) el.classList.add('timer-urgent');
}
function removePlayerTimer() { document.getElementById('player-timer')?.remove(); }

function render() {
  if (!state) return;
  // Preserve name input before re-render
  const nameInput = document.getElementById('name-input');
  if (nameInput) playerName = nameInput.value;
  if (state.phase === 'lobby' || joinedTeamId === null) renderLobby();
  else if (state.phase === 'board') renderWaiting();
  else if (state.phase === 'question') renderQuestion();
}

// ==================== Lobby ====================
function renderLobby() {
  app.innerHTML = `
    <div class="player-header"><h1>JEOPARDY</h1></div>
    <div class="lobby-section">
      <div class="input-group">
        <label>Dein Name</label>
        <input type="text" id="name-input" value="${esc(playerName)}" placeholder="Name eingeben...">
      </div>
      ${state.teams.length > 0 ? `
        <div class="input-group">
          <label>Team wählen (max. 2 pro Team)</label>
          <div class="team-buttons">
            ${state.teams.map(t => {
              const full = t.members.length >= 2;
              const joined = joinedTeamId === t.id;
              return `
                <button class="team-btn ${joined ? 'joined' : ''}"
                        style="background:${t.color};${full && !joined ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                        onclick="${full && !joined ? '' : `joinTeam(${t.id})`}" ${full && !joined ? 'disabled' : ''}>
                  ${esc(t.name)} (${t.members.map(m => m.name).join(', ') || 'leer'}) ${full && !joined ? '[VOLL]' : ''}
                </button>`;
            }).join('')}
          </div>
        </div>
      ` : '<div class="waiting-msg">Warte auf Host...</div>'}
    </div>`;
}

function joinTeam(teamId) {
  const nameInput = document.getElementById('name-input');
  playerName = nameInput ? nameInput.value.trim() : playerName;
  if (!playerName) { alert('Bitte gib einen Namen ein!'); return; }
  localStorage.setItem('jeopardy-name', playerName);
  joinedTeamId = teamId;
  socket.emit('join-team', { teamId, playerName });
}

// ==================== Waiting ====================
function renderWaiting() {
  const team = state.teams.find(t => t.id === joinedTeamId);
  const activeTeam = state.teams[state.currentTeamIndex];
  app.innerHTML = `
    <div class="player-header"><h1>JEOPARDY</h1></div>
    <div style="text-align:center;padding:20px;">
      <p style="color:var(--gray);">Du spielst als <b style="color:${team?.color || '#fff'};">${esc(playerName)}</b> in <b style="color:${team?.color || '#fff'};">${esc(team?.name)}</b></p>
      <div style="margin-top:40px;">
        <p style="font-size:20px;">${activeTeam ? `<b style="color:${activeTeam.color};">${esc(activeTeam.name)}</b> wählt eine Frage...` : 'Warte...'}</p>
      </div>
      <div style="margin-top:30px;">
        ${state.teams.map(t => `
          <div style="display:flex;justify-content:space-between;padding:8px 16px;margin:4px 0;border-radius:8px;background:rgba(255,255,255,0.05);">
            <span style="color:${t.color};">${esc(t.name)}</span>
            <span style="font-weight:800;color:var(--gold);">${t.score}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

// ==================== Question ====================
function renderQuestion() {
  if (!state.currentQuestion) return;
  const q = state.currentQuestion;
  const typeName = { buzzer: 'Buzzer', estimate: 'Schätzfrage', map: 'Karte', chat: 'Team-Chat', lineup: '7ineup' }[q.type];
  const contentHtml = q.type !== 'chat' ? renderContent(q.content) : '';
  const submitted = state.teamAnswer?.submitted;

  let interactionHtml = '';

  if (q.type === 'buzzer' || q.type === 'lineup') {
    const disabled = isEliminated || buzzerLocked;
    const label = isEliminated ? 'GESPERRT' : (buzzerLocked ? 'GESPERRT' : 'BUZZ!');
    interactionHtml = `
      <div class="buzzer-section">
        <button class="buzz-btn ${disabled ? 'buzzed' : ''}" onclick="buzz()" ${disabled ? 'disabled' : ''}>${label}</button>
        ${isEliminated ? '<p style="color:var(--red);margin-top:10px;">Du bist raus diese Runde</p>' : ''}
      </div>`;

  } else if (q.type === 'estimate') {
    if (!state.isAnswerer) {
      interactionHtml = renderPassiveView(submitted, state.teamAnswer?.value);
    } else {
      interactionHtml = `
        <div class="estimate-section">
          <input type="text" id="estimate-input" class="estimate-input" placeholder="Antwort eingeben..." ${submitted ? 'disabled' : ''}>
          <button class="submit-btn" onclick="submitEstimate()" ${submitted ? 'disabled' : ''}>${submitted ? 'Gesendet!' : 'Absenden'}</button>
          ${submitted ? `<p style="color:var(--green);margin-top:5px;">Antwort: <b>${esc(String(state.teamAnswer?.value))}</b></p>` : ''}
        </div>`;
    }

  } else if (q.type === 'map') {
    if (!state.isAnswerer) {
      interactionHtml = renderPassiveView(submitted, submitted ? 'Position abgegeben' : null);
    } else {
      interactionHtml = `
        <div class="estimate-section">
          <div class="player-map" id="player-map"></div>
          <button class="submit-btn" onclick="submitMapGuess()" id="map-submit-btn" ${submitted ? 'disabled' : ''}>${submitted ? 'Gesendet!' : 'Position bestätigen'}</button>
          ${submitted ? '<p style="color:var(--green);margin-top:5px;">Position abgegeben!</p>' : ''}
        </div>`;
    }

  } else if (q.type === 'chat') {
    interactionHtml = renderChatUI();
  }

  app.innerHTML = `
    <div class="question-info-player">
      <div class="cat">${esc(q.category)} — ${typeName}</div>
      <div class="pts">${q.points}</div>
      ${contentHtml ? `<div class="text">${contentHtml}</div>` : ''}
    </div>
    ${interactionHtml}`;

  if (q.type === 'map' && state.isAnswerer && !submitted) {
    setTimeout(() => initPlayerMap(), 100);
  }
}

function renderPassiveView(submitted, value) {
  if (submitted && value) {
    return `<div style="text-align:center;padding:30px;"><p style="color:var(--green);font-size:20px;">Antwort abgegeben!</p></div>`;
  }
  return `<div style="text-align:center;padding:30px;"><p style="color:var(--gray);font-size:18px;">Dein Teammate gibt die Antwort ein...</p></div>`;
}

function renderContent(content) {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map(b => {
    if (b.type === 'text') return b.text || '';
    return b.text || '';
  }).filter(Boolean).join('<br>');
}

// ==================== Chat UI ====================
function renderChatUI() {
  const role = state.chatRole;
  const q = state.currentQuestion;
  const chat = state.teamChatMessage;

  if (role === 'describer') {
    if (chat?.sent) {
      return `
        <div class="chat-section">
          <div class="chat-secret">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--gray);margin-bottom:4px;">Du beschreibst:</div>
            <div style="font-size:24px;font-weight:800;color:var(--gold);">${esc(q.secret || q.answer || '???')}</div>
          </div>
          <p style="color:var(--green);margin-top:15px;text-align:center;">Nachricht gesendet!</p>
          <div class="chat-bubble mine" style="margin-top:10px;">${esc(chat.message)}</div>
        </div>`;
    }
    return `
      <div class="chat-section">
        <div class="chat-secret">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--gray);margin-bottom:4px;">Du beschreibst:</div>
          <div style="font-size:24px;font-weight:800;color:var(--gold);">${esc(q.secret || q.answer || '???')}</div>
          ${q.content.text ? `<div style="margin-top:8px;color:var(--gray);font-size:14px;">${q.content.text}</div>` : ''}
        </div>
        <textarea id="chat-input" placeholder="Deine Nachricht eingeben..."
                  style="width:100%;min-height:100px;padding:12px;border-radius:12px;border:2px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:white;font-size:20px;resize:vertical;outline:none;margin-top:10px;"></textarea>
        <button class="submit-btn" onclick="sendChat()" style="width:100%;margin-top:8px;">Nachricht senden</button>
      </div>`;
  } else {
    if (chatRevealedMessage) {
      return `
        <div class="chat-section">
          ${q.content.text ? `<p style="text-align:center;color:var(--gray);margin-bottom:10px;">${q.content.text}</p>` : ''}
          <div class="chat-messages" style="align-items:center;justify-content:center;">
            <div class="chat-bubble other" style="font-size:28px;">${esc(chatRevealedMessage)}</div>
          </div>
          <p style="text-align:center;color:var(--gold);margin-top:15px;font-size:18px;">Was wird hier beschrieben? Antworte laut!</p>
        </div>`;
    }
    return `
      <div style="text-align:center;padding:40px;">
        <p style="font-size:20px;color:var(--gray);">Dein Teammate beschreibt dir gleich etwas...</p>
        <p style="font-size:16px;color:var(--gray);margin-top:10px;">Warte auf Freigabe vom Host</p>
      </div>`;
  }
}

// ==================== Actions ====================
function buzz() {
  if (hasBuzzed || isEliminated || buzzerLocked) return;
  hasBuzzed = true;
  socket.emit('buzz');
  updateBuzzerUI();
}

function submitEstimate() {
  const input = document.getElementById('estimate-input');
  if (!input || !input.value.trim()) return;
  socket.emit('submit-team-answer', input.value.trim());
}

function sendChat() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;
  socket.emit('chat-send', input.value.trim());
}

function initPlayerMap() {
  const el = document.getElementById('player-map');
  if (!el) return;
  if (playerMap) { playerMap.remove(); playerMap = null; playerMarker = null; }
  playerMap = L.map(el).setView([30, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CartoDB', maxZoom: 18,
  }).addTo(playerMap);
  playerMap.on('click', e => {
    if (state.teamAnswer?.submitted) return;
    if (playerMarker) playerMap.removeLayer(playerMarker);
    playerMarker = L.marker(e.latlng).addTo(playerMap);
  });
}

function submitMapGuess() {
  if (!playerMarker || state.teamAnswer?.submitted) return;
  const pos = playerMarker.getLatLng();
  socket.emit('submit-team-answer', { lat: pos.lat, lng: pos.lng });
}

// ==================== Team Chat Widget ====================
function renderTeamChat() {
  if (joinedTeamId === null) return;
  let widget = document.getElementById('team-chat-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.id = 'team-chat-widget';
    document.body.appendChild(widget);
  }

  if (!chatOpen) {
    widget.innerHTML = `
      <button class="tc-toggle" onclick="toggleChat()">
        💬${unreadCount > 0 ? `<span class="tc-badge">${unreadCount}</span>` : ''}
      </button>`;
    return;
  }

  const msgsHtml = teamMessages.map(m => {
    const mine = m.playerName === playerName;
    return `<div class="tc-msg ${mine ? 'tc-mine' : 'tc-other'}">
      ${!mine ? `<span class="tc-sender">${esc(m.playerName)}</span>` : ''}
      <span class="tc-text">${esc(m.message)}</span>
    </div>`;
  }).join('');

  widget.innerHTML = `
    <div class="tc-panel">
      <div class="tc-header">
        <span>Team-Chat</span>
        <button class="tc-close" onclick="toggleChat()">✕</button>
      </div>
      <div class="tc-messages" id="tc-messages">${msgsHtml}</div>
      <div class="tc-input-row">
        <input type="text" id="team-chat-input" placeholder="Nachricht..." onkeydown="if(event.key==='Enter')sendTeamMsg()">
        <button class="tc-send" onclick="sendTeamMsg()">↑</button>
      </div>
    </div>`;

  const msgBox = document.getElementById('tc-messages');
  if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
}

function toggleChat() {
  chatOpen = !chatOpen;
  if (chatOpen) unreadCount = 0;
  renderTeamChat();
  if (chatOpen) {
    setTimeout(() => {
      const input = document.getElementById('team-chat-input');
      if (input) input.focus();
      const msgBox = document.getElementById('tc-messages');
      if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
    }, 50);
  }
}

function sendTeamMsg() {
  const input = document.getElementById('team-chat-input');
  if (!input || !input.value.trim()) return;
  socket.emit('team-msg-send', input.value.trim());
  input.value = '';
  input.focus();
}

function esc(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
