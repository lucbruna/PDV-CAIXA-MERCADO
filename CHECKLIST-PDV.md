# Checklist priorizado — PDV para mercadinho brasileiro

Base: leitura completa de `index.html` (69 KB, IIFE minificada, 8 views) + 9 stubs de redirect,
`qrcode-vendor.js` e screenshots de referência. Toda a coluna "Hoje" foi verificada no código,
não inferida. Falso-positivo de substring foi descartado (`ab**nfe**r`, `**undo**r`, `**DRE**efundido`).

---

## 0. Diagnóstico do que já existe (não refazer)

Vale preservar na reconstrução — já está correto e testável:

| Módulo | Estado real |
|---|---|
| Pix BR Code | **Implementado de verdade**: TLV EMV + CRC16 + chave+cidade, QR inline (`qrcode-vendor.js`), copia-e-cola. Não mexer. |
| Auth | PBKDF2 210k iterações, salt por usuário, roles admin/operador, operador preso no PDV. |
| Cofre de segredo | Pix client_secret em AES-GCM,derivado da senha do admin. |
| Caixa | Abrir/fechar turno, fundo inicial, `cashExpected`, suprimento, sangria, conferência. |
| Crediário | `debtLimit` bloqueado no PDV, reversão no estorno, recebimento parcial. |
| Split de pagamento | Lado a lado, guarda "troco só sai do dinheiro", bloqueio de pagamento duplicado. |
| Estorno | Motivo obrigatório + devolução de estoque + reversão de crediário + saída de caixa. |
| Backup | JSON export/restore + CSV de vendas. |
| Relógio/série | `nextId` monotônico para venda e lançamentos. |

---

## 1. P0 — Causa raiz da reclamação ("frente de caixa é horrível")

A tela atual **não é um PDV visual, é um campo de busca**. `pdvView()` só renderiza `.product-card`
quando `productQuery` não está vazio; sem query mostra o empty state "Leia o código de barras".
Ou seja: o operador **não vê nenhum produto** — só uma caixa de texto. Daí a sensação de feio/
inutilizável. Não é problema de cor; é problema de modelo de interação.

### 1.1 Grade de produtos de verdade (o item que mais muda a percepção)

- Grade **sempre visível** à esquerda, populada por padrão, mesmo com a busca vazia.
- **Trilha de categorias** acima da grade, com o nº de itens: `Todos · Mercearia · Bebidas ·
  Hortifruti · Padaria · Limpeza · Congelados · Petiscos`. Hoje `filter` existe no código mas
  **nunca é aplicado** — o filtro existe, a UI não.
- Tile por produto: foto (ou placeholder com iniciais), nome em até 2 linhas, preço grande.
  - Alvo de toque **≥ 88×88 px**, tile mínimo **96 px de altura**, gap 10 px.
  - Preço é o elemento de maior contraste do tile (o olho vai para o preço primeiro).
- Sub-tile: estoque no rodapé (`12 un` / `só 2`). Produto zerado = tile apagado, não sumido —
  o operador precisa saber que o item existe e está esgotado.
- Paginação/infinite scroll por performance. 500+ produtos sem travar é requisito.
- **Favoritos/atalhos**: 12–20 produtos fixados numa faixa superior (biscoito, café, pão, refrigerante).
  É o que o mercadinho vende de verdade o dia inteiro.

### 1.2 Busca e leitor que não roubam o foco

- Campo de busca **sempre focado** ao longo da venda. Hoje `bindSearch()` faz
  `setTimeout(()=>input.focus(),0)` e qualquer `render()` reconstrói o `#view` inteiro
  → **o foco e o cursor são perdidos a cada item adicionado**. Isso é bug funcional, não só UX.
  → Corrigir com render parcial: só redesenhar `#productResults` / `.cart-list` / `#totals`,
    nunca o container inteiro.
- Leitor de código de barras entra pelo mesmo campo (USB HID = teclado). Comportamento:
  - Enter com 8+ dígitos → adiciona direto ao carrinho, **sem** diálogo.
  - `*`-prefixado ou unregistered → modal "produco não cadastrado" com
    [Cadastrar agora] [Vender avulso]. Hoje só existe um `toast` e o item se perde.
- Busca com **normalização de acentos** (`toLocaleLowerCase('pt-BR')` já é usado) — manter, e
  adicionar: tolerância a erro de digitação (digitar "refri" → "Refrigerante").
- Undo da última linha: `Ctrl+Z` remove o último item adicionado. Hoje inexistente e é a
  operação mais frequente numa fila compressa.

### 1.3 Layout e zonas da tela

