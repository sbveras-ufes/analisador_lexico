# PascaLex — Analisador Léxico Pascal

Ambiente de desenvolvimento web para análise léxica de programas escritos em um dialeto da linguagem Pascal. Executa inteiramente no navegador, sem dependências externas nem etapa de build.

---

## Estrutura do Projeto

```
pascalex/
├── index.html   → Estrutura da interface (menus, painéis, editor)
├── style.css    → Estilos visuais
├── lexer.js     → Analisador léxico (scanner)
└── app.js       → Controlador da IDE (pipeline, renderização, eventos)
```

---

## Como Funciona

### 1. Interface (`index.html` + `style.css`)

A tela é dividida em dois painéis lado a lado:

- **Painel esquerdo** — Tabela de Símbolos: lista todos os tokens reconhecidos no programa (ID, linha, tipo e lexema).
- **Painel direito** — Editor de código com três camadas sobrepostas:

| Camada | Elemento | Função |
|--------|----------|--------|
| 1 (inferior) | `#highlight-pre` | Exibe o código colorido por tipo de token |
| 2 (intermediária) | `#error-pre` | Exibe sublinhados ondulados vermelhos sobre tokens inválidos |
| 3 (superior) | `#editor` (textarea) | Recebe a digitação do usuário (texto transparente) |

As três camadas usam exatamente a mesma fonte, tamanho, padding e line-height, garantindo alinhamento pixel a pixel. O cursor de texto permanece visível graças a `caret-color: #111` aplicado à textarea transparente.

---

### 2. Analisador Léxico (`lexer.js`)

O analisador léxico é o núcleo do sistema. Ele percorre o código-fonte **caractere a caractere** e produz uma sequência de tokens.

#### 2.1 Fluxo de varredura

O loop principal testa o caractere atual na seguinte ordem de prioridade:

```
1. Quebra de linha (\n)         → token NOVA_LINHA; avança contadores de linha
2. Espaço / tab / \r            → ignorado
3. Comentário //                → ignora até o fim da linha
4. Comentário { }               → ignora até '}'; erro se não fechado
5. Comentário (* *)             → ignora até '*)'; erro se não fechado
6. Letra [A-Za-z]               → lê sequência alfanumérica → palavra reservada ou IDENTIFICADOR
7. Dígito [0-9]                 → lê número → NUMERO_INTEIRO ou NUMERO_REAL
8. Aspas simples '              → lê literal de texto → LITERAL; erro se não fechado
9. Operadores de 2 caracteres   → :=  <>  <=  >=
10. Operadores / pontuação 1 char → = < > + - * / ; : , . ( ) [ ]
11. Qualquer outro              → token ERRO (caractere inválido)
```

#### 2.2 Identificadores e palavras reservadas

Ao encontrar uma letra, o scanner consome toda a sequência alfanumérica (incluindo `_`). O lexema é convertido para minúsculas e comparado contra o mapa `KEYWORDS`:

- **Encontrado no mapa** → token da palavra reservada (ex.: `BEGIN`, `INTEGER`)
- **Não encontrado** → token `IDENTIFICADOR`
- **Comprimento > 15 caracteres** → token `ERRO`

#### 2.3 Palavras reservadas reconhecidas

| Categoria | Palavras |
|-----------|----------|
| Estrutura | `program`, `begin`, `end` |
| Declarações | `var`, `const`, `procedure`, `function` |
| Controle de fluxo | `if`, `then`, `else`, `while`, `do`, `repeat`, `until`, `for`, `to`, `downto`, `break`, `continue` |
| Tipos | `integer`, `real`, `char`, `string`, `array` |
| Operadores lógicos | `or`, `and`, `not` |
| Operadores aritméticos | `div`, `mod` |
| Literais booleanos | `true`, `false` |
| E/S | `writeln`, `write`, `readln`, `read` |
| Outros | `record`, `type`, `of` |

#### 2.4 Tipos de tokens produzidos

