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
};

function loadQuestions(filename) {
  const file = filename || 'board-1.json';
  // Sanitize: only allow alphanumeric, dash, underscore, dot
  const safe = file.replace(/[^a-zA-Z0-9._-]/g, '');
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', safe), 'utf8'));
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
// estimate/map: answerPlayer field, default 0
// chat: describerIndex field, default 0
function getAnswerPlayerIndex(q) {
  if (q.type === 'chat') return q.describerIndex ?? 0;
  return q.answerPlayer ?? 0;
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
      const answerIdx = getAnswerPlayerIndex(q);

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
    game.teams = teams.map((t, i) => ({
      id: i, name: t.name, color: t.color, score: 0, members: [],
    }));
    broadcast();
  });

  socket.on('join-team', ({ teamId, playerName }) => {
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
    game.phase = 'board';
    game.currentTeamIndex = 0;
    broadcast();
  });

  socket.on('select-question', ({ row, col }) => {
    if (game.phase !== 'board') return;
    const cell = game.board[row][col];
    if (cell.used) return;
    const q = game.categories[col].questions[row];
    game.currentQuestion = {
      ...q, row, col,
      points: cell.points,
      category: game.categories[col].name,
    };
    game.phase = 'question';
    io.emit('sfx', 'select');
    game.buzzes = [];
    game.buzzerLocked = false;
    game.buzzerOut = [];
    game.teamAnswers = {};
    game.teamChat = {};
    game.chatRevealed = [];
    game.revealedAnswers = [];
    game.lineupRevealed = 0;
    broadcast();
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
    const t = game.currentQuestion?.type;
    if (t !== 'buzzer' && t !== 'lineup') return;
    if (game.buzzerLocked) return;
    if (game.buzzerOut.includes(socket.id)) return;
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
    const teamId = socket.data.teamId;
    if (teamId === undefined) return;
    if (game.teamAnswers[teamId]?.submitted) return;
    // Only the designated answerer can submit
    const answerIdx = getAnswerPlayerIndex(game.currentQuestion);
    if (getMemberIndex(socket.id) !== answerIdx) return;
    game.teamAnswers[teamId] = { value, submitted: true };
    broadcast();
  });

  // ---- Chat ----
  socket.on('chat-send', message => {
    if (game.phase !== 'question') return;
    if (!game.currentQuestion || game.currentQuestion.type !== 'chat') return;
    const teamId = socket.data.teamId;
    if (teamId === undefined) return;
    if (game.teamChat[teamId]?.sent) return;
    const answerIdx = getAnswerPlayerIndex(game.currentQuestion);
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

  // ---- Media control (host controls board playback) ----
  socket.on('media-control', action => {
    io.emit('media-control', action); // 'play' | 'pause'
  });

  // ---- Timer ----
  socket.on('start-timer', seconds => {
    io.emit('start-timer', seconds);
  });
  socket.on('stop-timer', () => {
    io.emit('stop-timer');
  });

  // ---- Host Controls ----
  socket.on('award-points', ({ teamId, points }) => {
    const team = game.teams.find(t => t.id === teamId);
    if (team) {
      team.score += points;
      io.emit('sfx', points > 0 ? 'correct' : 'wrong');
      broadcast();
    }
  });

  socket.on('show-answer', () => {
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
    if (game.currentQuestion) {
      game.board[game.currentQuestion.row][game.currentQuestion.col].used = true;
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
    game.currentTeamIndex = (game.currentTeamIndex + 1) % Math.max(game.teams.length, 1);
    broadcast();
  });

  socket.on('set-turn', idx => {
    game.currentTeamIndex = idx;
    broadcast();
  });

  socket.on('disconnect', () => {
    game.teams.forEach(t => {
      t.members = t.members.filter(m => m.socketId !== socket.id);
    });
    broadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nJeopardy Server auf http://localhost:${PORT}`);
  console.log(`  Board:  http://localhost:${PORT}/board.html`);
  console.log(`  Host:   http://localhost:${PORT}/host.html`);
  console.log(`  Player: http://localhost:${PORT}/player.html\n`);
});
