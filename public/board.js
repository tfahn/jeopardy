const socket = io({ query: { role: 'board' } });
const app = document.getElementById('app');
let state = null;
let answerShown = false;
let revealedTeamAnswers = [];
let mapInstance = null;
let mapMarkers = [];
let lastMapResults = null; // preserve map results across re-renders
let audioWasPlaying = false; // preserve audio playback state across re-renders
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

function sfxDailyDouble() {
  const ctx = getAudioCtx();
  // Dramatic ascending notes
  [330, 440, 554, 660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.15;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    osc.start(t); osc.stop(t + 0.4);
  });
}

function sfxJoker() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2);
  osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.4);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
  osc.start(); osc.stop(ctx.currentTime + 0.5);
}

let boardVolume = 1.0;

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
  else if (type === 'dailyDouble') sfxDailyDouble();
  else if (type === 'joker') sfxJoker();
});

socket.on('emoji-react', data => {
  const el = document.createElement('div');
  el.className = 'emoji-fly';
  el.textContent = data.emoji;
  el.style.left = (10 + Math.random() * 80) + '%';
  el.style.color = data.teamColor;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
});

socket.on('score-change', data => {
  showScoreAnimation(data.delta, data.teamColor, data.teamName);
});

socket.on('set-volume', vol => {
  boardVolume = vol;
  document.querySelectorAll('audio, video').forEach(el => { el.volume = vol; });
});

