const socket = io({ query: { role: 'host' } });
const app = document.getElementById('app');
let state = null;

let allTeamMessages = {};
let hostChatOpen = false;

socket.on('connect', () => socket.emit('register', 'host'));
socket.on('state', s => {
  const prevPhase = state?.phase;
  const prevQuestion = state?.currentQuestion;
  const phaseChanged = !state || prevPhase !== s.phase ||
    prevQuestion?.row !== s.currentQuestion?.row ||
    prevQuestion?.col !== s.currentQuestion?.col;
  state = s;
  if (phaseChanged) {
    render();
  } else if (s.phase === 'question') {
    // Update question panel without full page re-render
    renderQuestionControl();
  } else if (s.phase === 'board') {
    // Just update scores in board view
    document.querySelectorAll('.team-pts').forEach((el, i) => {
      if (state.teams[i]) el.textContent = state.teams[i].score;
    });
  }
  // Lobby always fully re-renders (shows player list changes)
  else if (s.phase === 'lobby') {
    render();
  }
});

socket.on('all-team-msgs', msgs => { allTeamMessages = msgs; renderHostChat(); });
socket.on('team-msg-new', entry => {
  if (!allTeamMessages[entry.teamId]) allTeamMessages[entry.teamId] = [];
  allTeamMessages[entry.teamId].push(entry);
  renderHostChat();
});

socket.on('buzzer-locked', data => {
  if (!state) return;
  if (!state.buzzes) state.buzzes = [];
  if (data.playerName) {
    state.buzzes.push(data);
    playBuzzerSound();
  }
  state.buzzerLocked = true;
  if (state.phase === 'question') renderQuestionControl();
});

// ---- Buzzer Sound (Web Audio API) ----
let audioCtx = null;
function playBuzzerSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.setValueAtTime(600, audioCtx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.3);
}
socket.on('buzzer-unlocked', () => {
  if (!state) return;
  state.buzzerLocked = false;
  if (state.phase === 'question') renderQuestionControl();
});

function render() {
  if (!state) return;
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'board') renderBoard();
  else if (state.phase === 'dailyDouble') renderDailyDoubleHost();
  else if (state.phase === 'question') renderQuestionControl();
  else if (state.phase === 'endscreen') renderEndscreenHost();
}

function renderEndscreenHost() {
  const sorted = [...state.teams].sort((a, b) => b.score - a.score);
  app.innerHTML = `
    <div class="host-header"><h1>JEOPARDY — Host</h1><span class="phase-badge" style="background:var(--gold);color:var(--bg);">SIEGEREHRUNG</span></div>
    <div class="host-grid">
      <div class="host-panel full-width">
        <h2 style="color:var(--gold);">Endergebnis</h2>
        ${sorted.map((t, i) => `
          <div style="display:flex;justify-content:space-between;padding:10px;margin:4px 0;border-radius:8px;background:rgba(255,255,255,0.05);">
            <span style="color:${t.color};font-weight:800;">${i+1}. ${esc(t.name)}</span>
            <span style="color:var(--gold);font-weight:900;">${t.score}P</span>
          </div>
        `).join('')}
        <button class="btn btn-red" style="margin-top:20px;width:100%;" onclick="resetGame()">Zurück zur Lobby</button>
      </div>
    </div>`;
}

function renderDailyDoubleHost() {
  if (!state.currentQuestion) return;
  const team = state.teams[state.dailyDoubleTeam];
  const q = state.currentQuestion;
  app.innerHTML = `
    <div class="host-header"><h1>JEOPARDY — Host</h1><span class="phase-badge" style="background:var(--gold);color:var(--bg);">DAILY DOUBLE</span></div>
    <div class="host-grid">
      <div class="host-panel">
        <h2 style="color:var(--gold);">Daily Double!</h2>
        <p>Kategorie: <b>${esc(q.category)}</b> — ${q.points}P</p>
        <p>Team: <b style="color:${team?.color || '#fff'};">${esc(team?.name)}</b> (Score: ${team?.score || 0})</p>
        <p style="margin-top:10px;color:var(--gray);">Warte auf Einsatz vom Team...</p>
        <div class="host-answer" style="margin-top:15px;"><b>Antwort:</b> ${esc(q.answer)}</div>
      </div>
    </div>`;
}