Três zonas, larguras relativas (não px fixo) para sobreviver a monitor 1366×768 e touch 1080p:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOPO  [status caixa] [operador] [F1 Ajuda]      🕐 14:32   [Modo escuro]│
│ ┌──────────────────────────────────────────┐  ┌─────────────────────┐ │
│ │ CAMPO SCAN/ BUSCA  (sempre focado)      │  │ VENDA #1042         │ │
│ └──────────────────────────────────────────┘  │─────────────────────│ │
│ [Todos][Mercearia][Bebidas][Hortifruti]…      │ 123 Coca 2L     2  │ │
│ ┌────┐┌────┐┌────┐┌────┐┌────┐              │  x 5,49      10,98 │ │
│ │ 📷 ││ 📷 ││ 📷 ││ 📷 ││ 📷 │   ← grade     │─────────────────────│ │
│ │4,99││2,79││7,50││…    ││    │              │ …                   │ │
│ └────┘└────┘└────┘└────┘└────┘              │  [linha tocável]    │ │
│ ★ FAVORITOS ────────────────────────────    │─────────────────────│ │
├──────────────────────────────────────────────┤ Subtotal      31,44  │ │
│ [Suprimento][Sangria][Nova venda][Crediário]│ Desconto  ( 0,00)  │ │
│                                              │ ████ TOTAL 31,44 ██ │ │
│                                              │ [ FINALIZAR  F9  ]  │ │
│                                              └─────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

Regras de layout:
- `grid-template-columns: minmax(0,1.35fr) minmax(380px, 1fr)` — carrinho nunca abaixo de 380 px.
- **Altura útil** é o recurso escasso. Sem scroll de página no PDV: header fixo, lista do
  carrinho rola internamente, rodapé de totais **sempre visível**. Hoje tudo cresce junto e a
  coluna direita empurra o botão Finalizar para fora da tela quando o carrinho enche.
- Linha do carrinho = **uma linha só**, toque para editar/mudar quantidade. Botão remover
  separado. Hoje o nome ocupa 2 linhas e o `−` apaga o item em qty 1 (não há remoção explícita).
- Painel de pagamento entra como **overlay inferior em 2 etapas** (método → valor) em vez de
  empilhar campos; o total não sai do lugar.

### 1.4 Feedback, pagamento e confirmação

- Troco em **96 px**, junto com o total, dentro de um card verde de sucesso. Hoje o troco é uma
  linha de texto pequena que salta entre renders.
- Botão **FINALIZAR**: 72 px de altura, largura total da coluna, `position:sticky`.
- Teclado numérico na tela (0–9, 00, 00,00, limpar) — obrigatório se o caixa for touch e
  não tiver teclado numérico físico. É o caso comum.
- Trocar `confirm()`/`prompt()` por modais propios. Hoje **13+ chamadas nativas**:
  - `finishSale()` → `confirm()` com resumo da venda
  - `stockAdjust()` → `prompt()` pedindo quantidade
  - `receiveDebt()` → `prompt()` pedindo valor
  - `voidSale()` → `prompt()` pedindo motivo
  - `prompt()` para dinheiro é defeito real: sem máscara, aceita `,` e `.` de forma ambígua,
    sem validação enquanto digita. Todo input monetário passa por um campo com máscara
    pt-BR (`1.234,56`) e botão Confirmar.
- Erro = toast **não bloqueante** + shake no campo; nunca `alert()`.
- Ao finalizar: 3 resultados sonoros/visuais distintos — **concluída** (verde, troco),
  **pagamento insuficiente** (âmbar, "faltam R$ 5,00"), **erro** (vermelho).

### 1.5 Dark mode (pedido explícito)

Hoje: **zero**. `grep` confirma — `:root` define `--bg:#f4f6f8; --white:#fff; --ink:#17212d`
e não existe `prefers-color-scheme`, `data-theme` nem `.dark`. As variáveis já são o gancho
certo, então:

- Reescrever a paleta inteira como **tokens semânticos**, nunca cores literais:
  `--surface-1/2`, `--surface-raised`, `--text-1/2/3`, `--border`, `--accent`, `--success`,
  `--warning`, `--danger`. Regra dura: **zero hex no JS**.
- 3 temas: `claro` / `escuro` / `sistema` (`prefers-color-scheme`).
- Persistir em `localStorage` + aplicar antes do primeiro paint
  (`<script>` inline no `<head>`) para não piscar branco.
- Contraste: texto primário ≥ 7:1, secundário ≥ 4.5:1, ambos em dark.
- Manter `--green`/`--red`/`--amber` como **tokens**, não literais — hoje há `#ce4352`, `#b77a12`,
  `#087f5b` espalhados em regras fixas, que não respondem ao tema.
