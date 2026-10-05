
'use strict';

// ── DOM refs ─────────────────────────────────────────────────────
const editor        = document.getElementById('editor');
const highlightPre  = document.getElementById('highlight-pre');
const gutter        = document.getElementById('gutter');
const symBody       = document.getElementById('symtable-body');
const errBody       = document.getElementById('errtable-body');
const treeContainer = document.getElementById('tree-container');
const tabSymbols    = document.getElementById('tab-symbols');
const tabTree       = document.getElementById('tab-tree');
const panelSym      = document.getElementById('panel-symbols');
const panelTree     = document.getElementById('panel-tree');
const fileInput     = document.getElementById('file-input');
// ── State ─────────────────────────────────────────────────────────
let currentFile = 'programa.pas';
let debTimer    = null;


const KEYWORDS_RE = [
  'program','begin','end','var','const','procedure','function',
  'if','then','else','while','do','repeat','until',
  'for','to','downto','break','continue',
  'integer','real','char','string',
  'or','and','not','div','mod',
  'writeln','write','readln','read',
  'true','false','record','type','array','of',
].join('|');

// Single regex that matches all meaningful tokens in priority order.
// Groups: 1=lineComment 2=blockCmt1 3=blockCmt2 4=string 5=real 6=int 7=keyword 8=op2 9=op1 10=pun
const HIGHLIGHT_RE = new RegExp(
  '(\\/\\/[^\\n]*)' +                          // 1: // comment
  '|(\\{[^}]*\\})' +                            // 2: { comment }
  '|(\\(\\*[\\s\\S]*?\\*\\))' +                 // 3: (* comment *)
  "|('[^'\\n]*')" +                             // 4: 'string'
  '|(\\b\\d+\\.\\d+\\b)' +                      // 5: real number
  '|(\\b\\d+\\b)' +                             // 6: integer
  '|(\\b(?:' + KEYWORDS_RE + ')\\b)' +          // 7: keywords
  '|(:=|<>|<=|>=)' +                            // 8: two-char operators
  '|([=<>+\\-*/])' +                            // 9: single-char operators
  '|([;:,.(\\)\\[\\]])',                        // 10: punctuation
  'gi'
);

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function syntaxHighlight(code) {
  let result = '';
  let last   = 0;
  let m;
  HIGHLIGHT_RE.lastIndex = 0;

  while ((m = HIGHLIGHT_RE.exec(code)) !== null) {
    if (m.index > last) result += escHtml(code.slice(last, m.index));

    const tok = m[0];
    let cls;
    if      (m[1] || m[2] || m[3]) cls = 'hl-cmt';
    else if (m[4])                  cls = 'hl-str';
    else if (m[5] || m[6])         cls = 'hl-num';
    else if (m[7])                  cls = 'hl-kw';
    else if (m[8] || m[9])         cls = 'hl-op';
    else                            cls = 'hl-pun';

    result += `<span class="${cls}">${escHtml(tok)}</span>`;
    last = HIGHLIGHT_RE.lastIndex;
  }

  if (last < code.length) result += escHtml(code.slice(last));
  return result;
}

function updateHighlight() {
  // Trailing newline ensures last line has correct height in pre
  highlightPre.innerHTML = syntaxHighlight(editor.value) + '\n';
  syncScroll();
}

function syncScroll() {
  highlightPre.scrollTop  = editor.scrollTop;
  highlightPre.scrollLeft = editor.scrollLeft;
  const errPre = document.getElementById('error-pre');
  if (errPre) {
    errPre.scrollTop  = editor.scrollTop;
    errPre.scrollLeft = editor.scrollLeft;
  }
  gutter.scrollTop        = editor.scrollTop;
}

editor.addEventListener('scroll', syncScroll);


function updateGutter() {
  const n = (editor.value.match(/\n/g) || []).length + 1;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  gutter.textContent = s;
}


function compile() {
  try {
    const source = editor.value;
    const lexResult = Lexer.lexer(source);
    const parseResult = Parser.parse(lexResult.tokens);

    const allErrors = lexResult.errors.concat(parseResult.errors || []);
    const warnings = parseResult.warnings || [];
    allErrors.sort((a, b) => a.line === b.line ? a.col - b.col : a.line - b.line);

    const combinedTokens = [
      ...Lexer.PREDEFINED_SYMBOLS,
      ...lexResult.tokens
    ];

    renderSymbolTable(combinedTokens);
    renderErrors(allErrors, warnings);
    renderDerivationTree(parseResult.tree);
    renderErrorOverlay(allErrors, warnings, source);
    
    return allErrors;
  } catch (e) {
    console.error(e);
    errBody.innerHTML =
      `<tr><td colspan="2" class="msg-error">Erro interno: ${escHtml(e.message)}</td></tr>`;
    return [{ msg: e.message }];
  }
}


let hasScrolledToSourceTokens = false;

