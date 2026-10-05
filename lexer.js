/**
 * lexer.js — Analisador Léxico para dialeto Pascal (PascaLex)
 *
 * Tokens gerados:
 *  PROGRAM, BEGIN, END, VAR, CONST, PROCEDURE, FUNCTION,
 *  IF, THEN, ELSE, WHILE, DO, REPEAT, UNTIL, BREAK, CONTINUE,
 *  INTEGER, REAL, CHAR, STRING, OR, AND, NOT,
 *  IDENTIFICADOR, NUMERO_INTEIRO, NUMERO_REAL, LITERAL,
 *  OP_ATRIBUICAO (:=), OP_IGUAL (=), OP_DIFERENTE (<>),
 *  OP_MENOR (<), OP_MENOR_IGUAL (<=), OP_MAIOR (>), OP_MAIOR_IGUAL (>=),
 *  OP_MAIS (+), OP_MENOS (-), OP_MULT (*), OP_DIV (/),
 *  PONTO_VIRGULA (;), DOIS_PONTOS (:), VIRGULA (,),
 *  PONTO (.), ABRE_PAR ((), FECHA_PAR ()), ABRE_COL ([), FECHA_COL (]),
 *  NOVA_LINHA (token especial para newline conforme imagem de referência)
 */

'use strict';

const KEYWORDS = new Map([
  ['program',   'PROGRAM'],
  ['begin',     'BEGIN'],
  ['end',       'END'],
  ['var',       'VAR'],
  ['const',     'CONST'],
  ['procedure', 'PROCEDURE'],
  ['function',  'FUNCTION'],
  ['if',        'IF'],
  ['then',      'THEN'],
  ['else',      'ELSE'],
  ['while',     'WHILE'],
  ['do',        'DO'],
  ['repeat',    'REPEAT'],
  ['until',     'UNTIL'],
  ['for',       'FOR'],
  ['to',        'TO'],
  ['downto',    'DOWNTO'],
  ['break',     'BREAK'],
  ['continue',  'CONTINUE'],
  ['integer',   'INTEGER'],
  ['real',      'REAL'],
  ['char',      'CHAR'],
  ['string',    'STRING'],
  ['or',        'OU'],
  ['and',       'E'],
  ['not',       'NAO'],
  ['div',       'DIV'],
  ['mod',       'MOD'],
  ['true',      'VERDADEIRO'],
  ['false',     'FALSO'],
  ['record',    'REGISTRO'],
  ['type',      'TIPO'],
  ['array',     'VETOR'],
  ['of',        'DE'],
  ['writeln',   'WRITELN'],
  ['write',     'WRITE'],
  ['readln',    'READLN'],
  ['read',      'READ'],
]);


const PRE_SIMBOLOS = (() => {
  const rows = [];
  let id = 1;

  // Keywords
  for (const [lex, tok] of KEYWORDS) {
    rows.push({ id: id++, line: '-', token: tok, lexema: lex });
  }

  // Operators
  const ops = [
    [':=', 'OP_ATRIBUICAO'], ['=',  'OP_IGUAL'],
    ['<>', 'OP_DIFERENTE'],  ['<',  'OP_MENOR'],
    ['<=', 'OP_MENOR_IGUAL'],['>', 'OP_MAIOR'],
    ['>=', 'OP_MAIOR_IGUAL'],
    ['+',  'OP_MAIS'],       ['-',  'OP_MENOS'],
    ['*',  'OP_MULT'],       ['/',  'OP_DIV'],
  ];
  for (const [lex, tok] of ops) {
    rows.push({ id: id++, line: '-', token: tok, lexema: lex });
  }

  // Punctuation
  const puns = [
    [';', 'PONTO_VIRGULA'], [':', 'DOIS_PONTOS'],
    [',', 'VIRGULA'],       ['.', 'PONTO'],
    ['(', 'ABRE_PAR'],      [')', 'FECHA_PAR'],
    ['[', 'ABRE_COL'],      [']', 'FECHA_COL'],
  ];
  for (const [lex, tok] of puns) {
    rows.push({ id: id++, line: '-', token: tok, lexema: lex });
  }

  return rows;
})();


