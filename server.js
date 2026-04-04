const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// File upload config
const uploadDir = path.join(__dirname, 'public', 'media', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const unique = `${base}-${Date.now()}${ext}`;
      cb(null, unique);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Host password protection
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'jeopardy';

function requirePassword(req, res, next) {
  if (req.query.pw === HOST_PASSWORD) return next();
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Host Login</title><link rel="stylesheet" href="/style.css">
    <style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .login{text-align:center;} .login input{padding:12px 16px;border-radius:8px;border:2px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:white;font-size:18px;margin:10px 0;width:220px;}
    .login input:focus{border-color:var(--gold);outline:none;}</style></head><body>
    <div class="login"><h1 style="color:var(--gold);margin-bottom:10px;">Host Login</h1>
    <form onsubmit="location.href=location.pathname+'?pw='+document.getElementById('pw').value;return false;">
    <input type="password" id="pw" placeholder="Passwort" autofocus>
    <br><button class="btn btn-gold" type="submit">Einloggen</button></form></div></body></html>`);
}

app.get('/host.html', requirePassword);
app.get('/board.html', requirePassword);
app.get('/editor.html', requirePassword);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// --------------- Game State ---------------
const game = {
  phase: 'lobby',
  teams: [],
  categories: [],
  board: [],
  currentQuestion: null,
  currentTeamIndex: 0,
  buzzes: [],
  buzzerLocked: false,
  buzzerOut: [],
  teamAnswers: {},     // { [teamId]: { value, submitted } }
  teamChat: {},        // { [teamId]: { message, sent } }
  chatRevealed: [],
  revealedAnswers: [],  // teamIds whose answers are shown on board
  lineupRevealed: 0,   // how many lineup hints are shown
  teamMessages: {},    // persistent team chat: { [teamId]: [{playerName, message, timestamp}] }
  // Jokers: each team gets 2 (double, block)
  jokers: {},          // { [teamId]: { double: bool, block: bool } }
  activeJokers: { double: null, blocked: null }, // { double: teamId|null, blocked: teamId|null }
  // Daily Double
  dailyDouble: null,   // { row, col }
  dailyDoubleWager: null,
  dailyDoubleTeam: null,
  // History
  answerHistory: [],   // [{ category, points, type, answer, correct: teamId|null }]
  // Volume
  volume: 1.0,
  // Timer
  timerExpired: false,
  timerId: null,
};

function loadQuestions(filename) {
  const file = filename || 'board-1.json';
  const safe = file.replace(/[^a-zA-Z0-9._-]/g, '');
  const filepath = path.join(__dirname, 'data', safe);
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Failed to load ${safe}:`, e.message);
    return { categories: [] };
  }
}

function listQuestionFiles() {
  return fs.readdirSync(path.join(__dirname, 'data'))
    .filter(f => f.endsWith('.json'))
    .sort();
}

app.use(express.json({ limit: '5mb' }));

app.get('/api/boards', (req, res) => {
  res.json(listQuestionFiles());
});

