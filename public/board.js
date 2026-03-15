const socket = io({ query: { role: 'board' } });
const app = document.getElementById('app');
let state = null;
let answerShown = false;
let revealedTeamAnswers = [];
let mapInstance = null;
let mapMarkers = [];
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Unlock audio on first user interaction
document.addEventListener('click', () => { getAudioCtx(); }, { once: true });

function sfxBuzz() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  osc.start(); osc.stop(ctx.currentTime + 0.3);
}

function sfxCorrect() {
  const ctx = getAudioCtx();
  [523, 659, 784].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.3);
    osc.start(ctx.currentTime + i * 0.12);
    osc.stop(ctx.currentTime + i * 0.12 + 0.3);
  });
}

function sfxWrong() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(120, ctx.currentTime + 0.4);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
  osc.start(); osc.stop(ctx.currentTime + 0.5);
}

function sfxReveal() {
  const ctx = getAudioCtx();
  [440, 554, 659, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.4);
    osc.start(ctx.currentTime + i * 0.08);
    osc.stop(ctx.currentTime + i * 0.08 + 0.4);
  });
}

function sfxTimerEnd() {
  const ctx = getAudioCtx();
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.2 + 0.15);
    osc.start(ctx.currentTime + i * 0.2);
    osc.stop(ctx.currentTime + i * 0.2 + 0.15);
  }
}

function sfxSelect() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
  osc.start(); osc.stop(ctx.currentTime + 0.2);
}

function sfxPoints(positive) {
  if (positive) sfxCorrect();
  else sfxWrong();
}

// Audio unlock overlay — board needs one click before sounds work
(function() {
  const overlay = document.createElement('div');
  overlay.id = 'audio-unlock';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.innerHTML = '<div style="text-align:center;"><div style="font-size:64px;margin-bottom:20px;">🔊</div><div style="font-size:24px;color:var(--gold);font-weight:700;">Klicken um Sound zu aktivieren</div></div>';
  overlay.addEventListener('click', () => {
    getAudioCtx();
    overlay.remove();
  }, { once: true });
  document.body.appendChild(overlay);
})();

socket.on('connect', () => socket.emit('register', 'board'));

socket.on('sfx', type => {
  if (type === 'correct') sfxCorrect();
  else if (type === 'wrong') sfxWrong();
  else if (type === 'select') sfxSelect();
});

socket.on('state', s => {
  state = s;
  answerShown = false;
  revealedTeamAnswers = [];
  render();
});

socket.on('show-answer', data => {
  answerShown = data;
  sfxReveal();
  renderQuestion();
});

socket.on('buzzer-locked', data => {
  if (!state) return;
  if (!state.buzzes) state.buzzes = [];
  if (data.playerName) state.buzzes.push(data);
  state.buzzerLocked = true;
  sfxBuzz();
  // Auto-pause any playing media
  pauseAllMedia();
  // Hide image so buzzer can't keep looking
  document.querySelectorAll('img.question-image').forEach(img => img.classList.add('buzz-hidden'));
  renderBuzzes();
});

socket.on('buzzer-unlocked', () => {
  if (!state) return;
  state.buzzerLocked = false;
  sfxWrong();
  // Show image again and restart blur animation from beginning
  document.querySelectorAll('img.question-image.buzz-hidden').forEach(img => {
    img.classList.remove('buzz-hidden');
    img.classList.remove('blur-reveal');
    void img.offsetWidth; // force reflow to restart animation
    img.classList.add('blur-reveal');
  });
  renderBuzzes();
});

socket.on('media-control', action => {
  if (action === 'play') playAllMedia();
  else if (action === 'pause') pauseAllMedia();
});

socket.on('map-results', data => {
  showMapResults(data);
});

socket.on('reveal-team-answer', data => {
  revealedTeamAnswers.push(data);
  renderRevealedAnswers();
});

// ---- Timer ----
let boardTimerInterval = null;
socket.on('start-timer', seconds => {
  clearInterval(boardTimerInterval);
  let remaining = seconds;
  showBoardTimer(remaining);
  boardTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(boardTimerInterval); removeBoardTimer(); sfxTimerEnd(); return; }
    showBoardTimer(remaining);
  }, 1000);
});
socket.on('stop-timer', () => { clearInterval(boardTimerInterval); removeBoardTimer(); });
function showBoardTimer(sec) {
  let el = document.getElementById('board-timer');
  if (!el) { el = document.createElement('div'); el.id = 'board-timer'; document.body.appendChild(el); }
  el.className = 'timer-display timer-board';
  el.textContent = sec;
  if (sec <= 5) el.classList.add('timer-urgent');
}
function removeBoardTimer() { document.getElementById('board-timer')?.remove(); }

