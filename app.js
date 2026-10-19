
'use strict';

// ── DOM refs ─────────────────────────────────────────────────────
const editor        = document.getElementById('editor');
const highlightPre  = document.getElementById('highlight-pre');
const gutter        = document.getElementById('gutter');
const symBody       = document.getElementById('symtable-body');
const fileInput     = document.getElementById('file-input');
// ── State ─────────────────────────────────────────────────────────
let currentFile = 'programa.pas';
let debTimer    = null;



// Lista de palavras reservadas usadas pelo realce de sintaxe (highlight)
const KEYWORDS_RE = [
  'program','begin','end','var','const','procedure','function',
  'if','then','else','while','do','repeat','until',
  'for','to','downto','break','continue',
  'integer','real','char','string',
  'or','and','not','div','mod',
  'writeln','write','readln','read',
  'true','false','record','type','array','of',
].join('|');

// Expressão regular única que identifica todos os tokens visualmente relevantes,
// em ordem de prioridade (comentários > strings > números > palavras-chave > operadores > pontuação).
// Grupos: 1=comentário // 2=comentário {} 3=comentário (*) 4=string 5=real 6=inteiro 7=palavra-chave 8=op2chars 9=op1char 10=pontuação
const HIGHLIGHT_RE = new RegExp(
  '(\\/\\/[^\\n]*)' +                          // 1: comentário de linha //
  '|(\\{[^}]*\\})' +                            // 2: comentário de bloco { }
  '|(\\(\\*[\\s\\S]*?\\*\\))' +                 // 3: comentário de bloco (* *)
  "|('[^'\\n]*')" +                             // 4: literal de texto 'string'
  '|(\\b\\d+\\.\\d+\\b)' +                      // 5: número real
  '|(\\b\\d+\\b)' +                             // 6: número inteiro
  '|(\\b(?:' + KEYWORDS_RE + ')\\b)' +          // 7: palavras reservadas
  '|(:=|<>|<=|>=)' +                            // 8: operadores de dois caracteres
  '|([=<>+\\-*/])' +                            // 9: operadores de um caractere
  '|([;:,.(\\)\\[\\]])',                        // 10: pontuação
  'gi'
);

// Escapa caracteres especiais de HTML para exibição segura no DOM
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Aplica realce de sintaxe ao código-fonte e retorna HTML com spans coloridos.
 * Percorre o código com HIGHLIGHT_RE e classifica cada trecho reconhecido.
 */
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

  // Texto restante após o último match
  if (last < code.length) result += escHtml(code.slice(last));
  return result;
}

function updateHighlight() {
  // A quebra de linha extra garante que a última linha tenha altura correta no <pre>
  highlightPre.innerHTML = syntaxHighlight(editor.value) + '\n';
  syncScroll();
}

/**
 * Sincroniza a posição de rolagem entre as três camadas do editor:
 * highlight-pre (colorida), error-pre (sublinhados) e gutter (números de linha).
 */
function syncScroll() {
  highlightPre.scrollTop  = editor.scrollTop;
  highlightPre.scrollLeft = editor.scrollLeft;
  const errPre = document.getElementById('error-pre');
  if (errPre) {
    errPre.scrollTop  = editor.scrollTop;
    errPre.scrollLeft = editor.scrollLeft;
  }
  gutter.scrollTop = editor.scrollTop;
}

editor.addEventListener('scroll', syncScroll);


// Atualiza o gutter (coluna de números de linha) contando as quebras de linha do editor
function updateGutter() {
  const n = (editor.value.match(/\n/g) || []).length + 1;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  gutter.textContent = s;
}


/**
 * Pipeline de compilação léxica:
 * 1. Executa o analisador léxico sobre o código-fonte atual.
 * 2. Atualiza a tabela de símbolos com os tokens encontrados.
 * 3. Renderiza o overlay de erros (sublinhado vermelho) sobre o editor.
 * Retorna a lista de erros léxicos.
 */
function compile() {
  try {
    const source = editor.value;
    const lexResult = Lexer.lexer(source);

    renderSymbolTable(lexResult.tokens);
    renderErrorOverlay(lexResult.errors, source);

    return lexResult.errors;
  } catch (e) {
    console.error(e);
    return [{ msg: e.message }];
  }
}


/**
 * Preenche a tabela de símbolos com os tokens do programa.
 * Cada linha da tabela é clicável e leva o cursor à linha correspondente no editor.
 * Tokens de erro recebem a classe CSS 'err-row' para destaque visual.
 */
