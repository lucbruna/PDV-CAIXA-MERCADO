# Produção — o que falta

Estado em 2026-09-29. O que está pronto foi verificado por
`servidor/teste/e2e.mjs` (112 asserções),
`servidor/teste/backup-restaura.mjs` (21),
`servidor/teste/api-fila.mjs` (27),
`servidor/teste/frontend-seguro.mjs` (15),
`servidor/teste/sync-cadastro.mjs` (16) e por instalação real do
`instalar-linux.sh` com service + nginx numa máquina de fábrica.
São 191 asserções no total, todas passando.

## Pronto

- Servidor Node + SQLite servindo o app e a API na mesma origem
- Sessão por token (scrypt, 12 h) em todas as rotas `/api`
- Banco fechado contra download por HTTP
- Venda em transação: estoque, seq do servidor, idempotência, divergência
- **Preço, quantidade, soma dos pagamentos e troco conferidos no servidor**
- **Token não vai na URL**; só em `Authorization: Bearer` (exceção `GET`/`HEAD`)
- Limite de corpo na requisição (2 MB; 64 MB na migração)
- RBAC: só admin/gerente configuram ou estornam venda de outro caixa
- Erro 500 não expõe detalhe interno
- Data da venda é do servidor, não do cliente
- Estorno: motivo obrigatório, devolve estoque, reverte caixa e crediário
- **Autoria da venda vem da sessão**, nunca do corpo da requisição (sem isso o
  `operatorId` forjado apontava o estorno para a pessoa errada)
- Rate limit no login (por IP+usuário)
- Cliente falando com o servidor: login, base, envio, fila de reenvio
- Migração pelo botão em Ajustes
- Backup automático hourly com **rotação de verdade** (30 dias, prefixo correto)
- Desligamento gracioso: backup final e `SIGTERM`/`SIGINT` tratados
- Instalação Linux: service systemd endurecido, usuário sem privilégios,
  nginx + HTTPS opcional, atalho de quiosque, desinstalação que preserva dados
- **`<script>` inline não bloqueia mais a página.** A CSP manda `script-src 'self'`
  sem `'unsafe-inline'`, então os dois blocos que viviam dentro do `index.html` —
  o coletor de erro e a tela "O sistema não conseguiu iniciar" — eram bloqueados
  pelo navegador e nunca rodavam. Numa falha de boot o caixa via só o fundo
  escuro, sem causa e sem botão de tentar de novo, que era exatamente o que
  aqueles blocos existiam para evitar. Foram para `js/boot.js`, primeiro script
  da página, e `frontend-seguro.mjs` trava a recaída.
- Instalação Windows auditada: o `.bat` agora **exige Node >= 22.5** (antes só
  procurava o executável, então um Node 18 ou 20 passava e o servidor morria em
  `ERR_UNKNOWN_BUILTIN_MODULE`), e **imprime digital** a porta 8787 em vez de
  confiar nela: se outro programa estiver escutando, o navegador não abre a tela
  errada.

## Bloqueadores de produção

### 1. Instalar o Node.js na máquina do mini PC

O sistema usa `node:sqlite`, que vem embutido no Node 22+. O instalador
**não** instala o Node (não pode, sem privilégios de admin). Na loja:

**Linux (mini PC do servidor)**

```bash
sudo apt install -y nodejs nginx    # Debian/Ubuntu
sudo dnf install -y nodejs nginx    # Fedora
sudo ./instalar-linux.sh --com-nginx
```

O `instalar-linux.sh` faz o resto: cria o usuário `sudam`, registra o serviço
systemd, guarda o app em `/opt/sudam-pdv`, monta o nginx e mostra o endereço
que os caixas devem abrir. A desinstalação devolve o site padrão do nginx e
**não apaga o banco**.

Atenção: o serviço roda com `ProtectHome=true`, então um Node instalado via
`nvm` (em `/home/usuario/...`) não serve. Use o Node do sistema.

**Windows**

1. Baixar o Node 22 LTS de <https://nodejs.org> no mini PC.
2. Rodar o instalador do PDV.
3. Abrir pelo atalho.

O `INICIAR PDV.bat` detecta a falta do Node e diz o que fazer, em vez de
abrir o app quebrado.

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

### 4. Restaurar um backup, de fato — **RESOLVIDO**

Agora é verificado por `servidor/teste/backup-restaura.mjs` (21 asserções):
popula um banco, grava o backup, copia o par `.db`/`-wal` para uma pasta nova,
sobe um servidor apontado só para essa cópia e confere que voltaram o admin
(login funciona), os produtos, o preço, o **estoque já descontado** (50 − 3 =
47), o cliente, a venda com o total e o config.

O caminho de desligamento também foi verificado no Linux: um `SIGTERM` no
serviço roda o backup final e o arquivo resultante tem os mesmos dados da
origem.

