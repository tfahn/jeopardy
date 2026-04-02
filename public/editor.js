const app = document.getElementById('app');
const statusEl = document.getElementById('status');
const POINTS = [200, 300, 400, 500, 600];
const TYPES = ['buzzer', 'estimate', 'map', 'chat', 'lineup'];
const TYPE_LABELS = { buzzer: 'Buzzer', estimate: 'Schätzfrage', map: 'Karte', chat: 'Chat / Emoji', lineup: '7ineup' };
const TYPE_COLORS = { buzzer: 'var(--red)', estimate: 'var(--orange)', map: 'var(--green)', chat: '#8e44ad', lineup: '#16a085' };
const CONTENT_ICONS = { text: '📝', image: '🖼️', audio: '🔊', video: '🎬' };

let currentFile = null;
let board = { categories: [] };
let activeCategory = 0;

// ==================== Helpers ====================
function getQ(qi) {
  return board.categories[activeCategory]?.questions[qi];
}

function getBlocks(qi) {
  const q = getQ(qi);
  if (!q) return [];
  if (!Array.isArray(q.content)) q.content = [q.content || { type: 'text', text: '' }];
  return q.content;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function status(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = 'status-msg' + (isError ? ' error' : '');
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

// ==================== Init / Load ====================
async function init() {
  const files = await fetch('/api/boards').then(r => r.json());
  if (files.length > 0) await loadBoard(files[0]);
  else newBoard();
}

async function loadBoard(filename) {
  currentFile = filename;
  board = await fetch(`/api/boards/${filename}`).then(r => r.json());
  // Migrate: ensure content is always an array
  for (const cat of board.categories) {
    for (const q of cat.questions) {
      if (!Array.isArray(q.content)) q.content = [q.content || { type: 'text', text: '' }];
    }
  }
  activeCategory = 0;
  renderAll();
  status(`${filename} geladen`);
}

function newBoard() {
  currentFile = null;
  board = {
    categories: Array.from({ length: 5 }, (_, i) => emptyCategory(`Kategorie ${i + 1}`))
  };
  activeCategory = 0;
  renderAll();
  status('Neues Board erstellt');
}

function emptyCategory(name) {
  return {
    name: name || 'Neue Kategorie',
    questions: POINTS.map(() => ({
      type: 'buzzer',
      content: [{ type: 'text', text: '' }],
      answer: ''
    }))
  };
}

function emptyQuestion(type) {
  const q = { type, content: [{ type: 'text', text: '' }], answer: '' };
  if (type === 'estimate') q.answerPlayer = 0;
  if (type === 'map') { q.answerPlayer = 0; q.target = { lat: 0, lng: 0 }; }
  if (type === 'chat') { q.secret = ''; q.describerIndex = 0; }
  if (type === 'lineup') q.hints = ['', '', '', '', '', '', ''];
  return q;
}

// ==================== Save ====================
async function saveBoard() {
  let filename = currentFile;
  if (!filename) {
    const name = prompt('Dateiname (ohne .json):', 'board-neu');
    if (!name) return;
    filename = name.replace(/\.json$/, '') + '.json';
  }
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  try {
    await fetch(`/api/boards/${safe}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(board)
    });
    currentFile = safe;
    status(`${safe} gespeichert!`);
    renderAll();
  } catch (e) {
    status('Fehler beim Speichern!', true);
  }
}

async function deleteBoard() {
  if (!currentFile || !confirm(`"${currentFile}" wirklich löschen?`)) return;
  await fetch(`/api/boards/${currentFile}`, { method: 'DELETE' });
  status(`${currentFile} gelöscht`);
  currentFile = null;
  const files = await fetch('/api/boards').then(r => r.json());
  if (files.length > 0) await loadBoard(files[0]);
  else newBoard();
}

async function duplicateBoard() {
  const name = prompt('Name für die Kopie (ohne .json):', (currentFile || 'board').replace('.json', '') + '-kopie');
  if (!name) return;
  const filename = name.replace(/\.json$/, '') + '.json';
  await fetch(`/api/boards/${filename}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(board)
  });
  currentFile = filename;
  status(`Kopie als ${filename} gespeichert`);
  renderAll();
}

// ==================== Upload ====================
async function uploadFiles(qi, bi) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,audio/*,video/*';
  input.onchange = async () => {
    const form = new FormData();
    for (const f of input.files) form.append('files', f);
    status('Uploading...');
    const res = await fetch('/api/upload', { method: 'POST', body: form }).then(r => r.json());

    if (bi !== undefined) {
      // Replace existing block's media
      getBlocks(qi)[bi].media = res.files[0];
      renderAll();
    } else {
      // Add new blocks for each uploaded file
      const blocks = getBlocks(qi);
      for (const path of res.files) {
        const ext = path.split('.').pop().toLowerCase();
        let type = 'image';
        if (['mp3', 'ogg', 'wav', 'flac', 'aac', 'webm'].includes(ext)) type = 'audio';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) type = 'video';
        blocks.push({ type, media: path, text: '' });
      }
      renderAll();
    }
    status(`${res.files.length} Datei(en) hochgeladen`);
  };
  input.click();
}

// ==================== Render ====================
async function renderAll() {
  const files = await fetch('/api/boards').then(r => r.json());

  let html = `
    <div class="editor-header">
      <h1>Board Editor</h1>
      <div class="toolbar">
        <select id="file-select" onchange="loadBoard(this.value)">
          ${files.map(f => `<option value="${f}" ${f === currentFile ? 'selected' : ''} style="background:#1a1a5e;color:white;">${f.replace('.json', '')}</option>`).join('')}
        </select>
        <button class="btn btn-green btn-sm" onclick="newBoard()">+ Neu</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.1);color:var(--gray);" onclick="duplicateBoard()">Kopie</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.1);color:var(--gray);" onclick="exportBoard()">Export</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.1);color:var(--gray);" onclick="importBoard()">Import</button>
        ${currentFile ? `<button class="btn btn-red btn-sm" onclick="deleteBoard()">Löschen</button>` : ''}
        <input type="text" id="file-name" value="${(currentFile || 'board-neu.json').replace('.json', '')}"
          style="width:140px;" onchange="currentFile=this.value.replace(/\\.json$/,'')+'.json'" placeholder="Dateiname">
      </div>
    </div>
  `;

  // Category tabs
  html += '<div class="category-tabs">';
  board.categories.forEach((cat, i) => {
    html += `<div class="cat-tab ${i === activeCategory ? 'active' : ''}" onclick="activeCategory=${i};renderAll();">${esc(cat.name)}</div>`;
  });
  if (board.categories.length < 7) {
    html += `<div class="cat-tab cat-tab-add" onclick="addCategory()">+ Kategorie</div>`;
  }
  html += '</div>';

  const cat = board.categories[activeCategory];
  if (cat) {
    html += `
      <div class="cat-header">
        <input type="text" value="${esc(cat.name)}" oninput="board.categories[${activeCategory}].name=this.value; updateTab(${activeCategory}, this.value);" placeholder="Kategorie-Name">
        ${board.categories.length > 1 ? `<button class="delete-cat" onclick="removeCategory(${activeCategory})">Kategorie löschen</button>` : ''}
      </div>
    `;
    cat.questions.forEach((q, qi) => { html += renderQuestionCard(q, qi); });
    if (cat.questions.length < 7) {
      html += `<button class="add-btn" onclick="addQuestion()">+ Frage hinzufügen</button>`;
    }
  }

  html += '<div style="height:60px;"></div>';
  app.innerHTML = html;
}

function renderQuestionCard(q, qi) {
  const points = POINTS[qi] || (qi + 1) * 100;
  const typeColor = TYPE_COLORS[q.type] || 'var(--gray)';
  const blocks = Array.isArray(q.content) ? q.content : [q.content];

  // Content blocks
  let blocksHtml = '<div class="content-blocks">';
  blocks.forEach((block, bi) => {
    blocksHtml += `
      <div class="content-block" data-qi="${qi}" data-bi="${bi}">
        <div class="block-header">
          <span class="block-type-badge" style="background:${block.type === 'text' ? 'rgba(255,255,255,0.15)' : block.type === 'image' ? 'var(--blue-mid)' : block.type === 'audio' ? 'var(--orange)' : 'var(--red)'};">${CONTENT_ICONS[block.type] || '?'} ${block.type}</span>
          <div class="block-actions">
            ${bi > 0 ? `<button class="block-move" onclick="moveBlock(${qi},${bi},-1)">↑</button>` : ''}
            ${bi < blocks.length - 1 ? `<button class="block-move" onclick="moveBlock(${qi},${bi},1)">↓</button>` : ''}
            ${blocks.length > 1 ? `<button class="block-move" style="color:var(--red);" onclick="removeBlock(${qi},${bi})">×</button>` : ''}
          </div>
        </div>
        <div class="block-body">
    `;

    if (block.type === 'text') {
      blocksHtml += `<textarea placeholder="Text eingeben..." oninput="getBlocks(${qi})[${bi}].text=this.value">${esc(block.text || '')}</textarea>`;
    } else {
      // Media block: path + optional caption + preview
      blocksHtml += `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <input type="text" value="${esc(block.media || '')}" placeholder="Dateipfad oder hochladen →"
            oninput="getBlocks(${qi})[${bi}].media=this.value" style="flex:1;">
          <button class="btn btn-sm btn-blue" onclick="uploadFiles(${qi},${bi})">Upload</button>
        </div>
        <input type="text" value="${esc(block.text || '')}" placeholder="Beschriftung (optional)"
          oninput="getBlocks(${qi})[${bi}].text=this.value" style="font-size:13px;opacity:0.7;">
      `;
      // Blur option for images
      if (block.type === 'image') {
        blocksHtml += `
          <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;color:var(--gray);cursor:pointer;">
            <input type="checkbox" ${block.blur ? 'checked' : ''} onchange="getBlocks(${qi})[${bi}].blur=this.checked">
            Blur-Animation (30s unscharf → scharf)
          </label>`;
      }
      // Preview
      if (block.media) {
        if (block.type === 'image') {
          blocksHtml += `<img src="${esc(block.media)}" style="max-width:200px;max-height:100px;border-radius:6px;margin-top:6px;display:block;" onerror="this.style.display='none'">`;
        } else if (block.type === 'audio') {
          blocksHtml += `<audio controls src="${esc(block.media)}" style="width:100%;margin-top:6px;height:30px;"></audio>`;
        } else if (block.type === 'video') {
          blocksHtml += `<video src="${esc(block.media)}" style="max-width:200px;border-radius:6px;margin-top:6px;" muted></video>`;
        }
      }
    }

    blocksHtml += '</div></div>';
  });

  // Add block buttons
  blocksHtml += `
    <div class="add-block-row">
      <button class="add-block-btn" onclick="addBlock(${qi},'text')">+ Text</button>
      <button class="add-block-btn" onclick="addBlock(${qi},'image')">+ Bild</button>
      <button class="add-block-btn" onclick="addBlock(${qi},'audio')">+ Audio</button>
      <button class="add-block-btn" onclick="addBlock(${qi},'video')">+ Video</button>
      <button class="add-block-btn" style="border-color:var(--gold);color:var(--gold);" onclick="uploadFiles(${qi})">📁 Upload</button>
    </div>
  </div>`;

  // Type-specific fields
  let extraFields = '';

  // Answer
  extraFields += `
    <div class="q-row">
      <label>Antwort</label>
      <div class="field"><input type="text" value="${esc(q.answer || '')}" oninput="getQ(${qi}).answer=this.value"></div>
    </div>
  `;

  if (q.type === 'estimate' || q.type === 'map') {
    extraFields += `
      <div class="q-row">
        <label>Antwortet</label>
        <div class="field">
          <select onchange="getQ(${qi}).answerPlayer=Number(this.value)">
            <option value="0" ${q.answerPlayer === 0 ? 'selected' : ''}>Spieler 1</option>
            <option value="1" ${q.answerPlayer === 1 ? 'selected' : ''}>Spieler 2</option>
          </select>
        </div>
      </div>
    `;
  }

  if (q.type === 'map') {
    const t = q.target || { lat: 0, lng: 0 };
    extraFields += `
      <div class="q-row">
        <label>Koordinaten</label>
        <div class="field target-row">
          <input type="number" step="any" value="${t.lat}" placeholder="Lat" oninput="if(!getQ(${qi}).target)getQ(${qi}).target={lat:0,lng:0}; getQ(${qi}).target.lat=Number(this.value)">
          <input type="number" step="any" value="${t.lng}" placeholder="Lng" oninput="if(!getQ(${qi}).target)getQ(${qi}).target={lat:0,lng:0}; getQ(${qi}).target.lng=Number(this.value)">
        </div>
      </div>
    `;
  }

  if (q.type === 'chat') {
    extraFields += `
      <div class="q-row">
        <label>Geheimwort</label>
        <div class="field"><input type="text" value="${esc(q.secret || '')}" oninput="getQ(${qi}).secret=this.value"></div>
      </div>
      <div class="q-row">
        <label>Beschreiber</label>
        <div class="field">
          <select onchange="getQ(${qi}).describerIndex=Number(this.value)">
            <option value="0" ${(q.describerIndex || 0) === 0 ? 'selected' : ''}>Spieler 1</option>
            <option value="1" ${q.describerIndex === 1 ? 'selected' : ''}>Spieler 2</option>
          </select>
        </div>
      </div>
    `;
  }

  if (q.type === 'lineup') {
    const hints = q.hints || [];
    extraFields += `
      <div class="q-row">
        <label>Hinweise</label>
        <div class="field hints-list">
          ${hints.map((h, hi) => `
            <div class="hint-row">
              <span class="hint-num">${hi + 1}.</span>
              <input type="text" value="${esc(h)}" oninput="getQ(${qi}).hints[${hi}]=this.value" placeholder="Hinweis ${hi + 1}">
              <button class="hint-remove" onclick="removeHint(${qi}, ${hi})">×</button>
            </div>
          `).join('')}
          ${hints.length < 10 ? `<button class="add-btn" style="font-size:12px;padding:6px;" onclick="addHint(${qi})">+ Hinweis</button>` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="question-card" id="q-${qi}">
      <div class="q-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="q-points">${points}P</span>
          <select style="padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:${typeColor};color:white;font-size:12px;font-weight:700;" onchange="changeType(${qi}, this.value)">
            ${TYPES.map(t => `<option value="${t}" ${q.type === t ? 'selected' : ''} style="background:#1a1a5e;">${TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:4px;">
          ${qi > 0 ? `<button class="delete-q" onclick="moveQuestion(${qi}, -1)">↑</button>` : ''}
          ${qi < (board.categories[activeCategory]?.questions.length || 0) - 1 ? `<button class="delete-q" onclick="moveQuestion(${qi}, 1)">↓</button>` : ''}
          <button class="delete-q" onclick="removeQuestion(${qi})">×</button>
        </div>
      </div>
      ${blocksHtml}
      ${extraFields}
    </div>
  `;
}

// ==================== Content Block Actions ====================
function addBlock(qi, type) {
  const block = { type, text: '' };
  if (type !== 'text') block.media = '';
  getBlocks(qi).push(block);
  renderAll();
}

function removeBlock(qi, bi) {
  getBlocks(qi).splice(bi, 1);
  renderAll();
}

function moveBlock(qi, bi, dir) {
  const blocks = getBlocks(qi);
  const ni = bi + dir;
  if (ni < 0 || ni >= blocks.length) return;
  [blocks[bi], blocks[ni]] = [blocks[ni], blocks[bi]];
  renderAll();
}

// ==================== Question Actions ====================
function addCategory() {
  board.categories.push(emptyCategory(`Kategorie ${board.categories.length + 1}`));
  activeCategory = board.categories.length - 1;
  renderAll();
}

function removeCategory(i) {
  if (!confirm(`Kategorie "${board.categories[i].name}" wirklich löschen?`)) return;
  board.categories.splice(i, 1);
  if (activeCategory >= board.categories.length) activeCategory = Math.max(0, board.categories.length - 1);
  renderAll();
}

function updateTab(i, name) {
  const tabs = document.querySelectorAll('.cat-tab');
  if (tabs[i]) tabs[i].textContent = name;
}

function addQuestion() {
  board.categories[activeCategory]?.questions.push(emptyQuestion('buzzer'));
  renderAll();
}

function removeQuestion(qi) {
  board.categories[activeCategory].questions.splice(qi, 1);
  renderAll();
}

function moveQuestion(qi, dir) {
  const qs = board.categories[activeCategory].questions;
  const ni = qi + dir;
  if (ni < 0 || ni >= qs.length) return;
  [qs[qi], qs[ni]] = [qs[ni], qs[qi]];
  renderAll();
}

function changeType(qi, newType) {
  const q = getQ(qi);
  const old = q.type;
  q.type = newType;
  if (newType === 'estimate' && q.answerPlayer === undefined) q.answerPlayer = 0;
  if (newType === 'map') { if (!q.target) q.target = { lat: 0, lng: 0 }; if (q.answerPlayer === undefined) q.answerPlayer = 0; }
  if (newType === 'chat') { if (!q.secret) q.secret = ''; if (q.describerIndex === undefined) q.describerIndex = 0; }
  if (newType === 'lineup' && !q.hints) q.hints = ['', '', '', '', '', '', ''];
  if (old === 'lineup' && newType !== 'lineup') delete q.hints;
  if (old === 'chat' && newType !== 'chat') { delete q.secret; delete q.describerIndex; }
  if (old === 'map' && newType !== 'map') delete q.target;
  if ((old === 'estimate' || old === 'map') && newType !== 'estimate' && newType !== 'map') delete q.answerPlayer;
  renderAll();
}

function addHint(qi) {
  const q = getQ(qi);
  if (!q.hints) q.hints = [];
  q.hints.push('');
  renderAll();
}

function removeHint(qi, hi) {
  getQ(qi).hints.splice(hi, 1);
  renderAll();
}

// ==================== Export / Import ====================
function exportBoard() {
  const json = JSON.stringify(board, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentFile || 'board-export.json');
  a.click();
  URL.revokeObjectURL(url);
  status('Board exportiert');
}

function importBoard() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.categories || !Array.isArray(data.categories)) {
          status('Ungültiges Board-Format!', true);
          return;
        }
        board = data;
        // Migrate content to array format
        for (const cat of board.categories) {
          for (const q of cat.questions) {
            if (!Array.isArray(q.content)) q.content = [q.content || { type: 'text', text: '' }];
          }
        }
        currentFile = file.name.endsWith('.json') ? file.name : file.name + '.json';
        activeCategory = 0;
        renderAll();
        status(`"${file.name}" importiert — noch nicht gespeichert!`);
      } catch (err) {
        status('Fehler beim Lesen der Datei!', true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveBoard();
  }
});

init();
