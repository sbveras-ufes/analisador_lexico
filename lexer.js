/**
 * lexer.js — Analisador Léxico para dialeto Pascal (PascaLex)
 *
 * Tokens produzidos:
 *  PROGRAM, BEGIN, END, VAR, CONST, PROCEDURE, FUNCTION,
 *  IF, THEN, ELSE, WHILE, DO, REPEAT, UNTIL, BREAK, CONTINUE,
 *  INTEGER, REAL, CHAR, STRING, OU, E, NAO,
 *  IDENTIFICADOR, NUMERO_INTEIRO, NUMERO_REAL, LITERAL,
 *  OP_ATRIBUICAO (:=), OP_IGUAL (=), OP_DIFERENTE (<>),
 *  OP_MENOR (<), OP_MENOR_IGUAL (<=), OP_MAIOR (>), OP_MAIOR_IGUAL (>=),
 *  OP_MAIS (+), OP_MENOS (-), OP_MULT (*), OP_DIV (/),
 *  PONTO_VIRGULA (;), DOIS_PONTOS (:), VIRGULA (,),
 *  PONTO (.), ABRE_PAR ((), FECHA_PAR ()), ABRE_COL ([), FECHA_COL (]),
 *  NOVA_LINHA (token especial para controle de linha)
 */

'use strict';

// Mapa de palavras reservadas da linguagem Pascal → tipo do token correspondente
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


// Tabela de símbolos pré-definidos da linguagem:
// contém todas as palavras reservadas, operadores e pontuações.
// Cada entrada tem line: '-' para indicar que não pertence ao código-fonte do usuário.
const PRE_SIMBOLOS = (() => {
  const linhas = [];
  let id = 1;

  // Palavras reservadas
  for (const [lex, tok] of KEYWORDS) {
    linhas.push({ id: id++, line: '-', token: tok, lexema: lex });
  }

  // Operadores
  const operadores = [
    [':=', 'OP_ATRIBUICAO'], ['=',  'OP_IGUAL'],
    ['<>', 'OP_DIFERENTE'],  ['<',  'OP_MENOR'],
    ['<=', 'OP_MENOR_IGUAL'],['>',  'OP_MAIOR'],
    ['>=', 'OP_MAIOR_IGUAL'],
    ['+',  'OP_MAIS'],       ['-',  'OP_MENOS'],
    ['*',  'OP_MULT'],       ['/',  'OP_DIV'],
  ];
  for (const [lex, tok] of operadores) {
    linhas.push({ id: id++, line: '-', token: tok, lexema: lex });
  }

  // Pontuação / delimitadores
  const pontuacoes = [
    [';', 'PONTO_VIRGULA'], [':', 'DOIS_PONTOS'],
    [',', 'VIRGULA'],       ['.', 'PONTO'],
    ['(', 'ABRE_PAR'],      [')', 'FECHA_PAR'],
    ['[', 'ABRE_COL'],      [']', 'FECHA_COL'],
  ];
  for (const [lex, tok] of pontuacoes) {
    linhas.push({ id: id++, line: '-', token: tok, lexema: lex });
  }

  return linhas;
})();


/**
 * @typedef {Object} Token
 * @property {number}  id       – número sequencial do token
 * @property {number}  line     – número da linha (base 1)
 * @property {number}  col      – número da coluna (base 1)
 * @property {string}  token    – nome do tipo do token
 * @property {string}  lexema   – texto original reconhecido
 * @property {boolean} [error]  – verdadeiro se for um token de erro léxico
 * @property {string}  [msg]    – mensagem descritiva do erro
 */

/**
 * Função principal do analisador léxico.
 * Percorre o código-fonte caractere a caractere e produz a lista de tokens.
 *
 * @param {string} source – código-fonte Pascal a ser analisado
 * @returns {{ tokens: Token[], errors: Token[], symbolTable: object[] }}
 */