app.get('/api/boards/:name', (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = path.join(__dirname, 'data', safe);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.post('/api/boards/:name', (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe.endsWith('.json')) return res.status(400).json({ error: 'Must end with .json' });
  fs.writeFileSync(path.join(__dirname, 'data', safe), JSON.stringify(req.body, null, 2), 'utf8');
  res.json({ ok: true });
});

app.delete('/api/boards/:name', (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = path.join(__dirname, 'data', safe);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

app.post('/api/upload', upload.array('files', 20), (req, res) => {
  const paths = req.files.map(f => `/media/uploads/${f.filename}`);
  res.json({ files: paths });
});

app.get('/api/uploads', (req, res) => {
  if (!fs.existsSync(uploadDir)) return res.json([]);
  const files = fs.readdirSync(uploadDir)
    .filter(f => !f.startsWith('.'))
    .map(f => ({ name: f, path: `/media/uploads/${f}` }));
  res.json(files);
});

// --------------- Helpers ---------------
function getMemberIndex(socketId) {
  for (const t of game.teams) {
    const idx = t.members.findIndex(m => m.socketId === socketId);
    if (idx !== -1) return idx;
  }
  return -1;
}

function getTeamOfSocket(socketId) {
  return game.teams.find(t => t.members.some(m => m.socketId === socketId));
}

// Which player index answers for this question type?
// If team has only 1 member, always return 0
function getAnswerPlayerIndex(q, team) {
  if (team && team.members.length <= 1) return 0;
  if (q.type === 'chat') return q.describerIndex ?? 0;
  return q.answerPlayer ?? 0;
}

function getRemainingQuestions() {
  let count = 0;
  for (let r = 0; r < game.board.length; r++) {
    for (let c = 0; c < game.board[r].length; c++) {
      if (!game.board[r][c].used) count++;
    }
  }
  return count;
}

function clientState(role, socketId) {
  const s = {
    phase: game.phase,
    teams: game.teams.map(t => ({
      id: t.id, name: t.name, color: t.color, score: t.score,
      members: t.members.map(m => ({ name: m.name, index: m.index })),
    })),
    currentTeamIndex: game.currentTeamIndex,
    board: game.board,
    categories: game.categories.map(c => c.name),
    jokers: game.jokers,
    activeJokers: game.activeJokers,
    dailyDoubleWager: game.dailyDoubleWager,
    dailyDoubleTeam: game.dailyDoubleTeam,
    remainingQuestions: getRemainingQuestions(),
    timerExpired: game.timerExpired,
  };

  if (game.currentQuestion) {
    const q = game.currentQuestion;
    s.currentQuestion = {
      type: q.type, points: q.points, category: q.category,
      content: q.content, row: q.row, col: q.col,
    };
    s.buzzerLocked = game.buzzerLocked;
    s.lineupRevealed = game.lineupRevealed;

    if (role === 'player') {
      const memberIdx = getMemberIndex(socketId);
      const team = getTeamOfSocket(socketId);
      const teamId = team?.id;
      const answerIdx = getAnswerPlayerIndex(q, team);

      // Is this player the one who answers?
      s.isAnswerer = (memberIdx === answerIdx);

      // Team answer status
      if (teamId !== undefined && game.teamAnswers[teamId]) {
        s.teamAnswer = game.teamAnswers[teamId];
      }

      // Chat specifics
      if (q.type === 'chat') {
        s.chatRole = s.isAnswerer ? 'describer' : 'guesser';
        if (s.isAnswerer) {
          s.currentQuestion.secret = q.secret;
        }
        if (teamId !== undefined) {
          const chat = game.teamChat[teamId];
          if (s.isAnswerer) {
            s.teamChatMessage = chat || null;
          } else if (game.chatRevealed.includes(teamId) && chat?.sent) {
            s.teamChatMessage = chat;
            s.chatRevealed = true;
          } else {
            s.chatRevealed = false;
          }
        }
      }
    }

    // Lineup: only send revealed hints to non-host
    if (q.type === 'lineup' && role !== 'host') {
      s.currentQuestion.hints = (q.hints || []).slice(0, game.lineupRevealed);
    }

    // Board also needs buzzes for display
    if (role === 'board') {
      s.buzzes = game.buzzes;
    }

    if (role === 'host') {
      s.currentQuestion.answer = q.answer;
      s.currentQuestion.target = q.target;
      s.currentQuestion.secret = q.secret;
      if (q.type === 'lineup') s.currentQuestion.hints = q.hints;
      s.buzzes = game.buzzes;
      s.buzzerOut = game.buzzerOut;
      s.teamAnswers = game.teamAnswers;
      s.teamChat = game.teamChat;
      s.chatRevealed = game.chatRevealed;
      s.revealedAnswers = game.revealedAnswers;
      s.answerHistory = game.answerHistory;
    }
  }
  return s;
}

function broadcast() {
  io.fetchSockets().then(sockets => {
    for (const s of sockets) {
      s.emit('state', clientState(s.data.role || 'spectator', s.id));
    }
  });
}

const disconnectTimers = {}; // { "teamId-playerName": { timeoutId, oldSocketId } }

// --------------- Socket.IO ---------------
io.on('connection', socket => {
  console.log(`+ ${socket.id}`);

  socket.on('register', role => {
    socket.data.role = role;
    if (role === 'host') {
      socket.join('host-room');
      socket.emit('all-team-msgs', game.teamMessages);
    }
    socket.emit('state', clientState(role, socket.id));
  });

  // ---- Lobby ----
  socket.on('setup-teams', teams => {
    // Preserve existing members/scores when updating teams
    game.teams = teams.map((t, i) => {
      const existing = game.teams.find(et => et.id === i);
      return {
        id: i, name: t.name, color: t.color,
        score: existing?.score ?? 0,
        members: existing?.members ?? [],
      };
    });
    // Remove teams that no longer exist — kick their players
    io.fetchSockets().then(sockets => {
      for (const s of sockets) {
        if (s.data.teamId !== undefined && !game.teams.find(t => t.id === s.data.teamId)) {
          s.data.teamId = undefined;
        }
      }
    });
    broadcast();
  });

  socket.on('join-team', ({ teamId, playerName }) => {
    // Cancel any disconnect timers for this player and update socket ID
    let reconnected = false;
    for (const [key, timer] of Object.entries(disconnectTimers)) {
      if (key.endsWith(`-${playerName}`)) {
        clearTimeout(timer.timeoutId);
        const oldSid = timer.oldSocketId;
        const sameTeam = key === `${teamId}-${playerName}`;
        if (sameTeam) {
          // Reconnect to same team: update socket ID in place
          game.teams.forEach(t => {
            t.members.forEach(m => { if (m.socketId === oldSid) m.socketId = socket.id; });
          });
          reconnected = true;
        } else {
          // Switching teams: remove from old team
          game.teams.forEach(t => {
            t.members = t.members.filter(m => m.socketId !== oldSid);
          });
        }
        delete disconnectTimers[key];
      }
    }
    if (reconnected) {
      socket.data.teamId = teamId;
      socket.data.playerName = playerName;
      socket.emit('team-msg-history', game.teamMessages[teamId] || []);
      broadcast();
      return;
    }

    // Normal join: remove from any current team first
    game.teams.forEach(t => {
      t.members = t.members.filter(m => m.socketId !== socket.id);
    });
    const team = game.teams.find(t => t.id === teamId);
    if (team && team.members.length < 2) {
      team.members.push({ socketId: socket.id, name: playerName, index: team.members.length });
      socket.data.teamId = teamId;
      socket.data.playerName = playerName;
      socket.emit('team-msg-history', game.teamMessages[teamId] || []);
    }
    broadcast();
  });

  // ---- Team Chat (persistent) ----
  socket.on('team-msg-send', message => {
    const teamId = socket.data.teamId;
    if (teamId === undefined || !socket.data.playerName) return;
    const msg = String(message).trim().slice(0, 200);
    if (!msg) return;
    if (!game.teamMessages[teamId]) game.teamMessages[teamId] = [];
    const entry = { playerName: socket.data.playerName, message: msg, timestamp: Date.now() };
    game.teamMessages[teamId].push(entry);
    io.fetchSockets().then(sockets => {
      for (const s of sockets) {
        if (s.data.teamId === teamId || s.data.role === 'host') {
          s.emit('team-msg-new', { teamId, ...entry });
        }
      }
    });
  });

  // ---- Game Flow ----
  socket.on('start-game', (filename) => {
    const data = loadQuestions(filename);
    game.categories = data.categories;
    const pts = [200, 300, 400, 500, 600];
    game.board = [];
    for (let r = 0; r < 5; r++) {
      game.board[r] = [];
      for (let c = 0; c < 5; c++) {
        game.board[r][c] = { points: pts[r], used: false };
      }
    }
    // Daily Double: random cell
    const ddRow = Math.floor(Math.random() * 5);
    const ddCol = Math.floor(Math.random() * 5);
    game.dailyDouble = { row: ddRow, col: ddCol };
    game.board[ddRow][ddCol].dailyDouble = true;
    // Jokers: each team gets double + block
    game.jokers = {};
    game.teams.forEach(t => { game.jokers[t.id] = { double: true, block: true }; });
    game.answerHistory = [];
    game.phase = 'board';
    game.currentTeamIndex = 0;
    broadcast();
  });

  socket.on('select-question', ({ row, col }) => {
    if (game.phase !== 'board') return;
    if (!game.board[row] || !game.board[row][col]) return;
    const cell = game.board[row][col];
    if (cell.used) return;
    if (!game.categories[col] || !game.categories[col].questions[row]) return;
    const q = game.categories[col].questions[row];
    game.currentQuestion = {
      ...q, row, col,
      points: cell.points,
      category: game.categories[col].name,
    };
    game.buzzes = [];
    game.buzzerLocked = false;
    game.buzzerOut = [];
    game.teamAnswers = {};
    game.teamChat = {};
    game.chatRevealed = [];
    game.revealedAnswers = [];
    game.lineupRevealed = 0;
    // Don't reset activeJokers here — jokers are set during board phase before question selection
    if (game.timerId) { clearTimeout(game.timerId); game.timerId = null; }
    game.timerExpired = false;
    game.dailyDoubleWager = null;
    game.dailyDoubleTeam = null;

    // Check Daily Double
    if (cell.dailyDouble) {
      game.phase = 'dailyDouble';
      game.dailyDoubleTeam = game.currentTeamIndex;
      io.emit('sfx', 'dailyDouble');
    } else {
      game.phase = 'question';
      io.emit('sfx', 'select');
    }
    broadcast();
  });

  // ---- Jokers (must be used during board phase, before selecting a question) ----
  socket.on('use-joker', ({ type, targetTeamId }) => {
    if (game.phase !== 'board') return;
    const teamId = socket.data.teamId;
    if (teamId === undefined) return;
    if (!game.jokers[teamId]) return;
    if (type === 'double' && game.jokers[teamId].double) {
      game.jokers[teamId].double = false;
      game.activeJokers.double = teamId;
      io.emit('sfx', 'joker');
      broadcast();
    } else if (type === 'block' && game.jokers[teamId].block && targetTeamId !== undefined) {
      game.jokers[teamId].block = false;
      game.activeJokers.blocked = targetTeamId;
      io.emit('sfx', 'joker');
      broadcast();
    }
  });

  // ---- Daily Double Wager ----
  socket.on('daily-double-wager', wager => {
    if (game.phase !== 'dailyDouble') return;
    const teamId = socket.data.teamId;
    const team = game.teams[game.dailyDoubleTeam];
    if (!team || team.id !== teamId) return;
    game.dailyDoubleWager = Math.max(0, Math.min(Number(wager) || 0, Math.max(team.score, game.currentQuestion?.points || 600)));
    game.phase = 'question';
    broadcast();
  });

  // ---- Volume ----
  socket.on('set-volume', vol => {
    game.volume = Math.max(0, Math.min(1, Number(vol) || 1));
    io.emit('set-volume', game.volume);
  });

  // ---- Lineup: reveal next hint ----
  socket.on('lineup-next', () => {
    if (!game.currentQuestion || game.currentQuestion.type !== 'lineup') return;
    const hints = game.currentQuestion.hints || [];
    if (game.lineupRevealed < hints.length) {
      game.lineupRevealed++;
      broadcast();
    }
  });

  // ---- Buzzer ----
  socket.on('buzz', () => {
    if (game.phase !== 'question') return;
    if (game.timerExpired) return;
    const t = game.currentQuestion?.type;
    if (t !== 'buzzer' && t !== 'lineup') return;
    if (game.buzzerLocked) return;
    if (game.buzzerOut.includes(socket.id)) return;
    // Blocked by joker?
    if (game.activeJokers.blocked === socket.data.teamId) return;
    game.buzzes.push({
      socketId: socket.id,
      teamId: socket.data.teamId,
      playerName: socket.data.playerName,
      timestamp: Date.now(),
    });
    game.buzzerLocked = true;
    io.emit('buzzer-locked', {
      teamId: socket.data.teamId,
      playerName: socket.data.playerName,
    });
  });

  socket.on('buzzer-unlock', () => {
    if (socket.data.role !== 'host') return;
    const bt = game.currentQuestion?.type;
    if (bt !== 'buzzer' && bt !== 'lineup') return;
    const lastBuzz = game.buzzes[game.buzzes.length - 1];
    if (lastBuzz) game.buzzerOut.push(lastBuzz.socketId);
    game.buzzerLocked = false;
    io.emit('buzzer-unlocked', { buzzerOut: game.buzzerOut });
  });

  // ---- Submit team answer (estimate / map) ----
  socket.on('submit-team-answer', value => {
    if (game.phase !== 'question') return;
    if (game.timerExpired) return;
    const teamId = socket.data.teamId;
    if (teamId === undefined) return;
    if (game.teamAnswers[teamId]?.submitted) return;
    // Only the designated answerer can submit
    const team = getTeamOfSocket(socket.id);
    const answerIdx = getAnswerPlayerIndex(game.currentQuestion, team);
    if (getMemberIndex(socket.id) !== answerIdx) return;
    game.teamAnswers[teamId] = { value, submitted: true };
    broadcast();
  });

  // ---- Chat ----
  socket.on('chat-send', message => {
    if (game.phase !== 'question') return;
    if (game.timerExpired) return;
    if (!game.currentQuestion || game.currentQuestion.type !== 'chat') return;
    const teamId = socket.data.teamId;
    if (teamId === undefined) return;
    if (game.teamChat[teamId]?.sent) return;
    const team = getTeamOfSocket(socket.id);
    const answerIdx = getAnswerPlayerIndex(game.currentQuestion, team);
    if (getMemberIndex(socket.id) !== answerIdx) return;
    game.teamChat[teamId] = { message, sent: true, playerName: socket.data.playerName };
    broadcast();
  });

  socket.on('reveal-chat', teamId => {
    if (!game.chatRevealed.includes(teamId)) {
      game.chatRevealed.push(teamId);
    }
    broadcast();
  });

  socket.on('reveal-team-answer', teamId => {
    if (!game.revealedAnswers.includes(teamId)) {
      game.revealedAnswers.push(teamId);
    }
    const q = game.currentQuestion;
    const ta = game.teamAnswers[teamId];
    const tc = game.teamChat[teamId];
    io.emit('reveal-team-answer', {
      teamId,
      team: game.teams.find(t => t.id === teamId),
      value: q?.type === 'chat' ? tc?.message : ta?.value,
      type: q?.type,
    });
  });

  // ---- Emoji Reactions ----
  socket.on('emoji-react', emoji => {
    if (!emoji || typeof emoji !== 'string') return;
    const safe = emoji.slice(0, 4); // max 4 chars (1-2 emojis)
    io.emit('emoji-react', { emoji: safe, teamColor: getTeamOfSocket(socket.id)?.color || '#fff' });
  });

  // ---- Media control (host controls board playback) ----
  socket.on('media-control', action => {
    io.emit('media-control', action); // 'play' | 'pause'
  });

  // ---- Timer ----
  socket.on('start-timer', seconds => {
    if (game.timerId) clearTimeout(game.timerId);
    game.timerExpired = false;
    io.emit('start-timer', seconds);
    game.timerId = setTimeout(() => {
      game.timerExpired = true;
      game.timerId = null;
      // Lock buzzer when timer expires
      game.buzzerLocked = true;
      // Auto-submit empty answers for teams that haven't submitted
      for (const team of game.teams) {
        if (!game.teamAnswers[team.id]?.submitted && game.currentQuestion) {
          const t = game.currentQuestion.type;
          if (t === 'estimate' || t === 'map') {
            game.teamAnswers[team.id] = { value: game.teamAnswers[team.id]?.value || null, submitted: true };
          }
        }
        if (!game.teamChat[team.id]?.sent && game.currentQuestion?.type === 'chat') {
          game.teamChat[team.id] = { message: '', sent: true, playerName: '(Zeit abgelaufen)' };
        }
      }
      broadcast();
    }, seconds * 1000);
  });
  socket.on('stop-timer', () => {
    if (game.timerId) { clearTimeout(game.timerId); game.timerId = null; }
    io.emit('stop-timer');
  });

  // ---- Host Controls ----
  socket.on('award-points', ({ teamId, points }) => {
    if (socket.data.role !== 'host') return;
    const team = game.teams.find(t => t.id === teamId);
    if (team) {
      let multiplier = 1;
      // Auto-double for last 3 remaining questions on the board
      if (getRemainingQuestions() <= 3) multiplier = 2;
      // Joker double stacks on top (so last-3 + joker = x4)
      if (game.activeJokers.double !== null) multiplier *= 2;
      if (game.dailyDoubleWager && team.id === game.teams[game.dailyDoubleTeam]?.id) {
        // Daily Double: use wager instead of question points (with multiplier)
        const wagerPts = points > 0 ? game.dailyDoubleWager * multiplier : -game.dailyDoubleWager * multiplier;
        team.score += wagerPts;
        io.emit('score-change', { teamId, delta: wagerPts, teamColor: team.color, teamName: team.name });
      } else {
        const finalPts = points * multiplier;
        team.score += finalPts;
        io.emit('score-change', { teamId, delta: finalPts, teamColor: team.color, teamName: team.name });
      }
      io.emit('sfx', points > 0 ? 'correct' : 'wrong');
      broadcast();
    }
  });

  socket.on('show-answer', () => {
    if (socket.data.role !== 'host') return;
    if (!game.currentQuestion) return;
    io.emit('show-answer', {
      answer: game.currentQuestion.answer,
      target: game.currentQuestion.target,
    });
  });

  socket.on('show-map-results', () => {
    if (!game.currentQuestion) return;
    const answers = [];
    for (const [tid, ta] of Object.entries(game.teamAnswers)) {
      if (ta.submitted && ta.value?.lat) {
        const team = game.teams.find(t => t.id === Number(tid));
        answers.push({ teamId: Number(tid), teamName: team?.name, value: ta.value });
      }
    }
    io.emit('map-results', { answers, target: game.currentQuestion.target });
  });

  socket.on('close-question', () => {
    if (socket.data.role !== 'host') return;
    if (game.currentQuestion) {
      game.board[game.currentQuestion.row][game.currentQuestion.col].used = true;
      game.answerHistory.push({
        category: game.currentQuestion.category,
        points: game.currentQuestion.points,
        type: game.currentQuestion.type,
        answer: game.currentQuestion.answer,
        activeJokers: { ...game.activeJokers },
        dailyDouble: !!game.dailyDoubleWager,
      });
    }
    game.currentQuestion = null;
    game.phase = 'board';
    game.buzzes = [];
    game.buzzerLocked = false;
    game.buzzerOut = [];
    game.teamAnswers = {};
    game.teamChat = {};
    game.chatRevealed = [];
    game.revealedAnswers = [];
    game.lineupRevealed = 0;
    game.activeJokers = { double: null, blocked: null };
    if (game.timerId) { clearTimeout(game.timerId); game.timerId = null; }
    game.timerExpired = false;
    game.dailyDoubleWager = null;
    game.dailyDoubleTeam = null;
    game.currentTeamIndex = (game.currentTeamIndex + 1) % Math.max(game.teams.length, 1);
    broadcast();
  });

  socket.on('set-turn', idx => {
    game.currentTeamIndex = idx;
    broadcast();
  });

  socket.on('end-game', () => {
    if (socket.data.role !== 'host') return;
    game.phase = 'endscreen';
    broadcast();
  });

  socket.on('reset-game', () => {
    if (socket.data.role !== 'host') return;
    game.phase = 'lobby';
    game.categories = [];
    game.board = [];
    game.currentQuestion = null;
    game.currentTeamIndex = 0;
    game.buzzes = [];
    game.buzzerLocked = false;
    game.buzzerOut = [];
    game.teamAnswers = {};
    game.teamChat = {};
    game.chatRevealed = [];
    game.revealedAnswers = [];
    game.lineupRevealed = 0;
    game.jokers = {};
    game.activeJokers = { double: null, blocked: null };
    game.dailyDouble = null;
    game.dailyDoubleWager = null;
    game.dailyDoubleTeam = null;
    game.answerHistory = [];
    game.teams.forEach(t => { t.score = 0; });
    broadcast();
  });

  socket.on('disconnect', () => {
    // Grace period: don't remove player immediately (allows page refresh)
    const teamId = socket.data.teamId;
    const pName = socket.data.playerName;
    if (teamId === undefined || !pName) return;

    const timeoutId = setTimeout(() => {
      game.teams.forEach(t => {
        t.members = t.members.filter(m => m.socketId !== socket.id);
      });
      delete disconnectTimers[`${teamId}-${pName}`];
      broadcast();
    }, 15000); // 15 second grace period

    disconnectTimers[`${teamId}-${pName}`] = { timeoutId, oldSocketId: socket.id };
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nJeopardy Server auf http://localhost:${PORT}`);
  console.log(`  Board:  http://localhost:${PORT}/board.html`);
  console.log(`  Host:   http://localhost:${PORT}/host.html`);
  console.log(`  Player: http://localhost:${PORT}/player.html\n`);
});