- Toggle persistente na topbar + atalho `Ctrl+D`.

---

## 2. P1 — O que impede o sistema ser um PDV de verdade

### 2.1 Fiscal (decisão de arquitetura, não um item de UI)

O recibo atual imprime literalmente **"COMPROVANTE NÃO FISCAL"**. Para um mercadinho brasileiro:

- Simples Nacional devarejista → **NFC-e é obrigatória**. MEI → relatório de receitas brutas.
- **NFC-e exige AC/autorizador (SEFAZ) ou intermediário**, assinatura digital e certificado.
  Isso **não roda em HTML + localStorage** — é impossível no modelo atual de arquivo único.
  Precisa ser decidido explicitamente antes de codar:
  - **(A) Continuar "não fiscal"** — barato, honesto, ok para operação informal. Deve exibir
    o aviso em letra legível no topo do comprovante.
  - **(B) Integrar provedor** (ex.: API de PSP/autorizador) via backend mínimo.
- Escolher (A) ou (B) é a **decisão de maior impacto do projeto inteiro**. Sem ela, "fiscal" vira
  item P4 e nunca fecha.
- Independente da escolha: **série e numeração de documento** por loja, com contador persistente
  e não pode reutilizar número após estorno (usar cancelamento, não apagar).
- Fields de produto para quando houver fiscal: **NCM**, **CEST**, **CFOP**, **unidade de
  medida**, **origem**, **código de CEST/CSOSN**. Hoje o modelo de produto é
  `{id, barcode, name, category, price, cost, stock, min}` — sem nenhum desses campos.

### 2.2 Durabilidade dos dados

- `localStorage` = ~5 MB e **uma aba**. Perder o navegador = perder o ano inteiro de vendas.
  Hoje só há um botão de backup manual que ninguém clica.
- Migração para **IndexedDB** (ou ao menos: autosnapshot a cada N vendas + warning de
  capacidade). Antes: mostrar contador de uso do storage na Configurações.
- **Lembrete de backup** — após X dias sem exportar, lembrar. É a diferença entre um sistema
  e um brinquedo.
- Proteção contra duplo clique/abas: venda deve ser gravada com **trava** (Web Locks API ou
  `localStorage` lock), senão dois caixas abertos no mesmo navegador vendem o mesmo estoque.

### 2.3 Entrada de dinheiro sem `prompt()`

- Todos os valores (desconto, recebimento, sangria, qtd) em campo com máscara, validação ao vivo
  e botão Confirmar. `Math.round(x*100)/100` está espalhado como padrão — centralizar em
  `toCents()` / `fromCents()` para não accumulating erro de float.
- Limite de desconto: hoje `maxDiscount` é **valor em R$**, não **percentual** — o dono
  provavelmente quer "%". Escolher um e rotular explicitamente.
- Campo de desconto no carrinho existe, mas o `Desconto` no total só é recalculado por
  `updateTotal()`; no render inicial a linha mostra `money(0)` fixo — **bug de display**.

---

## 3. P2 — Operação real do mercadinho

### 3.1 Balança e venda a peso ← o item mais subestimado

**Não existe nenhuma menção a balança, peso, tara ou unidade.** Para um mercadinho isso é
catastrófico: açúcar, feijão, arroz, carne, hortifruti são vendidos **a peso**, e representam
boa fatia do faturamento.

- Unidade de medida no produto: `UN`, `KG`, `G`, `L`, `ML`, `CX`, `PCT`.
- Integração de balança serial/USB: o peso lido entra direto como quantidade com 3 casas.
- Fallback obrigatório: campo manual de peso com **teclado numérico na tela**.
- "Tara" e arredondamento por HOUSECODE deve ser configurável.
- Painel da balança: peso, indicador de estabilidade e botão de tara na própria tela.

### 3.2 Validade, lote e perecível

Hoje `validade`/`lote` = **inexistente** (o único `vencimento` é um campo de lançamento
financeiro, não de produto).

- Produto: `validade`, `lote`, `data de entrada`.
- Bloqueio de venda de item vencido (configurável: bloquear ou alertar).
- Relatório "vence em X dias" — é onde está o prejuízo silencioso.
- FIFO na baixa de estoque (vence primeiro).

### 3.3 Compra e fornecedor

Hoje: **zero**. "fornecedor" aparece só como texto de exemplo num placeholder de categoria
de despesa. Sem compra não há custo real, giro, margem nem sugestão de reposição confiável.