// ==================== LOBBY ====================
function renderLobby() {
  const hasTeams = state.teams.length > 0;
  app.innerHTML = `
    <div class="host-header"><h1>JEOPARDY — Host</h1><span class="phase-badge">Lobby</span></div>
    <div class="host-grid">
      <div class="host-panel">
        <h2>Teams einrichten (je 2 Spieler)</h2>
        <div class="host-team-setup" id="team-setup">
          ${hasTeams ? state.teams.map((t, i) => `
            <div class="host-team-row" data-idx="${i}">
              <input type="text" value="${esc(t.name)}" id="tn-${i}">
              <input type="color" value="${t.color}" id="tc-${i}">
              <button class="btn btn-red btn-sm" onclick="removeTeamRow(this)" style="padding:4px 8px;font-size:12px;">✕</button>
            </div>
          `).join('') : `
            <div class="host-team-row" data-idx="0"><input type="text" value="Team Rot" id="tn-0"><input type="color" value="#e74c3c" id="tc-0"><button class="btn btn-red btn-sm" onclick="removeTeamRow(this)" style="padding:4px 8px;font-size:12px;">✕</button></div>
            <div class="host-team-row" data-idx="1"><input type="text" value="Team Blau" id="tn-1"><input type="color" value="#3498db" id="tc-1"><button class="btn btn-red btn-sm" onclick="removeTeamRow(this)" style="padding:4px 8px;font-size:12px;">✕</button></div>
          `}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-blue btn-sm" onclick="addTeamRow()">+ Team</button>
          <button class="btn btn-gold" onclick="saveTeams()">Teams speichern</button>
        </div>
      </div>
      <div class="host-panel">
        <h2>Spieler</h2>
        ${state.teams.map(t => `
          <div style="margin-bottom:8px;">
            <b style="color:${t.color};">${esc(t.name)}</b>:
            ${t.members.length > 0 ? t.members.map(m => `${esc(m.name)} (P${m.index + 1})`).join(', ') : '<i style="color:var(--gray);">leer</i>'}
            <small style="color:var(--gray);">[${t.members.length}/2]</small>
          </div>
        `).join('') || '<p style="color:var(--gray);">Erst Teams einrichten</p>'}
        ${hasTeams && state.teams.some(t => t.members.length > 0) ? `
          <div style="margin-top:15px;">
            <label style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--gray);display:block;margin-bottom:6px;">Board auswählen</label>
            <select id="board-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#1a1a5e;color:white;font-size:14px;margin-bottom:8px;"></select>
            <button class="btn btn-green" style="width:100%;" onclick="startGame()">Spiel starten</button>
          </div>
        ` : ''}
      </div>
    </div>`;
  // Populate board selector after DOM is set
  const boardSelect = document.getElementById('board-select');
  if (boardSelect) {
    fetch('/api/boards').then(r => r.json()).then(files => {
      files.forEach(f => {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = f.replace('.json', '');
        o.style.background = '#1a1a5e';
        o.style.color = 'white';
        boardSelect.appendChild(o);
      });
    });
  }
}

function addTeamRow() {
  const container = document.getElementById('team-setup');
  const i = container.children.length;
  const colors = ['#e67e22', '#9b59b6', '#1abc9c', '#e91e63', '#795548'];
  const div = document.createElement('div');
  div.className = 'host-team-row';
  div.innerHTML = `<input type="text" value="Team ${i + 1}" id="tn-${i}"><input type="color" value="${colors[i % colors.length]}" id="tc-${i}"><button class="btn btn-red btn-sm" onclick="removeTeamRow(this)" style="padding:4px 8px;font-size:12px;">✕</button>`;
  container.appendChild(div);
}