function showScoreAnimation(delta, color, teamName) {
  const el = document.createElement('div');
  el.className = 'score-fly';
  el.style.color = color;
  el.textContent = `${delta > 0 ? '+' : ''}${delta} ${teamName}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function goFullscreen() {
  document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.();
}

socket.on('state', s => {
  const prev = state;
  const questionChanged = !prev || prev.phase !== s.phase ||
    prev.currentQuestion?.row !== s.currentQuestion?.row ||
    prev.currentQuestion?.col !== s.currentQuestion?.col;
  // Detect changes that need partial re-render (not full)
  const lineupChanged = prev?.lineupRevealed !== s.lineupRevealed;
  const jokersChanged = prev?.activeJokers?.double !== s.activeJokers?.double ||
    prev?.activeJokers?.blocked !== s.activeJokers?.blocked;
  state = s;
  if (questionChanged) {
    answerShown = false;
    revealedTeamAnswers = [];
    lastMapResults = null;
    render();
  } else if (lineupChanged || jokersChanged) {
    // Targeted updates without full re-render (preserves audio/video playback)
    if (s.phase === 'question') {
      if (lineupChanged) updateLineupHints();
      if (jokersChanged) updateJokerBanners();
    }
    updateScores();
  } else {
    updateScores();
  }
});

socket.on('show-answer', data => {
  answerShown = data;
  sfxReveal();
  // Save current blur states before re-render
  const blurStates = {};
  document.querySelectorAll('img.question-image').forEach((img, i) => {
    const computed = getComputedStyle(img).filter;
    const match = computed && computed.match(/blur\(([0-9.]+)px\)/);
    blurStates[i] = match ? parseFloat(match[1]) : 0;
  });
  renderQuestion();
  // Restore blur states (continue from where they were)
  document.querySelectorAll('img.question-image').forEach((img, i) => {
    if (blurStates[i] !== undefined && blurStates[i] > 0 && img.classList.contains('blur-reveal')) {
      const remaining = (blurStates[i] / 50) * 30;
      img.classList.remove('blur-reveal');
      img.style.filter = `blur(${blurStates[i]}px)`;
      void img.offsetWidth;
      img.style.transition = `filter ${remaining}s linear`;
      img.style.filter = 'blur(0px)';
    } else if (blurStates[i] !== undefined && blurStates[i] === 0 && img.classList.contains('blur-reveal')) {
      // Was already fully revealed — remove animation
      img.classList.remove('blur-reveal');
      img.style.filter = 'none';
    }
  });
});

socket.on('buzzer-locked', data => {
  if (!state) return;
  state.buzzerLocked = true;
  sfxBuzz();
  // Auto-pause any playing media
  pauseAllMedia();
  // Hide image and save current blur progress
  document.querySelectorAll('img.question-image').forEach(img => {
    const computed = getComputedStyle(img).filter;
    const match = computed && computed.match(/blur\(([0-9.]+)px\)/);
    img.dataset.blurPaused = match ? match[1] : '0';
    img.classList.add('buzz-hidden');
  });
  renderBuzzes();
});

socket.on('buzzer-unlocked', () => {
  if (!state) return;
  state.buzzerLocked = false;
  sfxWrong();
  // Show image again, continue blur from where it paused
  document.querySelectorAll('img.question-image.buzz-hidden').forEach(img => {
    img.classList.remove('buzz-hidden');
    const pausedBlur = parseFloat(img.dataset.blurPaused || '50');
    if (pausedBlur > 0.5 && img.classList.contains('blur-reveal')) {
      // Calculate remaining time: animation is 30s total, 50px to 0px
      const remainingSec = (pausedBlur / 50) * 30;
      img.classList.remove('blur-reveal');
      img.style.filter = `blur(${pausedBlur}px)`;
      void img.offsetWidth;
      img.style.transition = `filter ${remainingSec}s linear`;
      img.style.filter = 'blur(0px)';
    }
  });
  renderBuzzes();
});

socket.on('media-control', action => {
  if (action === 'play') playAllMedia();
  else if (action === 'pause') pauseAllMedia();
});

socket.on('map-results', data => {
  lastMapResults = data;
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
  audioWasPlaying = false;
  document.querySelectorAll('audio, video').forEach(el => el.pause());
  document.getElementById('audio-viz')?.classList.remove('audio-playing');
}

function playAllMedia() {
  audioWasPlaying = true;
  document.querySelectorAll('audio, video').forEach(el => { el.volume = boardVolume; el.play(); });
  document.getElementById('audio-viz')?.classList.add('audio-playing');
}

function render() {
  if (!state) return;
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'board') renderBoard();
  else if (state.phase === 'dailyDouble') renderDailyDouble();
  else if (state.phase === 'question') renderQuestion();
  else if (state.phase === 'endscreen') renderEndscreen();
}

function renderEndscreen() {
  const sorted = [...state.teams].sort((a, b) => b.score - a.score);
  const heights = [240, 180, 140];
  const ranks = ['🥇', '🥈', '🥉'];
  // Reorder for podium: 2nd, 1st, 3rd
  const podiumOrder = sorted.length >= 3 ? [sorted[1], sorted[0], sorted[2]] : sorted;

  app.innerHTML = `
    <div class="endscreen">
      <h1>GAME OVER!</h1>
      <div class="podium">
        ${podiumOrder.map((t, i) => {
          const realRank = sorted.indexOf(t);
          const h = heights[realRank] || 100;
          return `
            <div class="podium-entry">
              <div class="podium-score">${t.score}</div>
              <div class="podium-bar" style="height:${h}px;background:${t.color};">
                <span class="podium-rank">${ranks[realRank] || realRank + 1}</span>
              </div>
              <div class="podium-name" style="color:${t.color};">${t.name}</div>
            </div>`;
        }).join('')}
      </div>
      ${sorted.length > 3 ? sorted.slice(3).map((t, i) => `
        <div style="font-size:18px;margin:4px 0;color:${t.color};">${i + 4}. ${t.name} — ${t.score}P</div>
      `).join('') : ''}
    </div>`;
  // Confetti!
  launchConfetti();
}

function launchConfetti() {
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:-10px;left:${Math.random()*100}%;width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;background:${['var(--gold)','var(--red)','var(--green)','var(--blue-mid)','#fff','#e67e22','#9b59b6'][Math.floor(Math.random()*7)]};z-index:9999;pointer-events:none;border-radius:${Math.random()>0.5?'50%':'2px'};animation:confettiFall ${2+Math.random()*3}s linear ${Math.random()*2}s forwards;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
}

function updateLineupHints() {
  const el = document.querySelector('.lineup-hints');
  if (!el || !state.currentQuestion) return;
  const hints = state.currentQuestion.hints || [];
  const revealed = state.lineupRevealed || 0;
  el.innerHTML = hints.map((h, i) => `
    <div class="lineup-hint ${i < revealed ? 'revealed' : ''}" style="animation-delay:${i * 0.1}s;">
      <span class="lineup-number">${i + 1}</span>
      <span class="lineup-text">${i < revealed ? h : '???'}</span>
    </div>
  `).join('');
}

function updateJokerBanners() {
  // Remove old banners
  document.querySelectorAll('.joker-banner').forEach(el => el.remove());
  if (!state.activeJokers) return;
  const overlay = document.querySelector('.question-overlay');
  if (!overlay) return;
  if (state.remainingQuestions <= 3) {
    const banner = document.createElement('div');
    banner.className = 'joker-banner double-banner';
    banner.textContent = 'FINALE — ALLE PUNKTE ×2!';
    overlay.prepend(banner);
  }
  if (state.activeJokers.double !== null) {
    const jTeam = state.teams.find(t => t.id === state.activeJokers.double);
    const banner = document.createElement('div');
    banner.className = 'joker-banner double-banner';
    banner.textContent = `DOPPEL-JOKER! (${jTeam?.name || '?'})`;
    overlay.prepend(banner);
  }
  if (state.activeJokers.blocked !== null) {
    const bTeam = state.teams.find(t => t.id === state.activeJokers.blocked);
    const banner = document.createElement('div');
    banner.className = 'joker-banner block-banner';
    banner.textContent = `${bTeam?.name || '?'} GESPERRT!`;
    overlay.prepend(banner);
  }
}

function updateScores() {
  if (!state) return;
  document.querySelectorAll('.team-score').forEach((el, i) => {
    const t = state.teams[i];
    if (!t) return;
    const scoreEl = el.querySelector('.score');
    if (scoreEl) scoreEl.textContent = t.score;
    const isActive = i === state.currentTeamIndex;
    el.classList.toggle('active', isActive);
    el.style.borderColor = isActive ? t.color : 'transparent';
  });
}

function renderLobby() {
  const playerUrl = window.location.origin + '/player.html';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=FFD700&bgcolor=0A0A2E&data=${encodeURIComponent(playerUrl)}`;
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
      <h1 style="font-size:72px;color:var(--gold);margin-bottom:10px;">JEOPARDY</h1>
      <p style="font-size:20px;color:var(--gray);margin-bottom:20px;">Scannt den QR-Code um mitzuspielen!</p>
      <img src="${qrUrl}" alt="QR Code" style="border-radius:12px;border:3px solid var(--gold);margin-bottom:15px;">
      <p style="font-size:14px;color:var(--gray);margin-bottom:30px;">${playerUrl}</p>
      <div style="margin-top:10px;">
        ${state.teams.map(t => `
          <div style="display:flex;align-items:center;gap:12px;margin:10px 0;">
            <div style="width:20px;height:20px;border-radius:50%;background:${t.color};"></div>
            <span style="font-size:20px;">${t.name}</span>
            <span style="color:var(--gray);">(${t.members.map(m => m.name).join(', ') || 'leer'})</span>
          </div>
        `).join('')}
      </div>
      <button onclick="goFullscreen()" style="margin-top:20px;padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:none;color:var(--gray);cursor:pointer;font-size:14px;">Vollbild</button>
    </div>`;
}

function renderDailyDouble() {
  if (!state.currentQuestion) return;
  const team = state.teams[state.dailyDoubleTeam];
  app.innerHTML = `
    <div class="daily-double-overlay">
      <div class="dd-star">&#9733;</div>
      <h1 class="dd-title">DAILY DOUBLE!</h1>
      <p class="dd-team" style="color:${team?.color || '#fff'};">${team?.name || '?'} setzt Punkte...</p>
      <p class="dd-category">${state.currentQuestion.category} — ${state.currentQuestion.points}P</p>
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
  const isFinale = state.remainingQuestions <= 3;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = state.board[r][c];
      const finaleClass = (!cell.used && isFinale) ? ' finale-double' : '';
      gridHtml += `<div class="board-cell ${cell.used ? 'used' : ''}${finaleClass}">${cell.used ? '' : (isFinale ? cell.points + ' ×2' : cell.points)}</div>`;
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

  // Active joker/finale banners
  let jokerBanner = '';
  if (state.remainingQuestions <= 3) {
    jokerBanner += `<div class="joker-banner double-banner">FINALE — ALLE PUNKTE ×2!</div>`;
  }
  if (state.activeJokers?.double !== null) {
    const jTeam = state.teams.find(t => t.id === state.activeJokers.double);
    jokerBanner += `<div class="joker-banner double-banner">DOPPEL-JOKER! (${jTeam?.name || '?'})</div>`;
  }
  if (state.activeJokers?.blocked !== null) {
    const bTeam = state.teams.find(t => t.id === state.activeJokers.blocked);
    jokerBanner += `<div class="joker-banner block-banner">${bTeam?.name || '?'} GESPERRT!</div>`;
  }
  // Daily Double wager
  let ddBanner = '';
  if (state.dailyDoubleWager) {
    const ddTeam = state.teams[state.dailyDoubleTeam];
    ddBanner = `<div class="joker-banner dd-banner">DAILY DOUBLE — Einsatz: ${state.dailyDoubleWager} (${ddTeam?.name || '?'})</div>`;
  }

  app.innerHTML = `
    <div class="question-overlay">
      <div class="scoreboard" style="position:absolute;top:10px;left:0;right:0;">${scoreHtml}</div>
      ${jokerBanner}${ddBanner}
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
    setTimeout(() => {
      initBoardMap();
      if (lastMapResults) showMapResults(lastMapResults);
    }, 100);
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