- Cadastro de fornecedor, compras, itens da compra, recebimento parcial.
- Sugerir compra = cobertura (`estoque ÷ consumo médio`) < dias de cobertura configurável.
- Custo real por produto passa a ser **médio ponderado** das compras, não digitado à mão.
- Hoje a sugestão de reposição só existe no dashboard como "estoque ≤ mínimo" — reativo, não
  preditivo.

### 3.4 Venda suspensa (parked sale)

**Inexistente.** Em loja com 2 caixas ou fila de concorrência, é obrigatório: cliente entra, tira uma
cerva, esquece a batata — a venda fica pendente e o caixa atende o próximo.

- `Suspender venda` guarda carrinho + cliente num **fluxo de named** ("mesa 3", "fianco lá").
- Reabrir por nome, com lista das suspensas visível.
- Movimento de caixa **não** registrado ao suspender (só ao finalizar).

### 3.5 Rotinas de trabalho do caixa

- Tela de **Abertura/Conferência de caixa**: contagem cega por cédula/moeda, diferença calculada,
  justificativa obrigatória se ≠ 0. Hoje o fechamento não mostra contagem por denominação.
- Fechamento do dia com **relatório Z** (por forma de pagamento, ticket médio, sangrias,
  diferença de caixa). Hoje só existe `cashExpected` interno.
- **Crediário com carnê/parcelado**: parcelar uma venda, gerar parcelas com vencimento,
  baixa por parcela. Hoje o crediário é um saldo único, sem parcelas nem vencimento.
- Comissionamento de vendedor (frequente em Rede /-scale).
- Meta de vendas e ranking (o dono quer ver se a meta do mês está batendo).

---

## 4. P3 — Módulos que existem mas estão finos

### 4.1 Relatórios — hoje é o mais fraco

Conferido no código: `reportsView()` tem **2 cards** — top-8 produtos vendidos e um
parágrafo de Entradas/Saídas. E **não há nenhum gráfico** (`<svg>`, `canvas`, `getContext`
= 0 ocorrências no arquivo inteiro). A referência (screenshot do Smo Store) tem ~40 relatórios.

Adicionar, em ordem de uso real pelo dono:

1. **Vendas por dia** (gráfico de barras) + acumulado do mês
2. **Fechamento do dia / Relatório Z** (por forma de pagamento, troco, sangrias)
3. **Margem e lucro real** — hoje existe `cost` no produto mas **nenhum relatório usa**
4. **Curva ABC** de produtos (20% dos SKUs = 80% do faturamento)
5. **Giro de estoque** e **estoque parado** (dinheiro travado em estoque que não vende)
6. **Vendas por forma de pagamento** e por horário (pico de movimento → escala de pessoal)
7. **Perdas e estornos** (taxa de estorno é indicador de problema)
8. **Produtos mais lucrativos** (não mais vendidos — os dois são coisas diferentes)
9. **DRE simples** (receita − CMV − despesas = resultado)
10. **Vendas por cliente** e **clientes inadimplentes**

Gráficos: SVG inline ou canvas puro, sem biblioteca. 0 dependências é uma restrição real
(roda de um `python -m http.server` offline).

### 4.2 Produtos

- Gerar **código de barras** (EAN-13 interno) para produtos sem código.
- **Importar** cadastro por planilha (a loja hoje cadastra item por item — o gargalo real
  de onboarding). CSV → `FileReader` + preview antes de gravar.
- **Imagens**: hoje não há suporte nenhum (`<img>`, `thumbnail`, `foto` = 0). Foto é o que
  mais ajuda o operador a achar o produto sem ler.
- Preço em massa por categoria; **preço promocional** com janela de validity.
- Código de barras com **prefixo de peso** (789...20 = pesa na balança).

### 4.3 Clientes e crediário

- **CPF/CNPJ com validação de dígito verificador** + máscara. Hoje `CPF` aparece 10× como
  rótulo de campo texto, sem máscara nem validação — e CPF errado quebra o carnê.
- Cadastro rápido **dentro do PDV** (não obrigar a sair do caixa para vender a prazo).
- Busca incremental no select de cliente do PDV (hoje é `<select>` puro: 500 clientes = 500
  opções, impossível de usar).
- Telefone com máscara e link `tel:`/WhatsApp para cobrança.
- Fiado: limite, histórico de pagamentos, bloqueio automático ao estourar, e **aviso visual
  no PDV** quando o cliente está no limite — o caixa precisa ver isso *antes* de vender, não
  receber um `toast` depois.
- Score/assinatura: cliente de 6 meses sem pagar.

### 4.4 Financeiro