function removeTeamRow(btn) {
  const row = btn.closest('.host-team-row');
  row.remove();
  // Re-index remaining rows
  document.querySelectorAll('.host-team-row').forEach((r, i) => {
    const nameInput = r.querySelector('input[type="text"]');
    const colorInput = r.querySelector('input[type="color"]');
    if (nameInput) nameInput.id = `tn-${i}`;
    if (colorInput) colorInput.id = `tc-${i}`;
  });
}

function saveTeams() {
  const rows = document.querySelectorAll('.host-team-row');
  const teams = [];
  rows.forEach((_, i) => {
    teams.push({
      name: document.getElementById(`tn-${i}`)?.value || `Team ${i + 1}`,
      color: document.getElementById(`tc-${i}`)?.value || '#ffffff',
    });
  });
  socket.emit('setup-teams', teams);
}

function startGame() {
  const sel = document.getElementById('board-select');
  const file = sel ? sel.value : 'board-1.json';
  socket.emit('start-game', file);
}

// ==================== BOARD ====================
function renderBoard() {
  const activeTeam = state.teams[state.currentTeamIndex];
  let boardHtml = '<div class="host-mini-board">';
  for (let c = 0; c < 5; c++) boardHtml += `<div class="mini-cell header">${esc(state.categories[c])}</div>`;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = state.board[r][c];
      boardHtml += `<div class="mini-cell ${cell.used ? 'used' : 'available'}" onclick="${cell.used ? '' : `selectQ(${r},${c})`}">${cell.used ? '—' : cell.points}</div>`;
    }
  }
  boardHtml += '</div>';

  app.innerHTML = `
    <div class="host-header"><h1>JEOPARDY — Host</h1><span class="phase-badge">Board</span></div>
    <div class="host-grid">
      <div class="host-panel full-width">
        <h2>Am Zug: <span style="color:${activeTeam?.color || '#fff'};">${esc(activeTeam?.name)}</span></h2>
        <div style="display:flex;gap:6px;margin-bottom:12px;">
          ${state.teams.map((t, i) => `<button class="btn btn-sm ${i === state.currentTeamIndex ? 'btn-gold' : 'btn-blue'}" onclick="setTurn(${i})">${esc(t.name)}</button>`).join('')}
        </div>
        ${boardHtml}
      </div>
      <div class="host-panel full-width">
        <h2>Punktestand</h2>
        <div class="host-scores">${scoreRows()}</div>
        <div style="display:flex;gap:8px;margin-top:15px;">
          <button class="btn btn-gold" style="flex:1;" onclick="endGame()">Siegerehrung</button>
          <button class="btn btn-red" style="flex:1;" onclick="resetGame()">Zurück zur Lobby</button>
        </div>
      </div>
    </div>`;
}

function scoreRows() {
  return state.teams.map(t => `
    <div class="host-score-row">
      <span class="team-name" style="color:${t.color};">${esc(t.name)}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-red btn-sm" onclick="pts(${t.id},-100)">-100</button>
        <span class="team-pts">${t.score}</span>
        <button class="btn btn-green btn-sm" onclick="pts(${t.id},100)">+100</button>
      </div>
    </div>`).join('');
}

function selectQ(r, c) { socket.emit('select-question', { row: r, col: c }); }
function setTurn(i) { socket.emit('set-turn', i); }
function pts(teamId, p) { socket.emit('award-points', { teamId, points: p }); }