> O `.db` é copiado **antes** do `-wal`, nessa ordem. É a ordem segura: o WAL
> copiado nunca é mais velho que o `.db`, então o SQLite reaplica os frames até
> o último commit completo. Todo backup passa por `wal_checkpoint(TRUNCATE)`
> antes de copiar, o que faz o `.db` sozinho já ser um banco fechado.

**Falta só treinar o gerente:** mostrar onde ficam os backups e como restaurar
na prática (`sudo systemctl stop sudam-pdv`, copiar `sudam.<carimbo>` de volta
para `/var/lib/sudam-pdv/sudam.db`, `sudo systemctl start sudam-pdv`).

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
- ~~**Não há HTTPS.**~~ *(resolvido)* — `instalar-linux.sh --com-nginx` monta
  nginx na frente, com HTTP → HTTPS, e o Node passa a escutar só em
  `127.0.0.1`. O certificado é autoassinado (aviso do navegador na primeira
  visita); para produção, use um domínio com certificado real.
- **Estorno não volta para o servidor.** *(resolvido)* — existe
  `POST /api/estorno`, que exige motivo, devolve estoque, reverte o caixa e o
  crediário, e registra quem estornou. Verificado em teste.

## Ainda resolver antes de abrir a loja

Estes pontos não bloqueiam a instalação, mas são os que eu corrigiria antes de
confiar o caixa a outro pessoa:

- **`/api/migrar` responde sem token enquanto o banco não tem usuário.** Numa
  rede nova, quem chegar primeiro cria o admin. É o comportamento do primeiro
  acesso e precisa ser feito **em frente à máquina**, não de outro equipamento.
- **`unhandledRejection` ainda só registra.** O `uncaughtException` já foi
  corrigido (fecha o banco e sai com código 1, e o systemd reinicia em 3 s), mas
  a rejeição não tratada ainda passa. Menos grave: rejeição não sincronizada não
  costuma deixar o estado gravado pela metade. Fechar do mesmo jeito.
- **Rate limit do login não enxerga `X-Forwarded-For`.** Atrás do nginx, todos
  os clientes parecem vir de `127.0.0.1` e compartilham o mesmo balde — um
  caixa travando o login trava os outros.
- **Permissões de caixa.** Caixa ainda pode mexer em estoque, clientes e
  lançamentos financeiros. Se o perfil "operador" for restrito, vale fechar.
- **Dinheiro em `REAL` no SQLite.** Cada linha é arredondada para centavos no
  servidor, o que fecha a divergência de exibição, mas o tipo continua sendo
  ponto flutuante. Migrar para centavos inteiros é o corte limpo.
- **Snapshot copia `.db` e `-wal` separados.** Se um venda cair entre uma
  cópia e outra, o par pode não bater. A API de backup do próprio SQLite
  (`node:sqlite`) resolve; hoje é cópia de arquivo.
- **`innerHTML` em quase toda a tela.** Funciona e é o padrão do app, mas
  qualquer campo do banco esquecido no `esc()` é HTML injetado. O `emoji` do
  produto escapou em ~15 lugares e já foi corrigido; `frontend-seguro.mjs` agora
  trava a recaída. Ainda não há teste de navegador — só a guarda estática.
- **No Windows o PDV não tem TLS.** O servidor abre em `0.0.0.0:8787` e o
  instalador não cria regra de firewall, então o token de sessão e a senha do
  caixa cruzam a rede local em texto puro. No Linux há nginx com HTTPS (autoassinado).
  Para o Windows, o corte é: regra de firewall liberando 8787 só para a sub-rede,
  ou proxy TLS igual ao Linux.
- **O banco do Windows fica dentro da pasta do programa.** `banco.mjs` resolve
  `servidor/dados/sudam.db`, ou seja, `%LOCALAPPDATA%\Programs\Sudam Gestao PDV\...`.
  Apagar ou reinstalar a pasta perde o histórico de vendas. No Linux os dados
  vivem em `/var/lib/sudam-pdv`, fora do app. O corte é o mesmo dos dois lados:
  `%ProgramData%\Sudam Gestao PDV\dados`, com o caminho vindo de `SUDAM_DB`.
- **`COMPILAR-INSTALADOR.bat` anuncia a versão no texto.** A linha de sucesso
  escreve `1.0.0` fixo, então passa a mentir quando o `AppVersion` do `.iss`
  subir. Sem impacto no instalador gerado.

## Fora do escopo (decisão do cliente, não falta técnica)

- **NFC-e / MFE.** Hoje emite comprovante não fiscal. Ver CHECKLIST-PDV.md
  §2.1 — exige decisão A/B (sem fiscal, ou integrado a provedor).
- **Sintefonia com a SEFAZ.** Depende do CNPJ e do credenciamento do
  estabelecimento.
