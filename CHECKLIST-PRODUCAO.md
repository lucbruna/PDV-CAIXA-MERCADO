# Produção — o que falta

Estado em 2026-09-29. O que está pronto foi verrodelo por
`servidor/teste/e2e.mjs` (61 asserções) e por um teste no navegador contra o
servidor de verdade.

## Pronto

- Servidor Node + SQLite servindo o app e a API na mesma origem
- Sessão por token (scrypt, 12 h) em todas as rotas `/api`
- Banco fechado contra download por HTTP
- Venda em transação: estoque, seq do servidor, idempotência, divergência
- Preço recalculado no servidor + teto de desconto por perfil
- Rate limit no login (por IP+usuário)
- Cliente falando com o servidor: login, base, envio, fila de reenvio
- Migração pelo botão em Ajustes
- Backup automático seguindo o `SUDAM_DB`
- Instaladorempacota o servidor e o atalho sobe o servidor antes do navegador

## Bloqueadores de produção

### 1. Instalar o Node.js na máquina do mini PC

O sistema usa `node:sqlite`, que vem embutido no Node 22+. O instalador
**não** instala o Node (não pode, sem privilégios de admin). Na loja:

1. Baixar o Node 22 LTS de <https://nodejs.org> no mini PC.
2. Rodar o instalador do PDV.
3. Abrir pelo atalho.

O `INICIAR PDV.bat` detecta a falta do Node e diz o que fazer, em vez de
abrir o app quebrado. Mas o gerente ainda precisa instalar o Node antes —
vale incluir isso no LEIA-ME.

### 2. Definir a senha do administrador

O primeiro acesso é `admin` / `1234`. A migração de hash legado acontece no
primeiro login, mas a senha em si é a padrão. **Trocar antes de abrir a
loja** — com o rate limit, 8 tentativas em 5 min, e o `1234` cai em segundos.

### 3. Testar com as máquinas de verdade

O teste de 5 caixas roda no processo (HTTP direto). Falta rodar com 5
navegadores de verdade na rede da loja, vendendo ao mesmo tempo, e conferir:

- o número do cupom não repete em nenhum caixa
- o estoque bate com o físico
- um caixa desligado não derruba os outros

### 4. Restaurar um backup, de fato

O backup automático roda e copia `.db` + `-wal`. **Nunca foi testado
restaurando.** Copie um backup para outra pasta, aponte `SUDAM_DB` para ele e
confirme que abre. Um backup nunca restaurado não é backup.

## Pendências técnicas conhecidas

- **Estoque local não reconcilia sozinho.** Depois de uma venda o PDV puxa o
  estoque do servidor, mas não há reconciliation periódica: se alguém editar
  produto em dois caixas fora do fluxo normal, a diferença só aparece quando
  alguém olha.
- **Histórico antigo não pagina.** `/api/vendas` aceita `limite`/`offset` e o
  cliente pede 500 por vez. Ao rolar a lista para trás, o histórico mais
  antigo não carrega sozinho.
- **Sessão de 12 h.** Caixa aberto o expediente inteiro sem relogar passa de
  12 h e a próxima venda cai em 401. O app avisa ("guardada para enviar
  depois") mas não força relogin.
- **Não há HTTPS.** Tudo em HTTP puro na LAN. Aceitável numa rede local
  isolada, **inaceitável** se a porta 8787 for exposta por um roteador ou
  VPN. Nesse caso, TLS na frente (nginx/caddy) é obrigatório.
- **Estorno não volta para o servidor.** O `POST /api/venda` grava; não há
  rota de estorno. Um estorno feito no PDV muda o local e não o servidor —
  até a próxima puxada, que sobrescreve. **Este é o próximo bloco depois dos
  itens acima.**
## Fora do escopo (decisão do cliente, não falta técnica)

- **NFC-e / MFE.** Hoje emite comprovante não fiscal. Ver CHECKLIST-PDV.md
  §2.1 — exige decisão A/B (sem fiscal, ou integrado a provedor).
- **Sintefonia com a SEFAZ.** Depende do CNPJ e do credenciamento do
  estabelecimento.