function analisador(source) {
  const tokens = [];   // todos os tokens reconhecidos
  const erros  = [];   // apenas os tokens de erro léxico
  let   id      = 1;
  let   pos     = 0;
  let   line    = 1;
  let   lineStart = 0; // posição do primeiro caractere da linha atual

  // Retorna a coluna atual (base 1)
  const col = () => pos - lineStart + 1;

  // Espia o caractere em pos+offset sem consumir (retorna '\0' se ultrapassar o fim)
  const peek  = (offset = 0) => pos + offset < source.length ? source[pos + offset] : '\0';
  const peek2 = () => peek(1);

  // Consome e retorna o caractere atual, avançando o cursor
  const prox = () => source[pos++];

  // Consome caracteres enquanto o predicado for verdadeiro, retornando a sequência consumida
  const consume = (pred) => {
    let s = '';
    while (pos < source.length && pred(source[pos])) s += prox();
    return s;
  };

  // Predicados de classificação de caracteres
  const isLetra  = c => /[A-Za-z_]/.test(c);
  const isDigito = c => /[0-9]/.test(c);
  const isAlNum_ = c => /[A-Za-z0-9_]/.test(c);
  const isEspaco = c => c === ' ' || c === '\t' || c === '\r';

  // Loop principal de varredura
  while (pos < source.length) {
    const startPos  = pos;
    const startLine = line;
    const startCol  = col();
    const ch        = source[pos];

    // ── Quebra de linha ──────────────────────────────────────────
    if (ch === '\n') {
      tokens.push({ id: id++, line: startLine, col: startCol, token: 'NOVA_LINHA', lexema: '' });
      prox();
      line++;
      lineStart = pos;
      continue;
    }

    // ── Espaços em branco (ignorados) ────────────────────────────
    if (isEspaco(ch)) {
      prox();
      continue;
    }

    // ── Comentário de linha: // até o fim da linha ───────────────
    if (ch === '/' && peek2() === '/') {
      prox(); prox();
      while (pos < source.length && source[pos] !== '\n') prox();
      continue;
    }

    // ── Comentário de bloco: { ... } ─────────────────────────────
    if (ch === '{') {
      prox();
      let fechou = false;
      while (pos < source.length) {
        if (source[pos] === '\n') { line++; lineStart = pos + 1; }
        if (prox() === '}') { fechou = true; break; }
      }
      if (!fechou) {
        const err = { id: id++, line: startLine, col: startCol, token: 'ERRO', lexema: '{', error: true, msg: 'Comentário "{" não fechado' };
        tokens.push(err); erros.push(err);
      }
      continue;
    }

    // ── Comentário de bloco: (* ... *) ───────────────────────────
    if (ch === '(' && peek2() === '*') {
      prox(); prox();
      let fechou = false;
      while (pos < source.length) {
        if (source[pos] === '\n') { line++; lineStart = pos + 1; }
        const c2 = prox();
        if (c2 === '*' && source[pos] === ')') { prox(); fechou = true; break; }
      }
      if (!fechou) {
        const err = { id: id++, line: startLine, col: startCol, token: 'ERRO', lexema: '(*', error: true, msg: 'Comentário "(*" não fechado' };
        tokens.push(err); erros.push(err);
      }
      continue;
    }

    // ── Identificador ou palavra reservada ───────────────────────
    if (/[A-Za-z]/.test(ch)) {
      let lex = prox();
      while (pos < source.length && isAlNum_(source[pos])) {
        lex += prox();
      }

      const lower = lex.toLowerCase();

      // Valida o limite de 15 caracteres para identificadores
      if (lex.length > 15) {
        const err = {
          id: id++, line: startLine, col: startCol,
          token: 'ERRO', lexema: lex, error: true,
          msg: `Identificador "${lex}" excede 15 caracteres (${lex.length} chars)`
        };
        tokens.push(err); erros.push(err);
        continue;
      }

      // Verifica se é palavra reservada; caso contrário, é um identificador
      if (KEYWORDS.has(lower)) {
        tokens.push({ id: id++, line: startLine, col: startCol, token: KEYWORDS.get(lower), lexema: lower });
      } else {
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'IDENTIFICADOR', lexema: lower });
      }
      continue;
    }

    // ── Número inteiro ou real ───────────────────────────────────
    if (isDigito(ch)) {
      let lex = prox();             // consome o primeiro dígito
      lex += consume(isDigito);     // consome os demais dígitos inteiros
      if (peek() === '.' && isDigito(peek(1))) {
        lex += prox();              // consome o ponto decimal
        lex += consume(isDigito);   // consome a parte fracionária
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'NUMERO_REAL', lexema: lex });
      } else {
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'NUMERO_INTEIRO', lexema: lex });
      }
      continue;
    }

    // ── Literal de texto (string entre aspas simples) ────────────
    if (ch === "'") {
      prox();
      let lex = "'";
      let fechou = false;
      while (pos < source.length) {
        const c2 = prox();
        lex += c2;
        if (c2 === '\n') { line++; lineStart = pos; break; } // string não fechada na linha
        if (c2 === "'") { fechou = true; break; }
      }
      if (!fechou) {
        const err = { id: id++, line: startLine, col: startCol, token: 'ERRO', lexema: lex, error: true, msg: 'Literal string não fechada' };
        tokens.push(err); erros.push(err);
      } else {
        tokens.push({ id: id++, line: startLine, col: startCol, token: 'LITERAL', lexema: lex });
      }
      continue;
    }

    // ── Operadores de dois caracteres (verificados antes dos simples) ──
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

    // ── Operadores e pontuação de um caractere ───────────────────
    const simples = {
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

    if (ch in simples) {
      prox();
      tokens.push({ id: id++, line: startLine, col: startCol, token: simples[ch], lexema: ch });
      continue;
    }

    // ── Caractere inválido (não reconhecido pela gramática) ──────
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

  // Monta a tabela de símbolos: cópia dos pré-definidos + identificadores únicos do programa
  const simbolosTable = PRE_SIMBOLOS.map(r => ({ ...r }));

  // Adiciona à tabela cada identificador distinto encontrado no código-fonte
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
