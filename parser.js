/**
 *
 * @typedef {{ line:number, col:number, lexema:string, msg:string, isWarning:boolean }} ErrInfo
 * @typedef {{ name:string, children:ParseNode[] }} ParseNode
 */
'use strict';

function parse(rawTokens) {
 
  const toks = rawTokens.filter(t => t.token !== 'NOVA_LINHA' && t.token !== 'ERRO');

  const errors   = [];
  const warnings = [];

  let pos = 0;
  let lastErrLine = -1;          

 
  let scopes = [new Set()];

  function enterScope() { scopes.push(new Set()); }
  function leaveScope() { scopes.pop(); }
  function declareId(t) {
    if (t && t.lexema) scopes[scopes.length - 1].add(t.lexema.toLowerCase());
  }
  function checkDeclared(t) {
    if (!t || !t.lexema) return false;
    const name = t.lexema.toLowerCase();
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(name)) return true;
    }
    addError(`Variável não declarada: "${t.lexema}"`, t);
    return false;
  }

  
  const peek   = () => pos < toks.length ? toks[pos] : null;
  const at     = (type) => { const t = peek(); return t !== null && t.token === type; };
  const atAny  = function() {
    const t = peek();
    if (!t) return false;
    for (let i = 0; i < arguments.length; i++) {
      if (t.token === arguments[i]) return true;
    }
    return false;
  };
  const consume = () => pos < toks.length ? toks[pos++] : null;
  const eof     = () => pos >= toks.length;

  
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function leaf(tok) {
    if (!tok) return null;
    return {
      name: '<span class="tree-token">' + esc(tok.token) + '</span> <span class="tree-lex">\u201c' + esc(tok.lexema) + '\u201d</span>',
      children: []
    };
  }

  function node(name) {
    var ch = [];
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i] != null) ch.push(arguments[i]);
    }
    return { name: name, children: ch };
  }

  
  function addError(msg, tok) {
    var t = tok || peek() || (toks.length ? toks[toks.length - 1] : null);
    var line = t ? t.line : 1;
    if (line === lastErrLine) return;     
    lastErrLine = line;
    errors.push({
      line:  line,
      col:   t ? t.col : 1,
      lexema: t ? t.lexema : '',
      msg:   msg,
      isWarning: false
    });
  }

  function addWarning(msg, tok) {
    warnings.push({
      line:   tok.line,
      col:    tok.col,
      lexema: tok.lexema,
      msg:    msg,
      isWarning: true
    });
  }

  
  var readableNames = {
    PONTO_VIRGULA: "';'",
    DOIS_PONTOS:   "':'",
    PONTO:         "'.'",
    OP_ATRIBUICAO: "':='",
    ABRE_PAR:      "'('",
    FECHA_PAR:     "')'",
    ABRE_COL:      "'['",
    FECHA_COL:     "']'",
    BEGIN:         "'begin'",
    END:           "'end'",
    THEN:          "'then'",
    DO:            "'do'",
    UNTIL:         "'until'",
    IDENTIFICADOR: 'um identificador'
  };

  function expectTok(type) {
    if (at(type)) return consume();
    var t = peek();
    var label = readableNames[type] || type;
    var got   = t ? ('"' + t.lexema + '"') : 'fim do arquivo';
    addError('Esperado ' + label + ', encontrado ' + got, t);
    return null;
  }

  
  function synchronize() {
    var limit = 0;
    while (peek() && limit++ < 200) {
      if (atAny('PONTO_VIRGULA','END','BEGIN','IF','WHILE','REPEAT','FOR','PROCEDURE','FUNCTION')) {
        if (at('PONTO_VIRGULA')) consume();
        return;
      }
      consume();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  GRAMÁTICA
  // ═══════════════════════════════════════════════════════════════

  function parsePrograma() {
    var ch = [];
    ch.push(leaf(consume()));                    
    if (at('IDENTIFICADOR')) {
      var tName = consume();
      declareId(tName);
      ch.push(leaf(tName));
    }
    else addError('Nome do programa esperado após "program"');
    
    if (at('PONTO_VIRGULA')) consume();
    else { addError('Esperado ";"'); synchronize(); }

    var decls = parseDeclaracoes();
    if (decls.children.length) ch.push(decls);

    if (!at('BEGIN')) {
      addError('Esperado "begin" após declarações', peek());
      // Avança até encontrar BEGIN ou EOF para tentar analisar o bloco
      while (peek() && !at('BEGIN')) consume();
    }
    
    if (at('BEGIN')) {
      ch.push(parseBloco());
    }
    
    if (at('PONTO')) consume();
    else addError('Esperado "." no final do arquivo', peek());
    
    return node('programa', ch[0], ch[1], ch[2], ch[3], ch[4]);
  }

  function parseDeclaracoes() {
    var ch = [];
    while (atAny('VAR','CONST','PROCEDURE','FUNCTION')) {
      if (at('VAR'))        ch.push(parseDeclVar());
      else if (at('CONST')) ch.push(parseDeclConst());
      else                  ch.push(parseDeclProc());
    }
    return node('declarações', ch[0], ch[1], ch[2], ch[3], ch[4], ch[5]);
  }

  function parseTipo() {
    if (atAny('INTEGER','REAL','CHAR','STRING','VETOR')) {
      return leaf(consume());
    }
    var bad = peek();
    addError('Tipo válido esperado (integer, real, char, string, array)', bad);
    if (at('IDENTIFICADOR')) {
      return leaf(consume());
    }
    return null;
  }

  function parseDeclVar() {
    var ch = [leaf(consume())];  
    while (peek() && !atAny('BEGIN','PROCEDURE','FUNCTION','CONST','VAR')) {
      if (!at('IDENTIFICADOR')) {
        addError('Identificador esperado na declaração de variável', peek());
        while (peek() && !at('PONTO_VIRGULA') && !at('IDENTIFICADOR') && !atAny('BEGIN','PROCEDURE','FUNCTION','CONST','VAR')) {
          consume();
        }
        if (at('PONTO_VIRGULA')) consume();
        if (!at('IDENTIFICADOR')) continue;
      }
      
      if (atAny('BEGIN','PROCEDURE','FUNCTION','CONST','VAR')) break;

      var t1 = consume();
      declareId(t1);
      var ids = [leaf(t1)];
      while (at('VIRGULA')) {
        consume();
        if (at('IDENTIFICADOR')) {
          var t2 = consume();
          declareId(t2);
          ids.push(leaf(t2));
        } else { addError('Identificador esperado após ","'); break; }
      }
      
      if (at('DOIS_PONTOS')) consume();
      else { addError('Esperado ":"', peek()); synchronize(); continue; }

      var tipo = parseTipo();
      
      if (at('PONTO_VIRGULA')) consume();
      else { addError('Esperado ";"'); synchronize(); }

      var dn = node('declVar');
      for (var i = 0; i < ids.length; i++) dn.children.push(ids[i]);
      if (tipo) dn.children.push(tipo);
      ch.push(dn);
    }
    var r = node('declaraçãoVariável');
    for (var i = 0; i < ch.length; i++) if (ch[i]) r.children.push(ch[i]);
    return r;
  }

  function parseDeclConst() {
    var ch = [leaf(consume())];  
    while (peek() && !atAny('BEGIN','PROCEDURE','FUNCTION','CONST','VAR')) {
      if (!at('IDENTIFICADOR')) {
        addError('Identificador esperado na declaração de constante', peek());
        while (peek() && !at('PONTO_VIRGULA') && !at('IDENTIFICADOR') && !atAny('BEGIN','PROCEDURE','FUNCTION','CONST','VAR')) {
          consume();
        }
        if (at('PONTO_VIRGULA')) consume();
        if (!at('IDENTIFICADOR')) continue;
      }
      
      if (atAny('BEGIN','PROCEDURE','FUNCTION','CONST','VAR')) break;

      var t = consume();
      declareId(t);
      var id = leaf(t);
      var tipo = null;
      if (at('DOIS_PONTOS')) { consume(); if (peek()) tipo = parseTipo(); }
      
      if (at('OP_IGUAL')) { consume(); }
      else { addError('Esperado "="', peek()); synchronize(); continue; }
      
      var val = parseExpr();
      
      if (at('PONTO_VIRGULA')) consume();
      else { addError('Esperado ";"', peek()); synchronize(); }
      
      ch.push(node('declConst', id, tipo, val));
    }
    var r = node('declaraçãoConstante');
    for (var i = 0; i < ch.length; i++) if (ch[i]) r.children.push(ch[i]);
    return r;
  }

  function parseDeclProc() {
    var kw = consume();
    var ch = [leaf(kw)];
    if (at('IDENTIFICADOR')) {
      var nameTok = consume();
      declareId(nameTok);
      ch.push(leaf(nameTok));
    } else addError('Nome esperado após "' + kw.lexema + '"');

    enterScope();

    if (at('ABRE_PAR')) {
      consume();
      while (!at('FECHA_PAR') && peek()) {
        var pt = consume();
        if (pt.token === 'IDENTIFICADOR') declareId(pt);
        ch.push(leaf(pt));
        if (at('VIRGULA')) consume(); 
      }
      expectTok('FECHA_PAR');
    }
    if (at('DOIS_PONTOS')) { consume(); if (peek()) ch.push(parseTipo()); }
    expectTok('PONTO_VIRGULA');
    if (at('VAR')) ch.push(parseDeclVar());
    if (at('BEGIN')) ch.push(parseBloco());
    else addError('Esperado "begin" no corpo do procedimento/função');
    if (at('PONTO_VIRGULA')) consume();

    leaveScope();

    var name = kw.token === 'FUNCTION' ? 'declaraçãoFunção' : 'declaraçãoProcedimento';
    var r = node(name);
    for (var i = 0; i < ch.length; i++) if (ch[i]) r.children.push(ch[i]);
    return r;
  }

  function parseBloco() {
    var ch = [];
    if (at('BEGIN')) ch.push(leaf(consume()));
    else { addError('Esperado "begin"'); return node('bloco (erro)'); }

    var insts = parseInstrucoes();
    if (insts.children.length) ch.push(insts);

    if (at('END')) ch.push(leaf(consume()));
    else addError('Esperado "end"');

    return node('bloco', ch[0], ch[1], ch[2]);
  }

  function parseInstrucoes() {
    var ch = [];
    var limit = 0;
    while (!atAny('END','UNTIL') && peek() && limit++ < 5000) {
      var before = pos;
      var inst = parseInst();
      if (inst) ch.push(inst);
      if (pos === before) {
        // não avançou — token inesperado, pula
        var bad = consume();
        if (bad) addError('Token inesperado "' + bad.lexema + '"', bad);
      }
    }
    var r = node('instruções');
    for (var i = 0; i < ch.length; i++) r.children.push(ch[i]);
    return r;
  }

  // ── instrução ──────────────────────────────────────────────────

  var STMT_STARTERS = ['IDENTIFICADOR','IF','WHILE','REPEAT','FOR','BEGIN',
    'BREAK','CONTINUE','WRITELN','WRITE','READLN','READ'];

  function parseInst() {
    var t = peek();
    if (!t) return null;

    switch (t.token) {
      case 'IDENTIFICADOR': return parseAtribOrCall();
      case 'IF':            return parseIf();
      case 'WHILE':         return parseWhile();
      case 'REPEAT':        return parseRepeat();
      case 'FOR':           return parseFor();
      case 'BEGIN':         return parseBloco();
      case 'BREAK':
      case 'CONTINUE':
        var kw = consume();
        expectTok('PONTO_VIRGULA');
        return node(kw.lexema, leaf(kw));
      case 'WRITELN': case 'WRITE':
      case 'READLN':  case 'READ':
        return parseProcCall();
      default:
        return null; // caller will handle
    }
  }

  // ── atribuição, chamada ou ID standalone ───────────────────────

  function parseAtribOrCall() {
    var id = consume();  // IDENTIFICADOR
    var isDecl = checkDeclared(id);

    // ID[expr] := expr ;
    if (at('ABRE_COL')) {
      consume();
      var idx = parseExpr();
      expectTok('FECHA_COL');
      if (at('OP_ATRIBUICAO')) {
        consume();
        var val = parseExpr();
        if (!val) { addError('Expressão esperada após ":="', peek()); synchronize(); return node('atribuição (erro)', leaf(id)); }
        expectTok('PONTO_VIRGULA');
        return node('atribuição (vetor)', leaf(id), idx, val);
      }
      expectTok('PONTO_VIRGULA');
      return node('acesso vetor', leaf(id), idx);
    }

    // ID := expr ;
    if (at('OP_ATRIBUICAO')) {
      consume();
      var expr = parseExpr();
      if (!expr) {
        addError('Expressão esperada após ":="', peek());
        synchronize();
        return node('atribuição (erro)', leaf(id));
      }
      expectTok('PONTO_VIRGULA');
      return node('atribuição', leaf(id), expr);
    }

    // ID(params) ;
    if (at('ABRE_PAR')) {
      consume();
      var args = [];
      if (!at('FECHA_PAR') && peek()) {
        var e = parseExpr();
        if (e) args.push(e);
        while (at('VIRGULA')) { consume(); var e2 = parseExpr(); if (e2) args.push(e2); }
      }
      expectTok('FECHA_PAR');
      expectTok('PONTO_VIRGULA');
      var cn = node('chamadaProcedimento', leaf(id));
      for (var i = 0; i < args.length; i++) cn.children.push(args[i]);
      return cn;
    }

    // ID ;  → standalone → WARNING 
    if (at('PONTO_VIRGULA')) {
      consume();
      if (isDecl) {
        addWarning('Instrução "' + id.lexema + ';" sem efeito', id);
      }
      return node('instrução (sem efeito) \u26A0', leaf(id));
    }

  
    addError('Token inesperado após "' + id.lexema + '"', peek());
    synchronize();
    return node('instrução (erro)', leaf(id));
  }

  

  function parseProcCall() {
    var id = consume(); // WRITELN, etc.
    var ch = [leaf(id)];
    if (at('ABRE_PAR')) {
      consume();
      if (!at('FECHA_PAR') && peek()) {
        var e = parseExpr();
        if (e) ch.push(e);
        while (at('VIRGULA')) { consume(); var e2 = parseExpr(); if (e2) ch.push(e2); }
      }
      expectTok('FECHA_PAR');
    }
    expectTok('PONTO_VIRGULA');
    var r = node('chamadaProcedimento');
    for (var i = 0; i < ch.length; i++) r.children.push(ch[i]);
    return r;
  }

  // ── if ─────────────────────────────────────────────────────────

  function parseIf() {
    var ch = [leaf(consume())];  // IF
    var cond = parseExpr();
    if (!cond) addError('Condição esperada após "if"');
    ch.push(cond);
    expectTok('THEN');
    var thenInst = parseInst();
    if (!thenInst) addError('Instrução esperada após "then"');
    ch.push(thenInst);
    if (at('ELSE')) { ch.push(leaf(consume())); var elseInst = parseInst(); ch.push(elseInst); }
    return node('se (if)', ch[0], ch[1], ch[2], ch[3], ch[4]);
  }

  // ── while ──────────────────────────────────────────────────────

  function parseWhile() {
    var ch = [leaf(consume())];  // WHILE
    var cond = parseExpr();
    if (!cond) addError('Condição esperada após "while"');
    ch.push(cond);
    expectTok('DO');
    var body = parseInst();
    if (!body) addError('Instrução esperada após "do"');
    ch.push(body);
    return node('enquanto (while)', ch[0], ch[1], ch[2], ch[3]);
  }

  // ── repeat ─────────────────────────────────────────────────────

  function parseRepeat() {
    var ch = [leaf(consume())];  // REPEAT
    var limit = 0;
    while (!at('UNTIL') && peek() && limit++ < 2000) {
      var before = pos;
      var inst = parseInst();
      if (inst) ch.push(inst);
      if (pos === before) consume();
    }
    if (at('UNTIL')) ch.push(leaf(consume()));
    else addError('Esperado "until"');
    var cond = parseExpr();
    ch.push(cond);
    expectTok('PONTO_VIRGULA');
    var r = node('repita (repeat-until)');
    for (var i = 0; i < ch.length; i++) if (ch[i]) r.children.push(ch[i]);
    return r;
  }

  // ── for ────────────────────────────────────────────────────────

  function parseFor() {
    var ch = [leaf(consume())];  // FOR
    if (at('IDENTIFICADOR')) {
      var id = consume();
      checkDeclared(id);
      ch.push(leaf(id));
    }
    else addError('Variável esperada após "for"');
    if (at('OP_ATRIBUICAO')) { consume(); ch.push(parseExpr()); }
    else addError('Esperado ":=" no for');
    if (atAny('TO','DOWNTO')) ch.push(leaf(consume()));
    else addError('Esperado "to" ou "downto"');
    ch.push(parseExpr());
    expectTok('DO');
    var body = parseInst();
    if (!body) addError('Instrução esperada após "do"');
    ch.push(body);
    var r = node('para (for)');
    for (var i = 0; i < ch.length; i++) if (ch[i]) r.children.push(ch[i]);
    return r;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXPRESSÕES
  // ═══════════════════════════════════════════════════════════════

  function parseExpr() { return parseLogical(); }

  function parseLogical() {
    var left = parseCompar();
    while (atAny('OU','E')) {
      var op = consume();
      var right = parseCompar();
      if (!right) { addError('Expressão esperada após "' + op.lexema + '"', peek()); return left; }
      left = node('expr lógica', left, leaf(op), right);
    }
    return left;
  }

  function parseCompar() {
    var left = parseAddSub();
    while (atAny('OP_IGUAL','OP_DIFERENTE','OP_MENOR','OP_MENOR_IGUAL','OP_MAIOR','OP_MAIOR_IGUAL')) {
      var op = consume();
      var right = parseAddSub();
      if (!right) { addError('Expressão esperada após "' + op.lexema + '"', peek()); return left; }
      left = node('comparação', left, leaf(op), right);
    }
    return left;
  }

  function parseAddSub() {
    var left = parseMulDiv();
    while (atAny('OP_MAIS','OP_MENOS')) {
      var op = consume();
      var right = parseMulDiv();
      if (!right) { addError('Expressão esperada após "' + op.lexema + '"', peek()); return left; }
      left = node('expressão', left, leaf(op), right);
    }
    return left;
  }

  function parseMulDiv() {
    var left = parseUnary();
    while (atAny('OP_MULT','OP_DIV','DIV','MOD')) {
      var op = consume();
      var right = parseUnary();
      if (!right) { addError('Expressão esperada após "' + op.lexema + '"', peek()); return left; }
      left = node('termo', left, leaf(op), right);
    }
    return left;
  }

  function parseUnary() {
    if (atAny('OP_MENOS','OP_MAIS','NAO')) {
      var op = consume();
      var f = parseFator();
      if (!f) { addError('Expressão esperada após "' + op.lexema + '"', peek()); return null; }
      return node('unário', leaf(op), f);
    }
    return parseFator();
  }

  function parseFator() {
    if (!peek()) return null;

    // (expr)
    if (at('ABRE_PAR')) {
      consume();
      var e = parseExpr();
      expectTok('FECHA_PAR');
      return e ? node('(expr)', e) : null;
    }

    // ID, ID[expr], ID(args)
    if (at('IDENTIFICADOR')) {
      var id = consume();
      checkDeclared(id);
      if (at('ABRE_COL')) {
        consume();
        var idx = parseExpr();
        expectTok('FECHA_COL');
        return node('variável indexada', leaf(id), idx);
      }
      if (at('ABRE_PAR')) {
        consume();
        var args = [];
        if (!at('FECHA_PAR') && peek()) {
          var a = parseExpr(); if (a) args.push(a);
          while (at('VIRGULA')) { consume(); var a2 = parseExpr(); if (a2) args.push(a2); }
        }
        expectTok('FECHA_PAR');
        var cn = node('chamadaFunção', leaf(id));
        for (var i = 0; i < args.length; i++) cn.children.push(args[i]);
        return cn;
      }
      return leaf(id);
    }

    // Literais
    if (atAny('NUMERO_INTEIRO','NUMERO_REAL','LITERAL','VERDADEIRO','FALSO')) {
      return leaf(consume());
    }

    // Nada encontrado → não é uma expressão válida
    return null;
  }

  
  var tree;
  try {
    if (!toks.length) {
      tree = node('(vazio)');
    } else if (at('PROGRAM')) {
      tree = parsePrograma();
    } else {
      // Fallback: tratar como lista de instruções
      var ch = [];
      var limit = 0;
      while (peek() && limit++ < 10000) {
        var before = pos;
        var inst = parseInst();
        if (inst) ch.push(inst);
        if (pos === before) {
          var bad = consume();
          if (bad) addError('Token inesperado "' + bad.lexema + '"', bad);
        }
      }
      tree = node('instruções');
      for (var i = 0; i < ch.length; i++) tree.children.push(ch[i]);
    }

    // Tokens restantes não consumidos?
    if (peek()) {
      addError('Token inesperado "' + peek().lexema + '" após fim esperado do programa', peek());
    }
  } catch (e) {
    tree = node('Erro de análise: ' + e.message);
  }

  return { tree: tree, errors: errors, warnings: warnings };
}

window.Parser = { parse: parse };