// ==================== QUESTION ====================
function renderQuestionControl() {
  if (!state.currentQuestion) return;
  const q = state.currentQuestion;
  const typeName = { buzzer: 'Buzzer', estimate: 'Schätzfrage', map: 'Karte', chat: 'Team-Chat', lineup: '7ineup' }[q.type];
  const blocks = Array.isArray(q.content) ? q.content : [q.content];
  const contentPreview = blocks.map(b => b.text || `[${b.type}]`).join(' | ');

  // Type-specific panel
  let typePanel = '';
  if (q.type === 'buzzer') {
    typePanel = renderBuzzerPanel();
  } else if (q.type === 'lineup') {
    typePanel = renderLineupPanel();
  } else if (q.type === 'chat') {
    typePanel = renderChatPanel();
  } else {
    typePanel = renderAnswersPanel();
  }

  app.innerHTML = `
    <div class="host-header"><h1>JEOPARDY — Host</h1><span class="phase-badge">${typeName} — ${q.points}P</span></div>
    <div class="host-grid">
      <div class="host-panel">
        <h2>${esc(q.category)} — ${q.points} Punkte</h2>
        <p style="margin-bottom:10px;">${esc(contentPreview)}</p>
        <div class="host-answer"><b>Antwort:</b> ${esc(q.answer)}</div>
        ${q.secret ? `<p style="margin-top:6px;color:var(--gray);">Geheim: <b style="color:var(--gold);">${esc(q.secret)}</b></p>` : ''}
        ${q.target ? `<p style="margin-top:6px;color:var(--gray);">Ziel: ${q.target.lat.toFixed(2)}, ${q.target.lng.toFixed(2)}</p>` : ''}
        ${state.remainingQuestions <= 3 ? `<p style="margin-top:6px;color:var(--red);font-weight:800;">FINALE — ALLE PUNKTE ×2!</p>` : ''}
        ${state.activeJokers?.double !== null ? `<p style="margin-top:6px;color:var(--gold);font-weight:800;">DOPPEL-JOKER AKTIV! (${state.teams.find(t=>t.id===state.activeJokers.double)?.name})</p>` : ''}
        ${state.activeJokers?.blocked !== null ? `<p style="margin-top:6px;color:var(--red);font-weight:800;">${state.teams.find(t=>t.id===state.activeJokers.blocked)?.name} GEBLOCKT!</p>` : ''}
        ${state.dailyDoubleWager ? `<p style="margin-top:6px;color:var(--gold);font-weight:800;">DAILY DOUBLE — Einsatz: ${state.dailyDoubleWager}</p>` : ''}
        <div style="margin-top:8px;font-size:12px;color:var(--gray);">
          Joker: ${state.teams.map(t => {
            const j = state.jokers?.[t.id];
            return `<span style="color:${t.color};">${t.name}</span>: ${j?.double ? '×2' : '—'} ${j?.block ? '🚫' : '—'}`;
          }).join(' | ')}
        </div>
      </div>
      <div class="host-panel">
        <h2>Aktionen</h2>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${(Array.isArray(q.content) ? q.content : [q.content]).some(b => b.type === 'audio' || b.type === 'video') ? `
            <div style="display:flex;gap:8px;">
              <button class="btn btn-green" onclick="mediaControl('play')" style="flex:1;">▶ Abspielen</button>
              <button class="btn btn-red" onclick="mediaControl('pause')" style="flex:1;">⏸ Pause</button>
            </div>
          ` : ''}
          <div style="display:flex;gap:8px;">
            <button class="btn btn-blue" onclick="startTimer(30)" style="flex:1;">Timer 30s</button>
            <button class="btn btn-blue" onclick="startTimer(60)" style="flex:1;">Timer 60s</button>
            <button class="btn btn-red btn-sm" onclick="stopTimer()">Stop</button>
          </div>
          <button class="btn btn-gold" onclick="showAnswer()">Antwort zeigen (Board)</button>
          ${q.type === 'map' ? '<button class="btn btn-blue" onclick="showMapResults()">Karten-Ergebnisse zeigen</button>' : ''}
          <div style="display:flex;gap:8px;align-items:center;">
            <label style="font-size:12px;color:var(--gray);">Vol:</label>
            <input type="range" min="0" max="1" step="0.1" value="1" onchange="socket.emit('set-volume',Number(this.value))" style="flex:1;">
          </div>
          <button class="btn btn-red" onclick="closeQuestion()">Frage schliessen</button>
          <div style="font-size:11px;color:var(--gray);margin-top:4px;">Shortcuts: Leertaste=Buzzer frei, Enter=Antwort, Esc=Schließen</div>
        </div>
      </div>
      <div class="host-panel">
        <h2>Punkte vergeben</h2>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${state.teams.map(t => `
            <div class="host-score-row">
              <span style="color:${t.color};">${esc(t.name)} <small>(${t.score})</small></span>
              <div class="points-controls">
                <button class="btn btn-red btn-sm" onclick="pts(${t.id},-${Math.round(q.points / 2)})">-${Math.round(q.points / 2)}</button>
                <button class="btn btn-green btn-sm" onclick="pts(${t.id},${q.points})">+${q.points}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ${typePanel}
    </div>`;
}

// ---- Buzzer Panel ----
function renderBuzzerPanel() {
  const lastBuzz = state.buzzes?.[state.buzzes.length - 1];
  const lastTeam = lastBuzz ? state.teams.find(t => t.id === lastBuzz.teamId) : null;

  let content = '';
  if (state.buzzerLocked && lastBuzz) {
    content = `
      <div style="padding:10px;background:rgba(255,204,0,0.15);border:1px solid var(--gold);border-radius:8px;margin-bottom:10px;">
        <p style="margin-bottom:8px;"><b style="color:${lastTeam?.color || '#fff'};font-size:18px;">${esc(lastBuzz.playerName)}</b> <small>(${esc(lastTeam?.name)})</small> hat gebuzzert!</p>
        <button class="btn btn-green" onclick="buzzerUnlock()">Falsch — Buzzer freigeben</button>
      </div>`;
  } else if (!state.buzzerLocked && (!state.buzzes || state.buzzes.length === 0)) {
    content = '<p style="color:var(--gray);">Warte auf Buzzer...</p>';
  } else if (!state.buzzerLocked) {
    content = '<p style="color:var(--gray);">Buzzer offen — warte auf nächsten Buzz...</p>';
  }

  // History
  let history = '';
  if (state.buzzes?.length > 0) {
    history = '<div style="margin-top:8px;"><p style="color:var(--gray);font-size:12px;margin-bottom:4px;">Bisherige Buzzer:</p>' +
      state.buzzes.map((b, i) => {
        const t = state.teams.find(t => t.id === b.teamId);
        return `<div style="padding:3px 8px;font-size:13px;opacity:0.7;">${i + 1}. ${esc(b.playerName)} (${esc(t?.name)})</div>`;
      }).join('') + '</div>';
  }

  return `<div class="host-panel">
    <h2>Buzzer ${state.buzzerLocked ? '<span style="color:var(--red);">GESPERRT</span>' : '<span style="color:var(--green);">OFFEN</span>'}</h2>
    ${content}${history}
  </div>`;
}

// ---- Answers Panel (estimate/map) ----
function renderAnswersPanel() {
  const ta = state.teamAnswers || {};
  const revealed = state.revealedAnswers || [];
  const rows = state.teams.map(t => {
    const answer = ta[t.id];
    const isRevealed = revealed.includes(t.id);
    let display = '—';
    if (answer) {
      if (typeof answer.value === 'object' && answer.value?.lat) {
        display = `${answer.value.lat.toFixed(4)}, ${answer.value.lng.toFixed(4)}`;
      } else {
        display = String(answer.value);
      }
    }
    return `<div class="host-answer-entry" style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:${t.color};"><b>${esc(t.name)}</b></span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="value">${answer?.submitted ? esc(display) : '<i style="color:var(--gray);">—</i>'}</span>
        ${answer?.submitted ? `<button class="btn btn-sm ${isRevealed ? 'btn-blue' : 'btn-gold'}" onclick="revealTeamAnswer(${t.id})" ${isRevealed ? 'disabled' : ''}>
          ${isRevealed ? 'Gezeigt' : 'Aufdecken'}
        </button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="host-panel">
    <h2>Team-Antworten</h2>
    ${rows || '<p style="color:var(--gray);">Warte auf Antworten...</p>'}
  </div>`;
}

// ---- Chat Panel ----
function renderChatPanel() {
  const tc = state.teamChat || {};
  const revealedOnBoard = state.revealedAnswers || [];
  const rows = state.teams.map(t => {
    const chat = tc[t.id];
    const revealed = state.chatRevealed?.includes(t.id);
    const shownOnBoard = revealedOnBoard.includes(t.id);
    return `
      <div style="margin-bottom:10px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <b style="color:${t.color};">${esc(t.name)}</b>
          <div style="display:flex;gap:6px;align-items:center;">
            ${chat?.sent ? '<span style="color:var(--green);font-size:12px;">GESENDET</span>' : ''}
            ${chat?.sent ? `<button class="btn btn-sm ${revealed ? 'btn-blue' : 'btn-gold'}" onclick="revealChat(${t.id})" ${revealed ? 'disabled' : ''}>${revealed ? 'Freigegeben' : 'Freigeben'}</button>` : ''}
            ${chat?.sent ? `<button class="btn btn-sm ${shownOnBoard ? 'btn-blue' : 'btn-green'}" onclick="revealTeamAnswer(${t.id})" ${shownOnBoard ? 'disabled' : ''}>${shownOnBoard ? 'Gezeigt' : 'Board zeigen'}</button>` : ''}
          </div>
        </div>
        ${chat?.message
          ? `<div style="padding:8px 12px;background:rgba(255,255,255,0.05);border-radius:8px;font-size:18px;">${esc(chat.message)}</div>`
          : '<span style="color:var(--gray);font-size:13px;">Keine Nachricht</span>'}
      </div>`;
  }).join('');

  return `<div class="host-panel">
    <h2>Team-Chat</h2>
    ${rows}
  </div>`;
}

function buzzerUnlock() { socket.emit('buzzer-unlock'); }
function mediaControl(action) { socket.emit('media-control', action); }
function lineupNext() { socket.emit('lineup-next'); }

// ---- Lineup Panel ----
function renderLineupPanel() {
  const hints = state.currentQuestion?.hints || [];
  const revealed = state.lineupRevealed || 0;
  const allRevealed = revealed >= hints.length;

  // Buzzer part (same logic)
  const lastBuzz = state.buzzes?.[state.buzzes.length - 1];
  const lastTeam = lastBuzz ? state.teams.find(t => t.id === lastBuzz.teamId) : null;

  let buzzerContent = '';
  if (state.buzzerLocked && lastBuzz) {
    buzzerContent = `
      <div style="padding:10px;background:rgba(255,204,0,0.15);border:1px solid var(--gold);border-radius:8px;margin-bottom:10px;">
        <p style="margin-bottom:8px;"><b style="color:${lastTeam?.color || '#fff'};font-size:18px;">${esc(lastBuzz.playerName)}</b> <small>(${esc(lastTeam?.name)})</small> hat gebuzzert!</p>
        <button class="btn btn-green" onclick="buzzerUnlock()">Falsch — Buzzer freigeben</button>
      </div>`;
  }

  let history = '';
  if (state.buzzes?.length > 0) {
    history = '<div style="margin-top:8px;"><p style="color:var(--gray);font-size:12px;margin-bottom:4px;">Bisherige Buzzer:</p>' +
      state.buzzes.map((b, i) => {
        const t = state.teams.find(t => t.id === b.teamId);
        return `<div style="padding:3px 8px;font-size:13px;opacity:0.7;">${i + 1}. ${esc(b.playerName)} (${esc(t?.name)})</div>`;
      }).join('') + '</div>';
  }

  return `<div class="host-panel">
    <h2>7ineup — Hinweise (${revealed}/${hints.length})</h2>
    <div style="margin-bottom:10px;">
      ${hints.map((h, i) => `
        <div style="padding:4px 8px;font-size:14px;${i < revealed ? 'color:var(--gold);' : 'color:var(--gray);opacity:0.5;'}">
          ${i + 1}. ${i < revealed ? esc(h) : '???'}
        </div>
      `).join('')}
    </div>
    <button class="btn btn-gold" onclick="lineupNext()" ${allRevealed ? 'disabled' : ''} style="margin-bottom:10px;">
      ${allRevealed ? 'Alle aufgedeckt' : `Hinweis ${revealed + 1} aufdecken`}
    </button>
    ${buzzerContent}${history}
  </div>`;
}
function revealChat(teamId) { socket.emit('reveal-chat', teamId); }
function revealTeamAnswer(teamId) { socket.emit('reveal-team-answer', teamId); }
function showAnswer() { socket.emit('show-answer'); }
function endGame() { if (confirm('Spiel beenden und Siegerehrung zeigen?')) socket.emit('end-game'); }
function resetGame() { if (confirm('Zurück zur Lobby? Scores werden zurückgesetzt.')) socket.emit('reset-game'); }
function showMapResults() { socket.emit('show-map-results'); }
function closeQuestion() { socket.emit('close-question'); }
function startTimer(sec) { socket.emit('start-timer', sec); }
function stopTimer() { socket.emit('stop-timer'); }

// ---- Host Timer Display ----
let hostTimerInterval = null;
socket.on('start-timer', seconds => {
  clearInterval(hostTimerInterval);
  let remaining = seconds;
  showHostTimer(remaining);
  hostTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(hostTimerInterval); removeHostTimer(); return; }
    showHostTimer(remaining);
  }, 1000);
});
socket.on('stop-timer', () => { clearInterval(hostTimerInterval); removeHostTimer(); });
function showHostTimer(sec) {
  let el = document.getElementById('host-timer');
  if (!el) { el = document.createElement('div'); el.id = 'host-timer'; document.body.appendChild(el); }
  el.className = 'timer-display timer-host';
  el.textContent = sec;
  if (sec <= 5) el.classList.add('timer-urgent');
}
function removeHostTimer() { document.getElementById('host-timer')?.remove(); }