- **Contas a pagar e a receber com vencimento** — o arquivo se chama `contas a pagar
  receber.html` e é um redirect de 382 bytes, ou seja, o dono pediu isso e não existe.
- Módulo hoje é só um CRUD de `entries`. Falta: agenda de vencimentos, contas recorrentes
  (aluguel, energia, fornecedor), fluxo de caixa projetado.
- Conciliação:.expected do caixa físico vs. soma das entradas.
- Deduplicação: uma venda gera N lançamentos idênticos à mão em `entries` — automatizar e
  garantir 1 venda = 1 lançamento por forma de pagamento (já quase está; blindar).

---

## 5. P4 — Integrações e hardware

| Item | Nota |
|---|---|
| **Impressora térmica ESC/POS** | Hoje só `window.print()` numa popup de 380 px — não écnica térmica de verdade. Via **WebUSB** ou servidor local. Prioridade alta: recibo em bobina é o mínimo real. |
| **Gaveta de dinheiro** | `drawer` aparece 3× no CSS, mas é o **drawer da sidebar**, não gaveta. Integrar pulso de gaveta ao finalizar/estornar. |
| **Leitor de código de barras** | USB HID já funciona como teclado. Falta: suportar leitor com sufixo, e leitor de **balança** que também emula teclado. |
| **Impressora de etiquetas** | Padrão ZPL. Liberar etiqueta com código de barras e preço para repor gôndola. |
| **Sorteio de senhas** | `№` sequencial visível no topo ("senha 47") — resolve o "pulei minha vez" sem aumentar o número de chamadas ao caixa. |
| **Sincronização / 2º caixa** | Dois caixas no mesmo computador é o próximo pedido previsível. Exige backend — mesmo bloqueio do fiscal. |

---

## 6. Ordem de execução sugerida

| Sprint | Conteúdo | Resultado |
|---|---|---|
| **S1** | Tema em tokens + 3 temas + render parcial sem perder foco | some o flash, some o bug de foco |
| **S2** | Grade de produtos + categorias + favoritos | **a tela volta a parecer um PDV** |
| **S3** | Layout 3 zonas + carrinho interno + pagamento em overlay + teclado numérico | a tela para de quebrar com carrinho cheio |
| **S4** | Modais próprios no lugar de `confirm`/`prompt` + máscara de dinheiro | sai o ar de "protótipo" |
| **S5** | Desconto %, finalizar com 3 estados, estorno e devolução com modal | fluxo de caixa confiável |
| **S6** | Balança/unidade/peso + validade/lote | cai a lacuna de perishável |
| **S7** | Compra/fornecedor + custo médio + sugestão de reposição |finally dá paralucro |
| **S8** | Relatórios P3.1 (com gráficos) + CPF validado | dono enxerga o negócio |
| **S9** | NFC-e (**decisão A/B da §2.1**) ou aviso legal forte | conformidade |
| **S10** | Impressora térmica + gaveta + etiquetas | operação real |
| **S11** | Contas a pagar/receber + carnê parcelado | fecha o pedido do dono |
| **S12** | IndexedDB + backup automático + trava de venda | não perde dinheiro |

---

## 7. Armadilhas concretas do código atual

1. `render()` reescreve `#view` inteiro a cada ação → foco, cursor e scroll **sempre** perdidos.
   Esta é a causa raiz da sensação de "horrível" tanto quanto o layout.
2. `Object.defineProperties(window, ...)` para expor `method`, `filter`, `saleDiscount` ao inline
   `onclick` — funciona, mas torna o estado global implícito e frágil. Preferir delegação de
   evento com `data-` attributes.
3. Todo handler está em `window.*` e o HTML é montado por template string → um `</div>` faltando
   numa string quebra a página inteira sem erro no console. Render programático com `createElement`
   elimina essa classe de bug.
4. `filter` é declarado e nunca aplicado na view — filtro morto.
5. Linha "Desconto" do total renderiza `money(0)` no HTML inicial; só `updateTotal()` corrige.
6. `qrcode-vendor.js` é usado como global `qrcode` — dependência da ordem dos `<script>`.
7. localStorage como fonte da verdade: `persist()` com `try/catch` engole quota exceeded e
   só mostra toast — a venda **já foi** registrada na UI.
8. `crypto.randomUUID()` para `id` de produto/cliente — não requer contexto seguro em alguns
   navegadores quando servido por IP; usar contador ou fallback.
9. `parseFloat`/Number sem locale helper para valores vindos de `prompt` — vírgula vs ponto.
10. 9 arquivos `.html` de 382 bytes que só redirecionam: lixo que o dono vai abrir esperando
    conteúdo. Apagar ou transformar em atalhos reais.
