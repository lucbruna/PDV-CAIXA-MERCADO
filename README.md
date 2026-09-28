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
| **Backup** | export/import JSON + CSV de vendas |
| **Auth** | PBKDF2 210k iterações, roles admin/operador |

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

---

## Estrutura do projeto

```
├── index.html          # app principal (IIFE minificado)
├── js/                 # store, qr, ui, pdv, app
├── css/                # app.css, vertice.css
├── servidor/
│   ├── servidor.mjs    # entry point — HTTP + rotas
│   ├── banco.mjs       # SQLite genérico por coleção
│   ├── auth.mjs        # PBKDF2 login
│   ├── venda.mjs       # registrar venda, sequência
│   └── backup.mjs      # backup diário automático
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