/**
 * @typedef {Object} Token
 * @property {number} id       – sequential id
 * @property {number} line     – 1-based line number
 * @property {number} col      – 1-based column number
 * @property {string} token    – token type name
 * @property {string} lexema   – actual text
 * @property {boolean} [error] – true if this is an error token
 * @property {string}  [msg]   – error message
 */

/**

 *
 * @param {string} source
 * @returns {{ tokens: Token[], errors: Token[], symbolTable: object[] }}
 */
function analisador(source) {
  const tokens  = [];
  const erros  = [];
  let   id      = 1;
  let   pos     = 0;
  let   line    = 1;
  let   lineStart = 0;   // pos of first char on current line

  
  const col = () => pos - lineStart + 1;


  const peek  = (offset = 0) => pos + offset < source.length ? source[pos + offset] : '\0';
  const peek2 = () => peek(1);

  
  const prox = () => source[pos++];

  
  const consume = (pred) => {
    let s = '';
    while (pos < source.length && pred(source[pos])) s += prox();
    return s;
  };

  const isLetra  = c => /[A-Za-z_]/.test(c);
  const isDigito   = c => /[0-9]/.test(c);
  const isAlNum_  = c => /[A-Za-z0-9_]/.test(c);
  const isEspaco   = c => c === ' ' || c === '\t' || c === '\r';

  
  const identifiersSeen = new Map();  // lexema_lower → first token id

  while (pos < source.length) {
    const startPos  = pos;
    const startLine = line;
    const startCol  = col();
    const ch        = source[pos];

 
    if (ch === '\n') {
      tokens.push({ id: id++, line: startLine, col: startCol, token: 'NOVA_LINHA', lexema: '' });
      prox();
      line++;
      lineStart = pos;
      continue;
    }

 
    if (isEspaco(ch)) {
      prox();
      continue;
    }

 
    if (ch === '/' && peek2() === '/') {
      prox(); prox();
      while (pos < source.length && source[pos] !== '\n') prox();
      continue;
    }

 
    if (ch === '{') {
      prox();
      let closed = false;
      while (pos < source.length) {
        if (source[pos] === '\n') { line++; lineStart = pos + 1; }
        if (prox() === '}') { closed = true; break; }
      }
      if (!closed) {
        const err = { id: id++, line: startLine, col: startCol, token: 'ERRO', lexema: '{', error: true, msg: 'Comentário "{" não fechado' };
        tokens.push(err); erros.push(err);
      }
      continue;
    }

 
    if (ch === '(' && peek2() === '*') {
      prox(); prox();
      let closed = false;
      while (pos < source.length) {
        if (source[pos] === '\n') { line++; lineStart = pos + 1; }
        const c2 = prox();
        if (c2 === '*' && source[pos] === ')') { prox(); closed = true; break; }
      }
      if (!closed) {
        const err = { id: id++, line: startLine, col: startCol, token: 'ERRO', lexema: '(*', error: true, msg: 'Comentário "(*" não fechado' };
        tokens.push(err); erros.push(err);
      }
      continue;
    }

 
    if (/[A-Za-z]/.test(ch)) {
      let lex = prox();
      while (pos < source.length && isAlNum_(source[pos])) {
        lex += prox();
      }

      const lower = lex.toLowerCase();

 
      if (lex.length > 15) {
        const err = {
          id: id++, line: startLine, col: startCol,
          token: 'ERRO', lexema: lex, error: true,
          msg: `Identificador "${lex}" excede 15 caracteres (${lex.length} chars)`
        };
        tokens.push(err); erros.push(err);
        continue;
      }

 
      if (KEYWORDS.has(lower)) {
        tokens.push({ id: id++, line: startLine, col: startCol, token: KEYWORDS.get(lower), lexema: lower });
      } else {
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'IDENTIFICADOR', lexema: lower });
      }
      continue;
    }

 
    if (isDigito(ch)) {
      let lex = prox();          // consume first digit (ch)
      lex += consume(isDigito);      // consume remaining digits
      if (peek() === '.' && isDigito(peek(1))) {
        lex += prox();           // consume '.'
        lex += consume(isDigito);    // consume fractional part
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'NUMERO_REAL', lexema: lex });
      } else {
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'NUMERO_INTEIRO', lexema: lex });
      }
      continue;
    }

 
    if (ch === "'") {
      prox();
      let lex = "'";
      let closed = false;
      while (pos < source.length) {
        const c2 = prox();
        lex += c2;
        if (c2 === '\n') { line++; lineStart = pos; break; } // unterminated
        if (c2 === "'") { closed = true; break; }
      }
      if (!closed) {
        const err = { id: id++, line: startLine, col: startCol, token: 'ERRO', lexema: lex, error: true, msg: 'Literal string não fechada' };
        tokens.push(err); erros.push(err);
      } else {
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'LITERAL', lexema: lex });
      }
      continue;
    }

 
    if (ch === ':' && peek2() === '=') {
      prox(); prox();
      tokens.push({ id: id++, line: startLine, col: startCol, token: 'OP_ATRIBUICAO', lexema: ':=' });
      continue;
    }
    if (ch === '<' && peek2() === '>') {
      prox(); prox();
      tokens.push({ id: id++, line: startLine, col: startCol, token: 'OP_DIFERENTE', lexema: '<>' });
      continue;
    }
    if (ch === '<' && peek2() === '=') {
      prox(); prox();
      tokens.push({ id: id++, line: startLine, col: startCol, token: 'OP_MENOR_IGUAL', lexema: '<=' });
      continue;
    }
    if (ch === '>' && peek2() === '=') {
      prox(); prox();
      tokens.push({ id: id++, line: startLine, col: startCol, token: 'OP_MAIOR_IGUAL', lexema: '>=' });
      continue;
    }

 
    const singles = {
      '=':  'OP_IGUAL',
      '<':  'OP_MENOR',
      '>':  'OP_MAIOR',
      '+':  'OP_MAIS',
      '-':  'OP_MENOS',
      '*':  'OP_MULT',
      '/':  'OP_DIV',
      ';':  'PONTO_VIRGULA',
      ':':  'DOIS_PONTOS',
      ',':  'VIRGULA',
      '.':  'PONTO',
      '(':  'ABRE_PAR',
      ')':  'FECHA_PAR',
      '[':  'ABRE_COL',
      ']':  'FECHA_COL',
    };

    if (ch in singles) {
      prox();
      tokens.push({ id: id++, line: startLine, col: startCol, token: singles[ch], lexema: ch });
      continue;
    }

 
    {
      prox();
      const err = {
        id: id++, line: startLine, col: startCol,
        token: 'ERRO', lexema: ch, error: true,
        msg: `Caractere inválido "${ch}" na linha ${startLine}, coluna ${startCol}`
      };
      tokens.push(err); erros.push(err);
    }
  }

 
  const simbolosTable = PRE_SIMBOLOS.map(r => ({ ...r }));

 
  const vistos = new Set();
  for (const t of tokens) {
    if (t.token === 'IDENTIFICADOR' && !vistos.has(t.lexema)) {
      vistos.add(t.lexema);
      simbolosTable.push({
        id: simbolosTable.length + 1,
        line: t.line,
        token: 'IDENTIFICADOR',
        lexema: t.lexema
      });
    }
  }

  return { tokens, errors: erros, symbolTable: simbolosTable };
}


window.Lexer = { lexer: analisador, KEYWORDS, PREDEFINED_SYMBOLS: PRE_SIMBOLOS };
