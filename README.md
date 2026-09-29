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

---

## Instalação

### Opcional — instalador Windows
```
COMPILAR-INSTALADOR.bat   # gera dist/Sudam-Gestao-PDV-Setup-1.0.0.exe
```
Cria atalho no menu Iniciar, abre no navegador padrão. Não requer Python.

### Manual — Node.js (qualquer Windows)
```bash
# 1. Instale Node.js >= 22 (node:sqlite já vem embutido)
node --version   # deve ser v22+

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
- **Backup:** o botão fica no app; o servidor faz snapshot diário automático
- **Não versionar:** `dados/`, `*.db`, `node_modules/`, `_backup/`

---

## Licença

Proprietária — Sudam Gestão PDV