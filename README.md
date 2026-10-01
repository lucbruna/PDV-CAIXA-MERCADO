# Sudam Gestão PDV · Frente de caixa para mercadinho brasileiro

Sistema completo de PDV — caixa, estoque, crediário, financeiro e relatórios —
rodando num só arquivo. Sem nuvem, sem assinatura, sem internet.

[![GitHub repo](https://img.shields.io/badge/repo-lucbruna%2FPDV--CAIXA--MERCADO-blue)](https://github.com/lucbruna/PDV-CAIXA-MERCADO)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/licenca-proprietaria-lightgrey)]()

---

## Como funciona

```
MINI PC (loja)                CAIXAS (rede local)
┌──────────────┐       HTTPS via proxy    ┌────────┐
│ node servidor │◄───────────────────────│ Chrome │
│ + SQLite      │                        └────────┘
│ porta 8787    │   ┌────────┐ ┌────────┐
│ dados/sudam   │   │CAIXA 2 │ │CAIXA 3 │
└──────────────┘   └────────┘ └────────┘
```

- **Serve o app + a API na mesma origem** — zero proxy, zero CORS
- **SQLite com WAL** — sem teto de armazenamento, lê enquanto grava
- **5 caixas** simultâneos sem perceber atraso; 10+ funciona, mas escreve em fila
- Internet cai? Não afeta. Mini PC desliga? Caixas param (sem servidor não há venda)

---

## Recursos

| Módulo | O que faz |
|---|---|
| **Frente de caixa** | busca/scan de produtos, carrinho, parcelamento, troco |
| **Pix BR Code** | QR Code EMV TLV com chave + cidade, copia-e-cola |
| **Caixa / Turno** | abrir, fechar, conferência cega, sangria, suprimento |
| **Crediário** | limite bloqueado no PDV, reversão no estorno, recebimento parcial |
| **Estorno** | motivo obrigatório + devolução de estoque + reversão de caixa |
| **Financeiro** | lançamentos, contas a pagar/receber |
| **Relatórios** | top produtos, entradas/saídas |
| **Backup** | export/import JSON + CSV de vendas; servidor faz snapshot automático |
| **Auth** | scrypt (N=16384, sal por usuário) + sessão por token, roles admin/operador |
| **Preços e promoções** | ajuste de preço em massa e preço promocional por produto, com data de início e fim |

## Preços e promoções

A ferramenta fica em **Ajustes → Preços e promoções** e cobre duas coisas
independentes: o ajuste em massa e o preço promocional por produto.

### Ajuste de preço em massa

O cartão **Preços e promoções** em Ajustes abre um modal que altera o preço de
venda de vários produtos de uma vez:

- **Operação:** *aumentar* ou *reduzir* (reduzir é o caminho da promoção).
- **Quanto:** o valor da mudança, em **percentual (%)** ou em **reais (R$)**.
- **Aplicar em:** *todos os produtos do filtro* ou *apenas os selecionados*, com
  marcação individual na lista.
- **Filtrar por categoria:** limita o alcance a uma categoria.

A prévia mostra quantos produtos serão atualizados e um exemplo
(`Arroz: R$ 25,90 → R$ 23,31`) antes de confirmar. Cada produto alterado é
enviado ao servidor (`marcarCadastro`), então os outros caixas passam a vender
pelo preço novo na próxima sincronização. O preço nunca cai abaixo de R$ 0,01.

### Preço promocional por produto (com data de início e fim)

No cadastro do produto, aba **Preço e margem**, há três campos:

| Campo | Função |
|---|---|
| **Preço promocional (R$)** | preço de venda durante a promoção; `0` ou vazio desativa |
| **Promoção a partir de** | data de início (opcional) |
| **Promoção até** | data de fim (opcional) |

Regras:

- Sem datas, a promoção vale até ser removida. Com datas, vale só dentro da
  janela (a data final é inclusive).
- Enquanto a promoção está vigente, o **PDV aplica o preço promocional
  automaticamente** — tanto no card do produto quanto no carrinho.
- Na frente de caixa e na lista de produtos o promocional aparece destacado e o
  preço cheio fica riscado ao lado.
- A data final precisa ser depois da inicial; a validação bloqueia o contrário.
- O ajuste em massa e a promoção por produto são independentes: o ajuste mexe no
  preço cheio (`price`), a promoção vive nos campos próprios e não é sobrescrita
  por um ajuste em massa.

## Segurança da rede local

O servidor exige HTTPS quando escuta em uma interface de rede. Sem TLS, inicia
somente em `localhost`; a exceção `SUDAM_PERMITIR_HTTP_LAN=1` é explícita e deve
ficar restrita a uma LAN isolada.

- **Toda rota `/api` exige sessão.** O `/api/login` emite um token (12 h) que
  vai em `Authorization: Bearer`; sem ele a resposta é 401. Sobe e desce
  junto com o servidor, então reiniciar o mini PC não desconecta os caixas.
  Única exceção: `/api/migrar` funciona sem token somente a partir do próprio
  servidor, enquanto o banco está vazio, e exige um administrador ativo. A
  inicialização é revalidada dentro de uma transação para impedir corrida.
- **O banco não é servido por HTTP.** O servidor nega `.db`, `-wal`, `-shm`
  e as pastas `servidor/`, `_backup/`, `dist/`, `icone/`, `.git/`.
  Antes disso, `GET /servidor/dados/sudam.db` baixava o banco inteiro —
  clientes, CPF, dívidas e hashes de senha — sem digitar senha nenhuma.
- **Cabeçalhos**: CSP `default-src 'self'`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **Senha no servidor é scrypt**, não o FNV do app antigo. O hash legado
  ainda converte no primeiro login, sem obrigar o gerente a recriar senha.
- **Troca de senha no servidor** exige a senha atual, aceita nova senha de
  12–256 caracteres e encerra as outras sessões da conta. Troque `admin` / `1234`
  em **Ajustes → Usuários e acessos → Trocar minha senha** antes de abrir a loja.
- **O dinheiro é conferido no servidor.** Preço, quantidade, soma dos
  pagamentos e troco são recalculados no servidor; o cliente não decide o
  valor final. Quantidade negativa e preço/estoque negativo são recusados.
- **Corpo da requisição tem limite** (2 MB, 64 MB na migração) e **o token não
  vai na URL** — só em `Authorization: Bearer`, exceto em `GET`/`HEAD`.
- **Somente admin e gerente** mexem em configuração e estornam venda de outro
  caixa. Caixa só estorna a própria venda — e **quem vendeu é registrado a
  partir da sessão**, então o corpo da requisição não consegue forjar a
  autoria da venda.
- **Erro 500 não vaza detalhe interno** para o navegador.

---

## Instalação

### Opcional — instalador Windows
```
COMPILAR-INSTALADOR.bat   # gera dist/Sudam-Gestao-PDV-Setup-1.0.0.exe
```
Cria atalho no menu Iniciar, abre no navegador padrão. Não requer Python.

### Linux — instalador automático (recomendado no mini PC)

```bash
sudo ./instalar-linux.sh --com-nginx     # instala + HTTPS na porta 443
sudo ./instalar-linux.sh --permitir-http-lan # só em LAN isolada
sudo ./instalar-linux.sh --desinstalar    # remove, preservando os dados
```

O script é idempotente: rodar de novo atualiza a instalação e mantém o banco.
Ele instala como serviço systemd e **não apaga os dados** em nenhum caminho —
inclusive na desinstalação, porque quem troca de máquina não quer perder a venda
do dia.

**Pré-requisitos**

```bash
sudo apt install -y nodejs nginx      # Debian/Ubuntu
sudo dnf install -y nodejs nginx      # Fedora
```

Node >= 22.5 (o sistema usa `node:sqlite`). O instalador aceita o Node do
sistema; um Node instalado via `nvm` (em `/home/...`) **não serve**, porque o
serviço roda com `ProtectHome=true` e não enxerga o `/home`. Se o seu Node está
em caminho de usuário, instale o pacote do sistema.

**O que ele faz**

| | |
|---|---|
| Usuário de serviço | `sudam`, sem shell e sem login — o Node não roda como root |
| Binários | `/opt/sudam-pdv` (root, somente leitura para o serviço) |
| Banco | `/var/lib/sudam-pdv/sudam.db` |
| Backups | `/var/backups/sudam-pdv/` |
| Service | `sudam-pdv.service`, reinicia sozinho se cair |
| Logs | `sudo journalctl -u sudam-pdv -f` |

O serviço é blindado com `ProtectSystem=strict`, `ProtectHome=true`,
`NoNewPrivileges`, `PrivateDevices` e só pode gravar nas duas pastas de dados.
O processo escuta em `127.0.0.1` — com `--com-nginx`, a entrada dos caixas é
`https://IP-DO-SERVIDOR/` e a porta 8787 **não** fica exposta na rede.

**Sobre o HTTPS**: o certificado é autoassinado, então o navegador vai avisar
na primeira visita — é esperado. Para não ter o aviso, use um domínio com
certificado real, substituindo o bloco `server` em
`/etc/nginx/conf.d/sudam-pdv.conf`.

O instalador também guarda o site padrão do nginx antes de assumir a porta 80
(HTTP redireciona para HTTPS) e o devolve na desinstalação.

**Apontar para outro banco/porta** (sem reinstalar):

```bash
sudo systemctl edit sudam-pdv
# [Service]
# Environment=SUDAM_DB=/mnt/dados/pdv.db
# Environment=SUDAM_PORTA=8787
sudo systemctl restart sudam-pdv
```

### Manual — Node.js (qualquer Windows)
```bash
# 1. Instale Node.js >= 22.5 (necessário para node:sqlite)
node --version   # deve ser v22.5+

# 2. Suba o servidor
cd servidor
set SUDAM_HOST=127.0.0.1
node servidor.mjs

# 3. Acesse no navegador
http://localhost:8787
```

Para acesso pela rede, configure TLS conforme as instruções Linux ou Windows.
Sem TLS, o servidor aceita apenas `http://localhost:8787`.

### Configurar porta
```bash
set SUDAM_PORTA=9090 && node servidor.mjs
```

### Configurar banco
```bash
set SUDAM_DB=C:\dados\pdv.db && node servidor.mjs
```

O backup acompanha o banco: com `SUDAM_DB` apontando para outro disco, as
cópias vão para `<pasta-do-banco>\backup`. Para separá-las de vez, use
`SUDAM_BACKUP=C:\backup-pdv`. (Backup no mesmo disco do banco não protege
contra o disco morrer — só contra arquivo corrompido.)

Para espelhar cada backup verificado em outro disco (recomendado), defina
`SUDAM_BACKUP_ESPELHO=E:\Sudam\backup` antes de iniciar o servidor. O PDV
mantem 24 copias recentes e mais uma copia diaria por 30 dias. Ajustes mostra
a ultima copia verificada e eventuais falhas no espelho.

### Onde os dados ficam no Windows

Fora da pasta do programa: `%ProgramData%\Sudam Gestao PDV\dados\sudam.db`.
Reinstalar ou apagar a pasta do aplicativo **não** apaga mais o histórico. Numa
instalação antiga (com o banco em `servidor\dados`), o servidor copia esse banco
para o novo local no primeiro boot e passa a usar a cópia — o arquivo antigo
fica no lugar, por segurança.

### Liberar o acesso dos caixas (firewall)

O Windows bloqueia conexões de entrada por padrão. Depois de configurar HTTPS,
rode `LIBERAR-FIREWALL.bat` **como administrador**: ele libera a porta 8787
apenas para a rede local (`remoteip=localsubnet`, perfil privado). Sem TLS, o
servidor aceita conexões somente deste computador.

### HTTPS no Windows (necessário para acesso pela rede)

Sem HTTPS, o servidor limita o listener a `localhost`; os outros caixas não
conseguem se conectar. Para liberar acesso pela rede, configure TLS:

1. `powershell -ExecutionPolicy Bypass -File GERAR-CERTIFICADO.ps1` — gera um
   certificado autoassinado (sem precisar de administrador), cria uma senha
   aleatória para o `.pfx` e mostra ambos.
2. Suba o servidor com:

```bash
set SUDAM_TLS=1
set SUDAM_PFX=C:\caminho\certificado.pfx
set SUDAM_PFX_SENHA=COLE_A_SENHA_IMPRESSA
INICIAR PDV.bat
```

O navegador avisa do certificado autoassinado na primeira visita — é esperado,
como no nginx do Linux. Acesse por `https://localhost:8787`.

## Migrar os dados que já existem

O app historicamente guardava tudo no `localStorage` do navegador. Com o
servidor no ar:

1. Entre no sistema (`admin` / `1234` no primeiro acesso).
2. **Ajustes → Dados → Migrar dados para o servidor**.
3. Confirme. A contagem do que subiu aparece em seguida.

A migração inicial precisa ser feita no próprio servidor. A rota só funciona
sem sessão enquanto o banco está vazio e recebe um administrador ativo; depois
disso ela exige sessão, como as demais rotas.

## Testes

```bash
node servidor/teste/e2e.mjs "%TEMP%" "%CD%\servidor"
```

Sobe um servidor descartável e confere o fluxo inteiro: bootstrap da migração,
login com senha scrypt, bloqueio de sessão ausente, gravação de produto e
cliente, venda em transação, preço vindo do servidor, divergência de estoque,
idempotência, coleções genéricas, logout e a recusa de servir o `.db`.

São **123 asserções**, incluindo as regressões de segurança: pagamento parcial,
troco forjado, crédito inflado, quantidade negativa, autoria de venda forjada,
estorno de venda alheia por caixa, escrita por coleção bloqueada por perfil,
dinheiro em centavos inteiros, corpo grande demais e token na URL.

No Linux (o `\` vira `/`):

```bash
node servidor/teste/e2e.mjs /tmp/pdvt "$PWD/servidor"
```

### Restaurar um backup (testado)

```bash
node servidor/teste/backup-restaura.mjs /tmp/pdv-r "$PWD/servidor"
```

20 asserções que fazem o caminho inteiro: popula um banco, grava o backup
(`VACUUM INTO`, **um arquivo só**, sem par `.db`/`-wal` para desencontrar),
copia esse arquivo para uma pasta nova, sobe um servidor apontado só para essa
cópia e confere que voltaram o login do admin, os produtos, o preço, o estoque
já descontado, o cliente, a venda e o config.

### Fila offline e XSS no frontend (testado)

```bash
node servidor/teste/api-fila.mjs "$PWD"
node servidor/teste/frontend-seguro.mjs "$PWD"
```

`api-fila.mjs` roda o `js/api.js` de verdade num `sandbox` de `localStorage` e
`fetch` falsos: 27 asserções para a fila de venda quando a internet cai — deque,
duplo enfileiramento, pílula venenosa, 401 e recusa definitiva.

`frontend-seguro.mjs` (15 asserções) é um guarda de segurança em duas frentes.
Primeiro, as telas montam DOM com `createElement`, mas o corpo dos modais de
formulário ainda é markup constante em string — então qualquer campo do banco
concatenado sem `esc()` viraria HTML injetado: o teste varre `js/*.js` e falha
se um campo de dado (`emoji`, `color`, `address`, `obs`, …) entrar numa linha
que monta markup sem escape. Segundo, ele falha se algum `.html` tiver
`<script>` inline —
o servidor manda `script-src 'self'`, sem `'unsafe-inline'`, então o navegador
bloqueia e não avisa. O `index.html` já teve dois blocos assim (o coletor de erro
e o watchdog que mostra "O sistema não conseguiu iniciar"); nenhum dos dois rodava.
Ambos foram para `js/boot.js`, que precisa ser o primeiro script da página. O
teste também confere essa ordem.

O `emoji` do cadastro de produto é texto livre e era renderizado cru em ~15
lugares (grade do PDV, estoque, relatórios, financeiro). Com o `Content-Security-Policy`
atual (`script-src 'self'`, `form-action 'self'`, `base-uri 'self'`) um payload
injetado **não executa JavaScript** — o estrago real era HTML/CSS injetado
(falsa tela de "sessão expirada", DOM quebrado). Ainda assim foi corrigido, porque
passa a ser XSS completo se o CSP for afrouxado ou se o app for aberto por
`file://`, sem cabeçalho nenhum.

### Navegador de verdade: XSS e CSP nas telas reais (testado)

```bash
node servidor/teste/navegador-seguro.mjs "%TEMP%" "%CD%\servidor"
```

55 asserções que abrem o app no Chrome headless (via DevTools Protocol, sem
dependência nova), fazem **login pela própria tela**, gravam um produto (com
preço promocional) e um cliente com payload de XSS e conferem: nenhum elemento
injetado aparece em Início, PDV, Vendas, Produtos, Compras, Clientes,
Financeiro, Contas, Relatórios e Ajustes; nenhuma dessas telas cai na tela de
erro; o payload aparece como texto (foi escapado, não removido); a ferramenta
de preços abre e calcula a prévia; o preço promocional vigente troca o preço no
carrinho e expira fora da janela; e o CSP bloqueia `<script>` inline e handler
inline (`onerror`). O próprio teste injeta o payload cru antes, como controle,
para provar que o detector enxerga o ataque quando ele existe.

Também exercita o **Pix por valor parcial**: com um item no carrinho e a parte
Pix digitada, o QR passa a cobrar a **parte** (não o total); o rótulo
"Confirmar recebimento" lança a parte já marcada como recebida; e um **segundo
Pix** (duas pessoas dividindo a conta) abre outro QR cobrando o restante. E
confere a **versão na tela de Ajustes** e o **painel de prontidão fiscal**
(abre, lista o que falta e aplica os padrões seguros).

Requer o Google Chrome instalado (caminho padrão; use `CHROME` para apontar
outro).

### Dinheiro: migração para centavos inteiros (testado)

```bash
node servidor/teste/centavos-migracao.mjs "%TEMP%" "%CD%\servidor"
```

10 asserções que abrem um banco no formato antigo (colunas `REAL`, sem a flag
`centavos`), deixam o `banco.mjs` migrar e conferem que as colunas de dinheiro
viraram centavos inteiros (4.5 → 450), que o JSON continua em reais e que
reabrir não converte duas vezes.

### Sincronização de cadastro (testado)

```bash
node servidor/teste/sync-cadastro.mjs /tmp/pdv-s "$PWD/servidor"
```

16 asserções: o que o caixa cadastra chega ao servidor e um segundo caixa
enxerga, com preço e estoque decididos no servidor, reenvio sem duplicar
(upsert por id) e estorno devolvendo estoque e baixando a dívida do cliente.

### Pix e dados fiscais (testado)

```bash
node servidor/teste/pix-fiscal.mjs "%TEMP%" "%CD%\servidor"
```

46 asserções em duas frentes. No cliente, o payload **BR Code** é conferido
campo a campo contra a spec (TLV, GUI `BR.GOV.BCB.PIX`, moeda 986, valor, nome,
cidade, txid) e o CRC16 contra o vetor padrão do algoritmo do Pix
(`CRC-16/CCITT-FALSE`, `"123456789" → 29B1`); a normalização da chave cobre
CPF, CNPJ (sem DDI indevido), telefone com e sem `+55` e e-mail; e o gerador de
QR (`js/qr.js`) é checado por sanidade — SVG válido, módulos coerentes e saída
determinística. No servidor, sobe o `servidor.mjs` de verdade e confirma que os
campos fiscais do produto (NCM, CFOP, CSOSN, CEST, origem, CST/CST PIS/COFINS)
e a config fiscal (CRT, CNAE, código IBGE, inscrição municipal, CEP, UF, e-mail
e telefone fiscal, chave/cidade Pix) sobrevivem ao vai-e-volta do
`/api/migrar` para o `/api/base`.

O teste **não** emite NFC-e — o sistema declara que não emite (ver
`CHECKLIST-PDV.md` §2.1). O que ele garante é o armazenamento correto do dado
fiscal e a geração do QR Pix de cobrança.

Para restaurar de verdade, a mão:

```bash
sudo systemctl stop sudam-pdv
sudo cp /var/backups/sudam-pdv/sudam.<carimbo> /var/lib/sudam-pdv/sudam.db
# limpe o WAL antigo, senão o SQLite pode reaplicar frames de antes do restauro
sudo rm -f /var/lib/sudam-pdv/sudam.db-wal /var/lib/sudam-pdv/sudam.db-shm
sudo systemctl start sudam-pdv
```

Cada backup é **um arquivo só**: o `VACUUM INTO` do SQLite escreve a cópia
inteira já com o WAL aplicado, então não existe a janela em que `.db` e `-wal`
não batem (uma venda entrando no meio da cópia). É só copiar o arquivo de volta.

---

## Versionamento

A versão do programa vive num arquivo só: **`VERSION`** (uma linha, ex.:
`2.0.0`). O servidor lê dele e reporta em `/api/status`; o instalador lê dele
via o helper abaixo. Nada de número duplicado em dois lugares.

```bash
node versao.mjs            # mostra a versão atual
node versao.mjs bump patch # 2.0.0 -> 2.0.1 (também: minor, major)
node versao.mjs sync       # reescreve #define AppVersion no instalador.iss
```

Convenção: **cada commit sobe a versão** (`bump patch`/`minor`/`major`) e a
tag `vX.Y.Z` marca o commit no GitHub. O workflow
`.github/workflows/versao.yml` cria a tag automaticamente a cada push na
`main`, lendo o `VERSION` — commits sem bump não geram tag nova, e uma tag
existente nunca é movida.

O `COMPILAR-INSTALADOR.bat` roda `node versao.mjs sync` antes de compilar, para
o instalador nunca sair com a versão antiga.

---

## Estrutura do projeto

```
├── VERSION             # fonte única da versão
├── versao.mjs          # mostra / sobe / sincroniza a versão
├── index.html          # app principal (uma página; o resto são stubs de redirecionamento)
├── js/                 # api, store, qr, ui, pdv, app
├── css/                # app.css, vertice.css
├── servidor/
│   ├── servidor.mjs    # entry point — HTTP + rotas + sessão
│   ├── banco.mjs       # SQLite genérico por coleção
│   ├── auth.mjs        # scrypt + sessões
│   ├── venda.mjs       # registrar venda, sequência
│   ├── backup.mjs      # backup automático
│   └── teste/e2e.mjs   # teste ponta a ponta por HTTP
├── dist/               # instalador Inno Setup
└── CHECKLIST-PDV.md    # roadmap completo do projeto
```

---

## Arquitetura

Ver [ARQUITETURA.md](servidor/ARQUITETURA.md) — decisões de rede,
conflito de estoque, divergência e migração do localStorage.

---

## Tecnologias

Node.js 22+ (zero dependências externas — `node:http`, `node:fs`, `node:sqlite`)

---

## Observações

- **Dinheiro em centavos inteiros:** o servidor guarda e calcula valores em
  centavos (`servidor/dinheiro.mjs`), para a soma de muitas linhas não derivar
  em ponto flutuante. O JSON que o cliente lê continua em reais — é o contrato
  das telas. As colunas de dinheiro no SQLite são `INTEGER` em centavos e a
  conversão de bancos antigos acontece uma vez, no primeiro boot.
- **Fiscal:** hoje emite "comprovante não fiscal". NFC-e exige decisão A/B
  (sem fiscal / integrado com provedor) — ver CHECKLIST-PDV.md §2.1
- **localStorage legado:** dados antigos migram via `Ajustes → Migrar para o servidor`
- **Backup:** o botão fica no app; o servidor faz snapshot automático a cada
  hora, com rotação de 30 dias e backup final no desligamento
- **Erro não derruba a loja:** exceção não tratada fecha o banco e sai com
  código de erro; quem reergue é o systemd (`Restart=always`, com limite de 5
  quedas por minuto para não entrar em laço)
- **Não versionar:** `dados/`, `*.db`, `node_modules/`, `_backup/`

---

## Licença

Proprietária — Sudam Gestão PDV