function renderSymbolTable(tokens) {
  symBody.innerHTML = '';
  if (!tokens.length) {
    symBody.innerHTML = '<tr><td colspan="4" class="tbl-placeholder">Nenhum token encontrado</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  let n = 1;
  let firstSourceRow = null;

  for (const t of tokens) {
    const tr = document.createElement('tr');
    if (t.error) tr.classList.add('err-row');
    if (t.line === '-') {
      tr.classList.add('predef-row');
    } else if (!firstSourceRow) {
      firstSourceRow = tr;
    }

    [n++, t.line, t.token, t.lexema].forEach(v => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : String(v);
      tr.appendChild(td);
    });
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => jumpToLine(t.line));
    frag.appendChild(tr);
  }
  symBody.appendChild(frag);

  if (!hasScrolledToSourceTokens && firstSourceRow) {
    setTimeout(() => {
      const wrap = document.getElementById('symtable-wrap');
      if (wrap) {
        wrap.scrollTop = firstSourceRow.offsetTop - wrap.offsetTop;
      }
    }, 10);
    hasScrolledToSourceTokens = true;
  }
}


function renderErrors(errors, warnings = []) {
  errBody.innerHTML = '';
  if (!errors.length && !warnings.length) {
    errBody.innerHTML = '<tr><td colspan="2" class="msg-ok">Nenhum erro encontrado</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  const buildRow = (e, isWarn) => {
    const tr = document.createElement('tr');
    tr.className = isWarn ? 'warn-row' : 'err-row';
    const tl = document.createElement('td');
    const tm = document.createElement('td');
    tl.textContent = `Linha ${e.line}, Col ${e.col}`;
    tm.textContent = (isWarn ? '[Aviso] ' : '') + (e.msg || `Token inválido: "${e.lexema}"`);
    tr.append(tl, tm);
    tr.addEventListener('click', () => jumpToLine(e.line));
    frag.appendChild(tr);
  };
  for (const e of errors) buildRow(e, false);
  for (const w of warnings) buildRow(w, true);
  errBody.appendChild(frag);
}


function renderErrorOverlay(errors, warnings, source) {
  const errPre = document.getElementById('error-pre');
  if (!errPre) return;
  const lines = source.split('\n');
  const errorMap = [];

  const add = (list, isWarn) => {
    for (const e of list) {
      if (!e.line || e.line > lines.length) continue;
      const lIdx = e.line - 1;
      if (!errorMap[lIdx]) errorMap[lIdx] = [];
      const len = e.lexema ? e.lexema.length : 1;
      errorMap[lIdx].push({ col: e.col, len, isWarn });
    }
  };
  add(errors, false);
  add(warnings, true);

  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const lineStr = lines[i];
    if (!errorMap[i]) {
      html += escHtml(lineStr) + '\n';
      continue;
    }
    errorMap[i].sort((a, b) => a.col - b.col);
    let colIdx = 1;
    let lineHtml = '';
    for (const err of errorMap[i]) {
      if (err.col < colIdx) continue;
      lineHtml += escHtml(lineStr.substring(colIdx - 1, err.col - 1));
      let errText = lineStr.substring(err.col - 1, err.col - 1 + err.len);
      if (!errText) errText = ' '; // if error at EOF
      const cls = err.isWarn ? 'warn-squiggle' : 'err-squiggle';
      lineHtml += `<span class="${cls}">${escHtml(errText)}</span>`;
      colIdx = err.col + err.len;
    }
    lineHtml += escHtml(lineStr.substring(colIdx - 1));
    html += lineHtml + '\n';
  }
  errPre.innerHTML = html;
}


function renderDerivationTree(tree) {
  treeContainer.innerHTML = '';
  treeContainer.appendChild(buildTreeDOM(tree, true));
}

/**
 * Builds an interactive DOM tree from a ParseNode.
 * @param {{ name:string, children:any[] }} node
 * @param {boolean} expanded  — start expanded?
 */
function buildTreeDOM(node, expanded = true) {
  if (!node) return document.createTextNode('');

  const hasChildren = node.children && node.children.length > 0;
  const wrapper = document.createElement('div');
  wrapper.className = hasChildren ? 'tree-node' : 'tree-node tree-leaf';

  // Label row
  const label = document.createElement('div');
  label.className = 'tree-label';

  // Toggle icon
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = hasChildren ? (expanded ? '▼' : '▶') : '◦';
  label.appendChild(toggle);

  // Node name (may contain HTML spans from the parser)
  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-name';
  nameSpan.innerHTML = node.name; // safe: parser uses escapeHtml internally
  label.appendChild(nameSpan);

  wrapper.appendChild(label);

  if (hasChildren) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children' + (expanded ? '' : ' collapsed');

    // Only expand top 3 levels by default
    const childExpanded = expanded; // same level propagation simplified

    for (const child of node.children) {
      if (child) childrenDiv.appendChild(buildTreeDOM(child, false));
    }

    wrapper.appendChild(childrenDiv);

    label.addEventListener('click', () => {
      const collapsed = childrenDiv.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▶' : '▼';
    });
  }

  return wrapper;
}