// ==================== Host Chat Monitor ====================
function renderHostChat() {
  if (!state) return;
  let widget = document.getElementById('host-chat-monitor');
  if (!widget) {
    widget = document.createElement('div');
    widget.id = 'host-chat-monitor';
    document.body.appendChild(widget);
  }

  const totalMsgs = Object.values(allTeamMessages).reduce((s, a) => s + a.length, 0);

  if (!hostChatOpen) {
    widget.innerHTML = `<button class="tc-toggle hc-toggle" onclick="toggleHostChat()">💬 ${totalMsgs}</button>`;
    return;
  }

  const teamsHtml = state.teams.map(t => {
    const msgs = allTeamMessages[t.id] || [];
    const msgsHtml = msgs.length > 0
      ? msgs.slice(-20).map(m => `<div class="hc-msg"><b style="color:${t.color};">${esc(m.playerName)}:</b> ${esc(m.message)}</div>`).join('')
      : '<div class="hc-msg" style="color:var(--gray);font-style:italic;">Keine Nachrichten</div>';
    return `
      <div class="hc-team">
        <div class="hc-team-name" style="color:${t.color};">${esc(t.name)}</div>
        <div class="hc-team-msgs">${msgsHtml}</div>
      </div>`;
  }).join('');

  widget.innerHTML = `
    <div class="hc-panel">
      <div class="tc-header">
        <span>Team-Chats</span>
        <button class="tc-close" onclick="toggleHostChat()">✕</button>
      </div>
      <div class="hc-body">${teamsHtml}</div>
    </div>`;

  // Auto-scroll each team section
  widget.querySelectorAll('.hc-team-msgs').forEach(el => el.scrollTop = el.scrollHeight);
}

function toggleHostChat() {
  hostChatOpen = !hostChatOpen;
  renderHostChat();
}

// ==================== Keyboard Shortcuts ====================
document.addEventListener('keydown', e => {
  if (!state || state.phase !== 'question') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); buzzerUnlock(); }
  else if (e.code === 'Enter') { e.preventDefault(); showAnswer(); }
  else if (e.code === 'Escape') { e.preventDefault(); closeQuestion(); }
});

function esc(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
