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
┌──────────────┐      http://IP:8787     ┌────────┐
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

## Segurança da rede local

Tudo trafega em HTTP puro na LAN, então o servidor trata o que é gratuito:

- **Toda rota `/api` exige sessão.** O `/api/login` emite um token (12 h) que
  vai em `Authorization: Bearer`; sem ele a resposta é 401. Sobe e desce
  junto com o servidor, então reiniciar o mini PC não desconecta os caixas.
  Única exceção: `/api/migrar` responde sem token **apenas** enquanto o banco
  não tiver nenhum usuário (o primeiro acesso, quando ainda não há conta
  para entrar). Depois do primeiro usuário ela tranca.
- **O banco não é servido por HTTP.** O servidor nega `.db`, `-wal`, `-shm`
  e as pastas `servidor/`, `_backup/`, `dist/`, `icone/`, `.git/`.
  Antes disso, `GET /servidor/dados/sudam.db` baixava o banco inteiro —
  clientes, CPF, dívidas e hashes de senha — sem digitar senha nenhuma.
- **Cabeçalhos**: CSP `default-src 'self'`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **Senha no servidor é scrypt**, não o FNV do app antigo. O hash legado
  ainda converte no primeiro login, sem obrigar o gerente a recriar senha.
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
sudo ./instalar-linux.sh                  # instala só o serviço (HTTP na 8787)
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
node servidor.mjs

# 3. Acesse no navegador
http://localhost:8787
```

Nos caixas da rede: `http://IP-DO-MINI-PC:8787`

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

## Migrar os dados que já existem

O app historicamente guardava tudo no `localStorage` do navegador. Com o
servidor no ar:

1. Entre no sistema (`admin` / `1234` no primeiro acesso).
2. **Ajustes → Dados → Migrar dados para o servidor**.
3. Confirme. A contagem do que subiu aparece em seguida.

A migração so responde sem token enquanto o banco estiver sem nenhum usuário.
Depois do primeiro cadastro ela exige sessão, como as demais rotas.

## Testes

```bash
node servidor/teste/e2e.mjs "%TEMP%" "%CD%\servidor"
```

Sobe um servidor descartável e confere o fluxo inteiro: bootstrap da migração,
login com senha scrypt, bloqueio de sessão ausente, gravação de produto e
cliente, venda em transação, preço vindo do servidor, divergência de estoque,
idempotência, coleções genéricas, logout e a recusa de servir o `.db`.

São **112 asserções**, incluindo as regressões de segurança: pagamento parcial,
troco forjado, crédito inflado, quantidade negativa, autoria de venda forjada,
estorno de venda alheia por caixa, corpo grande demais e token na URL.

No Linux (o `\` vira `/`):

```bash
node servidor/teste/e2e.mjs /tmp/pdvt "$PWD/servidor"
```

### Restaurar um backup (testado)

```bash
node servidor/teste/backup-restaura.mjs /tmp/pdv-r "$PWD/servidor"
```

21 asserções que fazem o caminho inteiro: popula um banco, grava o backup,
copia o par `.db`/`-wal` para uma pasta nova, sobe um servidor apontado só para
essa cópia e confere que voltaram o login do admin, os produtos, o preço, o
estoque já descontado, o cliente, a venda e o config.

### Fila offline e XSS no frontend (testado)

```bash
node servidor/teste/api-fila.mjs "$PWD"
node servidor/teste/frontend-seguro.mjs "$PWD"
```

`api-fila.mjs` roda o `js/api.js` de verdade num `sandbox` de `localStorage` e
`fetch` falsos: 27 asserções para a fila de venda quando a internet cai — deque,
duplo enfileiramento, pílula venenosa, 401 e recusa definitiva.

`frontend-seguro.mjs` (15 asserções) é um guarda de segurança em duas frentes.
Primeiro, o app monta quase tudo com `innerHTML`, então qualquer campo do banco
concatenado sem `esc()` vira HTML injetado: o teste varre `js/*.js` e falha se um
campo de dado (`emoji`, `color`, `address`, `obs`, …) entrar numa linha que monta
markup sem escape. Segundo, ele falha se algum `.html` tiver `<script>` inline —
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

### Sincronização de cadastro (testado)

```bash
node servidor/teste/sync-cadastro.mjs /tmp/pdv-s "$PWD/servidor"
```

16 asserções: o que o caixa cadastra chega ao servidor e um segundo caixa
enxerga, com preço e estoque decididos no servidor, reenvio sem duplicar
(upsert por id) e estorno devolvendo estoque e baixando a dívida do cliente.

Para restaurar de verdade, a mão:

```bash
sudo systemctl stop sudam-pdv
sudo cp /var/backups/sudam-pdv/sudam.<carimbo> /var/lib/sudam-pdv/sudam.db
sudo systemctl start sudam-pdv
```

O `.db` é copiado antes do `-wal`, nessa ordem — é a ordem segura, porque o WAL
copiado nunca fica mais velho que o `.db`. Todo backup passa por
`wal_checkpoint(TRUNCATE)` antes de copiar.

---

## Estrutura do projeto

```
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