function jumpToLine(lineNum) {
  if (!lineNum || lineNum < 1) return;
  const lines  = editor.value.split('\n');
  let charPos  = 0;
  const target = Math.min(lineNum - 1, lines.length - 1);
  for (let i = 0; i < target; i++) charPos += lines[i].length + 1;
  editor.focus();
  editor.setSelectionRange(charPos, charPos + (lines[target] || '').length);
  const lineH = parseFloat(getComputedStyle(editor).lineHeight) || 19;
  editor.scrollTop = Math.max(0, (target - 3) * lineH);
  syncScroll();
}


editor.addEventListener('input', () => {
  updateGutter();
  updateHighlight();
  scheduleAnalysis();
});

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart;
    const v = editor.value;
    editor.value = v.slice(0, s) + '    ' + v.slice(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = s + 4;
    updateHighlight();
    scheduleAnalysis(80);
  }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newFile(); }
});

function scheduleAnalysis(ms) {
  clearTimeout(debTimer);
  debTimer = setTimeout(compile, ms != null ? ms : 500);
}


tabSymbols.addEventListener('click', () => {
  tabSymbols.classList.add('active');   tabTree.classList.remove('active');
  panelSym.classList.add('active');     panelTree.classList.remove('active');
});
tabTree.addEventListener('click', () => {
  tabTree.classList.add('active');      tabSymbols.classList.remove('active');
  panelTree.classList.add('active');    panelSym.classList.remove('active');
});


function handleExplicitCompile() {
  const allErrors = compile();
  
  // Verifica se há erros (ignorando warnings que tem isWarning == true)
  if (allErrors && allErrors.some(e => !e.isWarning)) {
    alert('Foram encontrados erros no código. Verifique o painel inferior para mais detalhes.');
    return;
  }
  
  let code = editor.value;
  
  // 1. Remove single line comments
  code = code.replace(/\/\/.*$/gm, '');
  
  // 2. Remove multi-line comments { ... }
  code = code.replace(/\{[\s\S]*?\}/g, '');
  
  // 3. Remove multi-line comments (* ... *)
  code = code.replace(/\(\*[\s\S]*?\*\)/g, '');
  
  // 4. Remove linhas em branco e espaços de indentação
  code = code.replace(/^[ \t]+/gm, ''); // espaços no início (indentação)
  code = code.replace(/[ \t]+$/gm, ''); // espaços no fim
  code = code.replace(/^\s*[\r\n]/gm, ''); // linhas em branco
  
  editor.value = code;
  updateGutter();
  updateHighlight();
  compile();
}

document.getElementById('btn-compile').addEventListener('click', handleExplicitCompile);


function newFile() {
  if (editor.value.trim() && !confirm('Descartar alterações?')) return;
  editor.value = '';
  currentFile = 'programa.pas';
  updateGutter(); updateHighlight();
  symBody.innerHTML = '<tr><td colspan="4" class="tbl-placeholder">Nenhum token</td></tr>';
  errBody.innerHTML = '<tr><td colspan="2" class="msg-neutral">Clique em Compilar para analisar</td></tr>';
  treeContainer.innerHTML = '<div class="tree-placeholder">Compile para gerar a árvore de derivação.</div>';
}

function openFile() { fileInput.click(); }

function saveFile() {
  const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: currentFile });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  currentFile = file.name;
  const reader = new FileReader();
  reader.onload = ev => {
    editor.value = ev.target.result;
    updateGutter(); updateHighlight(); compile();
  };
  reader.readAsText(file, 'UTF-8');
  fileInput.value = '';
});

document.getElementById('menu-new').addEventListener('click', newFile);
document.getElementById('menu-open').addEventListener('click', openFile);
document.getElementById('menu-save').addEventListener('click', saveFile);
document.getElementById('menu-exit').addEventListener('click', () => {
  if (!editor.value.trim() || confirm('Deseja sair?')) window.close();
});
document.getElementById('menu-undo').addEventListener('click', () => document.execCommand('undo'));
document.getElementById('menu-redo').addEventListener('click', () => document.execCommand('redo'));
document.getElementById('menu-selall').addEventListener('click', () => { editor.focus(); editor.select(); });
document.getElementById('tb-new').addEventListener('click', newFile);
document.getElementById('tb-save').addEventListener('click', saveFile);
document.getElementById('tb-undo').addEventListener('click', () => document.execCommand('undo'));
document.getElementById('tb-redo').addEventListener('click', () => document.execCommand('redo'));




editor.value = `program Exemplo;
var
  A, B : integer;
  x    : real;
begin
  A := 1;
  B := 3;
  while x < 10 do
    x := 1;
end.
`;
updateGutter();
updateHighlight();
compile();
