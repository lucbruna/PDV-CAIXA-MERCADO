# Produção — o que falta

Estado em 2026-09-30. O que está pronto foi verificado por
`servidor/teste/e2e.mjs` (123 asserções),
`servidor/teste/backup-restaura.mjs` (20),
`servidor/teste/api-fila.mjs` (27),
`servidor/teste/frontend-seguro.mjs` (15),
`servidor/teste/sync-cadastro.mjs` (16),
`servidor/teste/centavos-migracao.mjs` (10),
`servidor/teste/navegador-seguro.mjs` (47),
`servidor/teste/estoque-reconcilia.mjs` (16),
`servidor/teste/pix-fiscal.mjs` (46) e por instalação real do
`instalar-linux.sh` com service + nginx numa máquina de fábrica.
São **320 asserções** no total, todas passando.

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
- **Escrita por coleção respeita o perfil.** O servidor recusa o que a tela já
  esconde do operador (caixa não grava produto, fornecedor, compra, conta nem
  lançamento; continua gravando cliente, porque o PDV a prazo precisa). Antes o
  cliente escondia a página, mas a rota aceitava qualquer sessão.
- **Backup em arquivo único** (`VACUUM INTO`), sem par `.db`/`-wal` para
  desencontrar; o teste de restauração confere o arquivo autocontido.
- **Banco no Windows fora da pasta do programa** (`%ProgramData%`), com cópia
  automática do banco de instalações antigas.
- **TLS por PFX** (`SUDAM_PFX`) e ajudantes de Windows: `LIBERAR-FIREWALL.bat`
  (porta só na rede local) e `GERAR-CERTIFICADO.ps1` (certificado autoassinado).
- **Testes em porta dedicada.** O `sync-cadastro.mjs` usava a 8787 do PDV;
  havendo um servidor de verdade no ar, o teste conversava com ele e gravava
  dado de teste no banco real. Agora usa 8798 e aborta se o próprio servidor de
  teste não subir.
- **Dinheiro em centavos inteiros** (`dinheiro.mjs`): o servidor calcula e
  guarda valores em centavos; as colunas de dinheiro no SQLite são `INTEGER`.
  O JSON do cliente continua em reais. Migração de bancos antigos no boot e
  teste dedicado de restauração/ idempotência.
- **Teste de navegador de verdade** (`navegador-seguro.mjs`): abre o app em
  Chrome headless, faz login pela tela e confere XSS escapado nas telas reais e
  o CSP bloqueando `<script>`/handler inline.

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

O primeiro acesso ainda pode usar `admin` / `1234` se esses forem os dados
migrados do navegador. Faça a configuração inicial no próprio servidor; depois
use **Ajustes → Usuários e acessos → Trocar minha senha** e defina uma senha de
ao menos 12 caracteres antes de abrir a loja. A troca exige a senha atual e
encerra as outras sessões dessa conta.

### 3. Testar com as máquinas de verdade

O teste de 5 caixas roda no processo (HTTP direto). Falta rodar com 5
navegadores de verdade na rede da loja, vendendo ao mesmo tempo, e conferir:

- o número do cupom não repete em nenhum caixa
- o estoque bate com o físico
- um caixa desligado não derruba os outros

### 4. Restaurar um backup, de fato — **RESOLVIDO**

Agora é verificado por `servidor/teste/backup-restaura.mjs` (20 asserções):
popula um banco, grava o backup, copia o arquivo para uma pasta nova, sobe um
servidor apontado só para essa cópia e confere que voltaram o admin (login
funciona), os produtos, o preço, o **estoque já descontado** (50 − 3 = 47), o
cliente, a venda com o total e o config.

O caminho de desligamento também foi verificado no Linux: um `SIGTERM` no
serviço roda o backup final e o arquivo resultante tem os mesmos dados da
origem.

> O backup usa `VACUUM INTO`: a cópia sai inteira em **um arquivo só**, já com
> o WAL aplicado. Não existe mais a janela em que o `.db` e o `-wal` não batem
> (uma venda entrando no meio da cópia). A cópia de arquivo continua como
> reserva, para quando o banco não estiver disponível para o `VACUUM`.