| Categoria | Tokens |
|-----------|--------|
| Identificador | `IDENTIFICADOR` |
| Números | `NUMERO_INTEIRO`, `NUMERO_REAL` |
| Texto | `LITERAL` |
| Operadores 2 chars | `OP_ATRIBUICAO`, `OP_DIFERENTE`, `OP_MENOR_IGUAL`, `OP_MAIOR_IGUAL` |
| Operadores 1 char | `OP_IGUAL`, `OP_MENOR`, `OP_MAIOR`, `OP_MAIS`, `OP_MENOS`, `OP_MULT`, `OP_DIV` |
| Pontuação | `PONTO_VIRGULA`, `DOIS_PONTOS`, `VIRGULA`, `PONTO`, `ABRE_PAR`, `FECHA_PAR`, `ABRE_COL`, `FECHA_COL` |
| Controle | `NOVA_LINHA` |
| Erro léxico | `ERRO` |

#### 2.5 Interface exportada

```javascript
window.Lexer = {
  lexer: analisador,             // função principal
  KEYWORDS,                      // Map de palavras reservadas
  PREDEFINED_SYMBOLS: PRE_SIMBOLOS  // tabela pré-definida (uso interno)
};

// Assinatura:
Lexer.lexer(source: string) → {
  tokens: Token[],     // todos os tokens (incluindo NOVA_LINHA e ERRO)
  errors: Token[],     // apenas os tokens de erro léxico
  symbolTable: object[] // tabela de símbolos completa
}
```

---

### 3. Controlador da IDE (`app.js`)

Responsável por orquestrar a interface: chamar o lexer, atualizar os painéis e reagir às ações do usuário.

#### 3.1 Realce de sintaxe

A função `syntaxHighlight()` usa uma única expressão regular (`HIGHLIGHT_RE`) que percorre o código e envolve cada trecho reconhecido em um `<span>` com a classe CSS correspondente:

| Classe CSS | Cor | Representa |
|------------|-----|------------|
| `.hl-kw` | Azul escuro | Palavras reservadas |
| `.hl-num` | Marrom | Números inteiros e reais |
| `.hl-str` | Verde | Literais de texto |
| `.hl-cmt` | Cinza itálico | Comentários |
| `.hl-op` | Roxo | Operadores |
| `.hl-pun` | Chumbo | Pontuação |

O resultado é injetado no `#highlight-pre` (camada 1), que fica visível por baixo da textarea transparente.

#### 3.2 Pipeline de compilação (`compile()`)

Executado automaticamente 500 ms após cada digitação (debounce):

```
editor.value
    ↓
Lexer.lexer(source)
    ↓ tokens[], errors[]
renderSymbolTable(tokens)   → preenche a tabela de símbolos
renderErrorOverlay(errors)  → desenha sublinhados vermelhos no editor
```

#### 3.3 Overlay de erros (`renderErrorOverlay`)

Para cada token de erro, o overlay posiciona um `<span class="err-squiggle">` exatamente sobre o trecho inválido no `#error-pre`. O CSS aplica `text-decoration: underline wavy #cc0000` com `color: transparent`, tornando apenas a onda vermelha visível.

#### 3.4 Compilação explícita (botão "Compilar")

Ao clicar em **Compilar**, a função `handleExplicitCompile()` executa:

1. Chama `compile()` e verifica se há erros léxicos.
2. **Se houver erros**: exibe alerta e interrompe.
3. **Se não houver erros**: sanitiza o código —
   - Remove comentários `//`, `{ }` e `(* *)`
   - Remove espaços no início e fim de cada linha
   - Remove linhas completamente em branco
4. Atualiza o editor com o código sanitizado e executa `compile()` novamente.

#### 3.5 Sincronização de scroll

As três camadas do editor têm scroll independente. O evento `scroll` da textarea aciona `syncScroll()`, que replica `scrollTop` e `scrollLeft` para `#highlight-pre`, `#error-pre` e `#gutter`, mantendo tudo alinhado.

---

## Erros Detectados pelo Léxico

| Situação | Token gerado | Exemplo |
|----------|-------------|---------|
| Caractere não pertencente à linguagem | `ERRO` | `@`, `#`, `$` |
| Identificador com mais de 15 caracteres | `ERRO` | `identificadorMuitoLongo` |
| Literal de texto não fechada | `ERRO` | `'texto sem fechar` |
| Comentário `{` não fechado | `ERRO` | `{ comentário sem }` |
| Comentário `(*` não fechado | `ERRO` | `(* comentário sem *)` |

Tokens de erro aparecem sublinhados em vermelho no editor e destacados em rosa na tabela de símbolos.
 |