function renderSymbolTable(tokens) {
  symBody.innerHTML = '';
  if (!tokens.length) {
    symBody.innerHTML = '<tr><td colspan="4" class="tbl-placeholder">Nenhum token encontrado</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  let n = 1;

  for (const t of tokens) {
    const tr = document.createElement('tr');
    if (t.error) tr.classList.add('err-row');

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

  // Rola automaticamente para o fim da tabela após cada atualização
  const wrap = document.getElementById('symtable-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}


function renderErrorOverlay(errors, source) {
  const errPre = document.getElementById('error-pre');
  if (!errPre) return;

  const linhas = source.split('\n');
  // Agrupa os erros por índice de linha (base 0) para montagem eficiente do HTML
  const mapaErros = [];

  for (const e of errors) {
    if (!e.line || e.line > linhas.length) continue;
    const lIdx = e.line - 1;
    if (!mapaErros[lIdx]) mapaErros[lIdx] = [];
    const comprimento = e.lexema ? e.lexema.length : 1;
    mapaErros[lIdx].push({ col: e.col, len: comprimento });
  }

  let html = '';
  for (let i = 0; i < linhas.length; i++) {
    const linhaTxt = linhas[i];
    if (!mapaErros[i]) {
      // Linha sem erros: texto normal (transparente no overlay)
      html += escHtml(linhaTxt) + '\n';
      continue;
    }
    // Ordena erros da linha da esquerda para a direita
    mapaErros[i].sort((a, b) => a.col - b.col);
    let colAtual = 1;
    let linhaHtml = '';
    for (const err of mapaErros[i]) {
      if (err.col < colAtual) continue;
      // Texto antes do erro (sem sublinhado)
      linhaHtml += escHtml(linhaTxt.substring(colAtual - 1, err.col - 1));
      // Trecho com erro (sublinhado ondulado vermelho)
      let trechoErro = linhaTxt.substring(err.col - 1, err.col - 1 + err.len);
      if (!trechoErro) trechoErro = ' '; // garante ao menos um caractere sublinhado
      linhaHtml += `<span class="err-squiggle">${escHtml(trechoErro)}</span>`;
      colAtual = err.col + err.len;
    }
    // Restante da linha após o último erro
    linhaHtml += escHtml(linhaTxt.substring(colAtual - 1));
    html += linhaHtml + '\n';
  }
  errPre.innerHTML = html;
}


function jumpToLine(lineNum) {
  if (!lineNum || lineNum < 1) return;
  const linhas = editor.value.split('\n');
  let charPos  = 0;
  const alvo   = Math.min(lineNum - 1, linhas.length - 1);
  for (let i = 0; i < alvo; i++) charPos += linhas[i].length + 1;
  editor.focus();
  editor.setSelectionRange(charPos, charPos + (linhas[alvo] || '').length);
  const alturaLinha = parseFloat(getComputedStyle(editor).lineHeight) || 19;
  editor.scrollTop  = Math.max(0, (alvo - 3) * alturaLinha);
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


/**
 * Executado ao clicar no botão "Compilar".
 * Se houver erros léxicos, exibe alerta e interrompe.
 * Caso contrário, remove comentários e espaços desnecessários do código.
 */
function handleExplicitCompile() {
  const errors = compile();

  // Bloqueia a compilação se houver tokens inválidos
  if (erros && erros.length > 0) {
    alert('Foram encontrados erros no código. Verifique os tokens sublinhados em vermelho.');
    return;
  }

  let codigo = editor.value;

  // Remove comentários de linha: // até o fim da linha
  codigo = codigo.replace(/\/\/.*$/gm, '');

  // Remove comentários de bloco: { ... }
  codigo = codigo.replace(/\{[\s\S]*?\}/g, '');

  // Remove comentários de bloco: (* ... *)
  codigo = codigo.replace(/\(\*[\s\S]*?\*\)/g, '');

  // Remove espaços no início de cada linha (indentação)
  codigo = codigo.replace(/^[ \t]+/gm, '');

  // Remove espaços no final de cada linha
  codigo = codigo.replace(/[ \t]+$/gm, '');

  // Remove linhas completamente em branco
  codigo = codigo.replace(/^\s*[\r\n]/gm, '');

  editor.value = codigo;
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
}

function openFile() { fileInput.click(); }

// Faz o download do conteúdo atual do editor como arquivo de texto
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

// ── Listeners dos menus e botões da barra de ferramentas ──────────
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


// ── Inicialização com programa de exemplo ─────────────────────────
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