**Falta só treinar o gerente:** mostrar onde ficam os backups e como restaurar
na prática (`sudo systemctl stop sudam-pdv`, copiar `sudam.<carimbo>` de volta
para `/var/lib/sudam-pdv/sudam.db`, apagar o `sudam.db-wal`/`-shm` antigo,
`sudo systemctl start sudam-pdv`).

## Pendências técnicas conhecidas

- **Estoque local reconcilia sozinho.** *(resolvido)* — `js/app.js` chama
  `Store.reconciliarEstoque()` a cada 5 min e ao voltar o foco na aba
  (`visibilitychange`). Os campos que só o servidor decide (`stock`, `price`,
  `cost`, `min`, nome, categoria…) são puxados de `/api/produtos`; há travas
  para não sobrescrever um lote de cadastro recém-feito nem rodar por baixo de
  um modal aberto. Verificado em `estoque-reconcilia.mjs` (16 asserções).
- **Histórico antigo não pagina.** `/api/vendas` aceita `limite`/`offset` e o
  cliente pede 500 por vez. Ao rolar a lista para trás, o histórico mais
  antigo não carrega sozinho.
- **Sessão de 12 h.** *(resolvido)* — a sessão usa janela deslizante
  (`renovarSessao` em `auth.mjs`): cada requisição empurra o vencimento, então
  quem opera o dia inteiro praticamente não vê a sessão morrer.
- ~~**Não há HTTPS.**~~ *(resolvido)* — `instalar-linux.sh --com-nginx` monta
  nginx na frente, com HTTP → HTTPS, e o Node passa a escutar só em
  `127.0.0.1`. O certificado é autoassinado (aviso do navegador na primeira
  visita); para produção, use um domínio com certificado real.
- **Estorno não volta para o servidor.** *(resolvido)* — existe
  `POST /api/estorno`, que exige motivo, devolve estoque, reverte o caixa e o
  crediário, e registra quem estornou. Verificado em teste.

## Ainda resolver antes de abrir a loja

Estes pontos não bloqueiam a instalação. A maior parte já foi fechada (ver
*(resolvido)* abaixo); o que sobra é decisão de arquitetura ou melhoria:

- **`/api/migrar` no primeiro acesso.** *(endurecido)* — sem sessão somente em
  conexão local, exige um administrador ativo e revalida dentro da transação
  para impedir que duas inicializações concorrentes substituam a conta.
- **HTTP em interface de rede.** *(endurecido)* — por padrão o servidor recusa
  iniciar sem TLS quando escuta fora de localhost. O instalador Linux exige
  `--com-nginx`; HTTP direto exige a opção explícita `--permitir-http-lan`.
  No Windows, o atalho usa localhost sem TLS e libera a rede apenas com TLS.
- **`unhandledRejection` também fecha o banco.** *(resolvido)* — a rejeição não
  tratada passa pelo mesmo caminho do `uncaughtException`: checkpoint, fecha o
  banco e sai com código 1. O systemd reinicia sobre o banco em disco, íntegro.
  (Havia ainda dois handlers registrados; o duplicado foi removido.)
- **Rate limit atrás do proxy.** *(resolvido)* — com `SUDAM_TRUST_PROXY=1`
  (ligado no drop-in do nginx) o IP vem do `X-Real-IP`, configurado pelo proxy
  com `$remote_addr`; `X-Forwarded-For` não é usado para confiar na origem.
- **Permissões de escrita por coleção.** *(resolvido)* — o servidor recusa
  escrita que a tela já esconde do perfil (`podeEscrever`, espelhando o
  `can()` do cliente). Verificado no e2e.
- **Dinheiro em centavos inteiros.** *(resolvido)* — o servidor calcula e
  guarda valores em centavos (`dinheiro.mjs`); as colunas de dinheiro no SQLite
  são `INTEGER` e bancos antigos migram uma vez no boot. O JSON do cliente
  continua em reais. Verificado em `centavos-migracao.mjs` e no e2e.
- **Snapshot consistente.** *(resolvido)* — o backup usa `VACUUM INTO`, que
  grava a cópia inteira em um arquivo só, já com o WAL aplicado. Não existe
  mais o par `.db`/`-wal` para desencontrar; a cópia de arquivo fica só como
  reserva, se o `VACUUM` não puder rodar.