function pauseAllMedia() {
  document.querySelectorAll('audio, video').forEach(el => el.pause());
  document.getElementById('audio-viz')?.classList.remove('audio-playing');
}

function playAllMedia() {
  document.querySelectorAll('audio, video').forEach(el => el.play());
  document.getElementById('audio-viz')?.classList.add('audio-playing');
}

function render() {
  if (!state) return;
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'board') renderBoard();
  else if (state.phase === 'question') renderQuestion();
}

function renderLobby() {
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
      <h1 style="font-size:64px;color:var(--gold);margin-bottom:20px;">JEOPARDY</h1>
      <p style="font-size:24px;color:var(--gray);">Warte auf Spielstart...</p>
      <div style="margin-top:30px;">
        ${state.teams.map(t => `
          <div style="display:flex;align-items:center;gap:12px;margin:10px 0;">
            <div style="width:20px;height:20px;border-radius:50%;background:${t.color};"></div>
            <span style="font-size:20px;">${t.name}</span>
            <span style="color:var(--gray);">(${t.members.map(m => m.name).join(', ') || 'leer'})</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderBoard() {
  const scoreHtml = state.teams.map((t, i) => `
    <div class="team-score ${i === state.currentTeamIndex ? 'active' : ''}" style="border-color:${i === state.currentTeamIndex ? t.color : 'transparent'}">
      <div class="name" style="color:${t.color}">${t.name}</div>
      <div class="score">${t.score}</div>
    </div>
  `).join('');

  let gridHtml = '';
  for (let c = 0; c < 5; c++) {
    gridHtml += `<div class="category-header">${state.categories[c] || ''}</div>`;
  }
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = state.board[r][c];
      gridHtml += `<div class="board-cell ${cell.used ? 'used' : ''}">${cell.used ? '' : cell.points}</div>`;
    }
  }

  app.innerHTML = `
    <div class="scoreboard">${scoreHtml}</div>
    <div class="jeopardy-grid">${gridHtml}</div>`;
}

function renderQuestion() {
  if (!state.currentQuestion) return;
  const q = state.currentQuestion;

  const contentBlocks = Array.isArray(q.content) ? q.content : [q.content];
  const isBuzzerType = (q.type === 'buzzer' || q.type === 'lineup');
  let contentHtml = '<div class="question-content">';
  for (const block of contentBlocks) {
    if (block.type === 'text' && block.text) {
      contentHtml += `<p>${block.text}</p>`;
    } else if (block.type === 'image') {
      if (block.text) contentHtml += `<p>${block.text}</p>`;
      const blurClass = block.blur ? ' blur-reveal' : '';
      contentHtml += `<img class="question-image${blurClass}" src="${block.media}" alt="">`;
    } else if (block.type === 'audio') {
      if (block.text) contentHtml += `<p>${block.text}</p>`;
      const bars = Array.from({length: 20}, (_, i) => `<div class="audio-bar" style="animation-delay:${(i * 0.08).toFixed(2)}s;"></div>`).join('');
      contentHtml += `<audio src="${block.media}"></audio><div class="audio-visualizer" id="audio-viz">${bars}</div>`;
    } else if (block.type === 'video') {
      if (block.text) contentHtml += `<p>${block.text}</p>`;
      contentHtml += `<video controls autoplay src="${block.media}" style="max-width:80vw;max-height:50vh;border-radius:12px;"></video>`;
    }
  }
  contentHtml += '</div>';

  const typeName = { buzzer: 'Buzzer', estimate: 'Schätzfrage', map: 'Karte', chat: 'Team-Chat', lineup: '7ineup' }[q.type];
  const badgeClass = { buzzer: 'badge-buzzer', estimate: 'badge-estimate', map: 'badge-map', chat: 'badge-chat' }[q.type];

  let answerHtml = '';
  if (answerShown) {
    answerHtml = `<div class="answer-reveal">${answerShown.answer}</div>`;
  }

  let mapHtml = '';
  if (q.type === 'map') {
    mapHtml = '<div class="map-container" id="board-map"></div>';
  }

  let buzzHtml = '';
  if (q.type === 'buzzer' || q.type === 'lineup') {
    buzzHtml = '<div class="buzz-list" id="buzz-list"></div>';
  }

  // For chat type, show the task (not the secret)
  if (q.type === 'chat') {
    const chatText = (Array.isArray(q.content) ? q.content : [q.content]).map(b => b.text).filter(Boolean).join(' ') || 'Team-Kommunikation';
    contentHtml = `<div class="question-content">${chatText}</div>`;
  }

  // Lineup: show revealed hints
  if (q.type === 'lineup') {
    const hints = q.hints || [];
    const revealed = state.lineupRevealed || 0;
    contentHtml = `
      <div class="question-content" style="text-align:left;max-width:700px;">
        ${(() => { const t = (Array.isArray(q.content) ? q.content : [q.content]).map(b => b.text).filter(Boolean).join(' '); return t ? `<p style="margin-bottom:20px;text-align:center;">${t}</p>` : ''; })()}
        <div class="lineup-hints">
          ${hints.map((h, i) => `
            <div class="lineup-hint ${i < revealed ? 'revealed' : ''}" style="animation-delay:${i * 0.1}s;">
              <span class="lineup-number">${i + 1}</span>
              <span class="lineup-text">${i < revealed ? h : '???'}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  const scoreHtml = state.teams.map((t, i) => `
    <div class="team-score ${i === state.currentTeamIndex ? 'active' : ''}" style="border-color:${i === state.currentTeamIndex ? t.color : 'transparent'}">
      <div class="name" style="color:${t.color}">${t.name}</div>
      <div class="score">${t.score}</div>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="question-overlay">
      <div class="scoreboard" style="position:absolute;top:10px;left:0;right:0;">${scoreHtml}</div>
      <span class="question-type-badge ${badgeClass}">${typeName}</span>
      <div class="question-meta">${q.category}</div>
      <div class="question-points">${q.points}</div>
      ${contentHtml}
      ${mapHtml}
      ${buzzHtml}
      <div id="revealed-answers"></div>
      ${answerHtml}
    </div>`;

  if (q.type === 'map') {
    setTimeout(() => initBoardMap(), 100);
  }
  if ((q.type === 'buzzer' || q.type === 'lineup') && state.buzzes) {
    renderBuzzes();
  }
  if (revealedTeamAnswers.length > 0) {
    renderRevealedAnswers();
  }
}

function renderBuzzes() {
  const el = document.getElementById('buzz-list');
  if (!el || !state.buzzes) return;
  const lastIdx = state.buzzes.length - 1;
  el.innerHTML = state.buzzes.map((b, i) => {
    const team = state.teams.find(t => t.id === b.teamId);
    const isActive = i === lastIdx && state.buzzerLocked;
    return `<div class="buzz-entry" style="${isActive ? `background:${team?.color || 'var(--gold)'};color:white;font-size:28px;` : 'opacity:0.5;'}">${b.playerName} (${team?.name || '?'})</div>`;
  }).join('');
}

function renderRevealedAnswers() {
  const el = document.getElementById('revealed-answers');
  if (!el) return;
  el.innerHTML = revealedTeamAnswers.map(a => {
    const color = a.team?.color || '#fff';
    let displayValue = '';
    if (a.type === 'estimate') {
      displayValue = String(a.value);
    } else if (a.type === 'map') {
      displayValue = `📍 ${a.value?.lat?.toFixed(2)}, ${a.value?.lng?.toFixed(2)}`;
    } else if (a.type === 'chat') {
      displayValue = a.value;
    }
    return `<div class="revealed-answer" style="border-left:4px solid ${color};animation:revealSlide 0.5s ease-out;">
      <span class="revealed-team" style="color:${color};">${a.team?.name || '?'}</span>
      <span class="revealed-value">${displayValue}</span>
    </div>`;
  }).join('');
}

function initBoardMap() {
  const el = document.getElementById('board-map');
  if (!el) return;
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapInstance = L.map(el, { zoomControl: false }).setView([30, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CartoDB',
    maxZoom: 18,
  }).addTo(mapInstance);
}

function showMapResults(data) {
  if (!mapInstance) return;
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  if (data.target) {
    const marker = L.marker([data.target.lat, data.target.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="width:24px;height:24px;background:#ffcc00;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
    }).addTo(mapInstance).bindPopup('<b>Richtige Antwort</b>').openPopup();
    mapMarkers.push(marker);
  }

  data.answers.forEach(a => {
    if (!a.value || !a.value.lat) return;
    const team = state.teams.find(t => t.id === a.teamId);
    const color = team?.color || '#fff';
    const marker = L.marker([a.value.lat, a.value.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="width:18px;height:18px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      })
    }).addTo(mapInstance).bindPopup(`${a.playerName}`);
    mapMarkers.push(marker);

    if (data.target) {
      const line = L.polyline([[a.value.lat, a.value.lng], [data.target.lat, data.target.lng]], {
        color: color, weight: 2, opacity: 0.6, dashArray: '5,10',
      }).addTo(mapInstance);
      mapMarkers.push(line);
    }
  });

  if (data.target && data.answers.length > 0) {
    const allPoints = [[data.target.lat, data.target.lng]];
    data.answers.forEach(a => { if (a.value?.lat) allPoints.push([a.value.lat, a.value.lng]); });
    mapInstance.fitBounds(allPoints, { padding: [50, 50] });
  }
}