- **Render por `innerHTML` → `createElement`.** *(resolvido)* — `js/ui.js`
  (modais, toasts, formulários, gráficos, Pix), `js/pdv.js` (catálogo,
  carrinho, pagamento, modais do caixa, layout) e `js/app.js` (todas as telas
  de gestão: dashboard, vendas, produtos, compras, clientes, financeiro,
  contas, relatórios, ajustes e a ferramenta de preços) montam DOM: todo valor
  do banco entra como nó de texto (`textContent`) ou atributo, nunca como
  marcação. O que ainda usa string é o corpo dos modais de formulário —
  markup constante definido no código, com todo campo de dado passando por
  `esc()`/`UI.field()`; o `frontend-seguro.mjs` trava a recaída no fonte e o
  `navegador-seguro.mjs` confere nas telas reais (escape do dado + CSP
  bloqueando script inline).
- **Windows: TLS e firewall.** *(resolvido)* — o servidor aceita TLS por PFX
  (`SUDAM_TLS=1` + `SUDAM_PFX` + `SUDAM_PFX_SENHA`); `GERAR-CERTIFICADO.ps1`
  cria o certificado autoassinado sem administrador, e `LIBERAR-FIREWALL.bat`
  libera a 8787 só para a rede local. Ambos são opcionais e estão no README.
- **Banco do Windows fora da pasta do programa.** *(resolvido)* — o padrão
  passou a ser `%ProgramData%\Sudam Gestao PDV\dados\sudam.db`. Numa instalação
  antiga, o servidor copia o `servidor\dados\sudam.db` para o novo local no
  primeiro boot e passa a usar a cópia.
- **`COMPILAR-INSTALADOR.bat` anunciava a versão fixa.** *(resolvido)* — o
  aviso agora lê o `AppVersion` do `instalador.iss`, então não mente quando a
  versão sobe.

## Fora do escopo (decisão do cliente, não falta técnica)

- **NFC-e / MFE.** Hoje emite comprovante não fiscal — e **"preencher os dados
  da SEFAZ" não basta**. O que existe é só o cadastro dos campos fiscais (NCM,
  CFOP, CSOSN/CST, CEST, origem, CST PIS/COFINS) e da config da empresa (CNPJ,
  IE, CRT, CNAE, código IBGE), e o produto escolhe CSOSN ou CST conforme o
  regime (CRT). Para emitir de verdade faltaria:
  - **Certificado ICP-Brasil e-CNPJ A1** — o `certificado.pfx` do projeto é TLS
    autoassinado para HTTPS e não assina documento fiscal;
  - **cálculo de tributos** (base, alíquota, ICMS-ST, PIS/COFINS) e os
    totalizadores da NFC-e;
  - **CFOP derivado da operação** (dentro/fora do estado, ST, devolução) — hoje
    é um padrão 5102 no cadastro;
  - **XML da NFC-e (layout 4.00) + chave de acesso de 44 dígitos** (com DV) e
    **série/número próprios** do documento fiscal (o `seq` atual é o da venda);
  - **assinatura XML-DSig** do XML;
  - **comunicação com a SEFAZ** por UF (SOAP `NFeAutorizacao4`/`NFeRetAutorizacao4`,
    mTLS com o A1, recibo, consulta do protocolo, contingência EPEC/offline);
  - **QR Code oficial da NFC-e** (`p=<chave>|<versão>|<ambiente>|<idCSC>` com
    `cHashQRCode` SHA-1 sobre o CSC) — **spec diferente** do BR Code Pix, embora
    o renderizador de QR (`js/qr.js`) seja reaproveitável;
  - **CSC/idToken por UF**, **numeração/inutilização**, **cancelamento** e o
    **DANFE** com os campos obrigatórios.

  Ver CHECKLIST-PDV.md §2.1 — exige decisão A/B (sem fiscal, ou integrado a
  provedor, que é o caminho mais curto para o lojista).
- **Sintonia com a SEFAZ.** Depende do CNPJ e do credenciamento do
  estabelecimento.
