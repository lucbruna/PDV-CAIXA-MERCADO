#!/usr/bin/env bash
# Instalador do Sudam Gestão PDV para Linux (Debian/Ubuntu, Fedora, Arch...)
#
# O que ele faz, em ordem:
#   1. checa Node.js >= 22.5 (o node:sqlite do banco precisa disso)
#   2. copia o app para /opt/sudam-pdv
#   3. cria o usuario de sistema `sudam` (sem shell, sem login)
#   4. cria /var/lib/sudam-pdv (banco) e /var/backups/sudam-pdv (copias)
#   5. instala e liga o servico systemd (sobe junto com a maquina)
#   6. opcionalmente monta um proxy nginx com HTTPS
#   7. opcionalmente cria o atalho de quiosque para os caixas
#
# Uso:
#   sudo ./instalar-linux.sh                    # instala
#   sudo ./instalar-linux.sh --desinstalar      # remove (os dados ficam)
#   sudo ./instalar-linux.sh --com-nginx        # instala + proxy HTTPS local
#   sudo ./instalar-linux.sh --sem-systemd      # so copia, nao instala servico
#
# O instalador NAO apaga o banco em nenhum caminho. `--desinstalar` deixa
# /var/lib/sudam-pdv e /var/backups/sudam-pdv intactos de proposito: quem
# desinstala esta trocando de maquina, nao quer perder a venda do dia.

set -euo pipefail

# ---------------- configuracao ----------------
APP_DIR="${APP_DIR:-/opt/sudam-pdv}"
DATA_DIR="${DATA_DIR:-/var/lib/sudam-pdv}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sudam-pdv}"
RUN_USER="${RUN_USER:-sudam}"
PORTA="${SUDAM_PORTA:-8787}"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=5      # node:sqlite foi estabilizado depois disso
COM_NGINX=0
COM_SYSTEMD=1
ACAO=instalar

for arg in "$@"; do
  case "$arg" in
    --desinstalar) ACAO=desinstalar ;;
    --com-nginx)   COM_NGINX=1 ;;
    --sem-systemd) COM_SYSTEMD=0 ;;
    --ajuda|-h)
      # imprime so o cabecalho em comentario, e nao o codigo depois dele
      awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"
      exit 0 ;;
    *) echo "Opcao desconhecida: $arg" >&2; exit 2 ;;
  esac
done

# ---------------- apresentacao ----------------
verde()  { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[31m%s\033[0m\n' "$*"; }
passo()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

die() { vermelho "ERRO: $*"; exit 1; }

# ---------------- pre-requisitos ----------------
precisa_root() {
  [ "$(id -u)" -eq 0 ] || die " rode com sudo"
}

tem_systemd() {
  [ -d /run/systemd/system ] || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  return 0
}

versao_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'process.stdout.write(process.versions.node)' 2>/dev/null || return 1
}

# O node:sqlite e o banco inteiro. Node 22 sem o .5 nao tem `node:sqlite`
# estavel e o servidor morre na primeira linha que importa o banco -- e a
# falha aparece como "Cannot find module", nao como "versao antiga".
checa_node() {
  local v; v="$(versao_node)" || die "Node.js nao encontrado. Instale o Node 22 ou superior (ver README)."
  local maj min
  maj="${v%%.*}"; min="$(echo "$v" | cut -d. -f2)"
  if [ "$maj" -lt "$NODE_MIN_MAJOR" ] || { [ "$maj" -eq "$NODE_MIN_MAJOR" ] && [ "$min" -lt "$NODE_MIN_MINOR" ]; }; then
    die "Node $v e antigo demais. Este PDV precisa de Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} (o banco usa node:sqlite).
     Ubuntu: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
     Fedora: sudo dnf install -y nodejs   (versao 22+)"
  fi
  verde "   Node $v"
}

# ---------------- desinstalar ----------------
desinstalar() {
  passo "Removendo o PDV"
  if tem_systemd; then
    systemctl disable --now sudam-pdv.service 2>/dev/null || true
    rm -f /etc/systemd/system/sudam-pdv.service
    systemctl daemon-reload || true
    verde "   servico parado e removido"
  fi
  rm -f /etc/nginx/sites-enabled/sudam-pdv.conf /etc/nginx/conf.d/sudam-pdv.conf 2>/dev/null || true
  # Devolve o site padrao da distribuicao, se foi guardado na instalacao.
  # O caminho tem de ser o de origem da distro (sites-available/default),
  # nao o do backup: um symlink para o arquivo de backup, seguido de rm
  # dele, deixa sites-enabled/default apontando para o nada e derruba o
  # nginx inteiro no proximo reload.
  if [ -e /etc/nginx/sites-available/default.sudam-backup ]; then
    if ! cmp -s /etc/nginx/sites-available/default.sudam-backup /etc/nginx/sites-available/default; then
      mv -f /etc/nginx/sites-available/default.sudam-backup /etc/nginx/sites-available/default
    else
      rm -f /etc/nginx/sites-available/default.sudam-backup
    fi
    # Layout de fabrica: arquivo em sites-available, link em sites-enabled.
    ln -sfn /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
    verde "   site padrao do nginx restaurado"
  fi
  if [ -f /etc/nginx/nginx.conf ]; then
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
    else
      # Deixar o nginx com config quebrada e pior do que avisar: mostra o
      # motivo, porque quem desinstalou o PDV pode estar servindo outra
      # coisa nessa mesma maquina.
      vermelho "   a configuracao do nginx ficou invalida:"
      nginx -t 2>&1 | sed 's/^/     /'
    fi
  fi
  if [ -d "$APP_DIR" ]; then rm -rf "$APP_DIR"; verde "   $APP_DIR removido"; fi
  if [ -f /usr/share/applications/sudam-pdv-caixa.desktop ]; then
    rm -f /usr/share/applications/sudam-pdv-caixa.desktop
    verde "   atalho de quiosque removido"
  fi
  echo
  amarelo "Os dados NAO foram apagados:"
  echo "   banco:   $DATA_DIR"
  echo "   backups: $BACKUP_DIR"
  verde "   para apagar de vez, remova essas pastas na mao."
}

# ---------------- instalar ----------------
cria_usuario() {
  if id -u "$RUN_USER" >/dev/null 2>&1; then
    verde "   usuario $RUN_USER ja existe"
  else
    # --system: sem senha, sem home, sem shell. O servico roda como ele.
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
    verde "   usuario de sistema $RUN_USER criado"
  fi
}

cria_pastas() {
  mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
  chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR" "$BACKUP_DIR"
  # O banco tem dado de cliente (CPF, divida). 750 = so o dono e o grupo.
  chmod 750 "$DATA_DIR" "$BACKUP_DIR"
  chmod 755 "$APP_DIR"
  verde "   $APP_DIR, $DATA_DIR, $BACKUP_DIR prontos"
}

copia_app() {
  passo "Copiando o sistema"
  local origem; origem="$(cd "$(dirname "$0")" && pwd)"

  # Copia so o que o PDV usa em producao. O banco de desenvolvimento, os
  # backups antigos e os .png de receita nao entram no servidor da loja.
  rm -rf "$APP_DIR.bak"
  if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$APP_DIR.bak"; fi
  mkdir -p "$APP_DIR"
  # As paginas auxiliares (pdv.html, estoque.html etc.) redirecionam para
  # index.html, mas precisam existir para que links antigos nao virem 404.
  cp -r "$origem"/*.html "$origem/js" "$origem/css" "$origem/servidor" "$APP_DIR/"
  cp "$origem/README.md" "$APP_DIR/" 2>/dev/null || true

  # O banco de exemplo/develop nao pode ir junto: o servidor abriria o
  # arquivo que veio no zip em vez de criar o vazio no /var/lib.
  rm -rf "$APP_DIR/servidor/dados" "$APP_DIR/servidor/teste"
  mkdir -p "$APP_DIR/servidor"

  chown -R root:root "$APP_DIR"
  verde "   app em $APP_DIR (sem dados de desenvolvimento)"
}

escreve_servico() {
  passo "Instalando o servico"
  # Caminho absoluto do node, resolvido agora. Se deixassemos "node" para o
  # systemd resolver pelo PATH, um Node instalado via nvm (que vive em
  # /home/usuario/.nvm/...) simplesmente nao seria encontrado pelo servico —
  # e o PDV sobe no terminal e nunca como servico, que e o pior jeito de falhar.
  local node_bin; node_bin="$(command -v node)"
  cat > /etc/systemd/system/sudam-pdv.service <<EOF
[Unit]
# O PDV precisa subir depois da rede, porque e ele que serve os caixas.
After=network-online.target
Wants=network-online.target
# Evita laco infinito de reinicializacao quando ha um erro persistente.
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$node_bin $APP_DIR/servidor/servidor.mjs

Environment=NODE_ENV=production
Environment=SUDAM_PORTA=$PORTA
Environment=SUDAM_DB=$DATA_DIR/sudam.db
Environment=SUDAM_BACKUP=$BACKUP_DIR
Environment=SUDAM_HOST=0.0.0.0
# Em Linux o fuso do sistema ja e o da loja, mas fixar deixa o relatorio
# igual em qualquer maquina em que o servidor for movido.
Environment=TZ=America/Sao_Paulo

# Recomeca sozinho: se o processo cair, o caixa nao espera ninguem resolver.
# O limite de reinicio nao e luxo: com Restart=always e RestartSec=3, um erro
# que derruba o processo na largada vira laco infinito queimando a mini PC
# inteira, e o gerente so ve "failed" se olhar o journal. Depois de 5 quedas
# em 1 minuto o systemd para de tentar e deixa o alerta valer.
Restart=always
RestartSec=3

# --- Endurecimento ---
# Nao escreve no sistema alem das pastas declaradas. Se um dia alguem
# conseguir rodar codigo no PDV, o estrago fica preso em /var/lib/sudam-pdv.
#
# PrivateTmp fica de proposito fora: ele cria um /tmp privado, e quem
# aponta SUDAM_DB/SUDAM_BACKUP para dentro de /tmp (ou /var/tmp) tem o
# servico morrendo com "Failed to set up mount namespacing" — um banco de
# venda em diretorio de temporario e amador, mas acontece. ProtectSystem
# ja barra escrita em /usr e /etc, que e o que importa aqui.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$DATA_DIR $BACKUP_DIR
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

StandardOutput=journal
StandardError=journal
SyslogIdentifier=sudam-pdv

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable sudam-pdv.service >/dev/null
  systemctl restart sudam-pdv.service
  sleep 2
  if systemctl is-active --quiet sudam-pdv.service; then
    verde "   sudam-pdv: ativo"
  else
    vermelho "   sudam-pdv NAO subiu. Veja: journalctl -u sudam-pdv -n 40"
    exit 1
  fi
}

monta_nginx() {
  passo "Montando o proxy HTTPS (nginx)"
  command -v nginx >/dev/null 2>&1 || die " nginx nao instalado. Rode: sudo apt install -y nginx  (ou dnf install nginx)"

  local porta_ssl=443
  local cert="$DATA_DIR/pdv.crt"
  local chave="$DATA_DIR/pdv.key"

  # Certificado autoassinado. O PDV fica numa rede da loja, entao o
  # certificado serve para criptografar o trafego da rede local -- nao para
  # provar identidade para a internet. Se um dia a loja precisar de HTTPS
  # valido, troque por um do Let's Encrypt (ver README).
  if [ ! -f "$cert" ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout "$chave" -out "$cert" \
      -subj "/CN=sudam-pdv" \
      -addext "subjectAltName=DNS:localhost" >/dev/null 2>&1
    chown "$RUN_USER:$RUN_USER" "$cert" "$chave"; chmod 600 "$chave"
    verde "   certificado autoassinado gerado"
  fi

  # O site padrao da distribuicao (Ubuntu: sites-enabled/default) se declara
  # `listen 80 default_server` e, como e carregado DEPOIS de conf.d/, fica
  # com a porta 80. O resultado silencioso e o pior: o HTTPS funciona, mas
  # digitar http://... cai na pagina "Welcome to nginx!" em vez do PDV.
  # Guardamos o arquivo em vez de apagar, para desfazer na mao se precisar.
  if [ -e /etc/nginx/sites-enabled/default ]; then
    # Em maquina de fabrica `sites-enabled/default` e um SYMLINK para
    # `sites-available/default`. Entao copiar o link em vez de dereferenciar
    # guarda um link que aponta para o proprio destino: na hora de restaurar,
    # `mv` reclama "same file" e o script inteiro aborta. `cp -L` grava o
    # conteudo, que e o que a gente quer guardar.
    if [ -L /etc/nginx/sites-enabled/default ]; then
      cp -L /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default.sudam-backup
      rm -f /etc/nginx/sites-enabled/default
    else
      mv -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default.sudam-backup
    fi
    verde "   site padrao do nginx guardado em sites-available/default.sudam-backup"
  fi

  cat > /etc/nginx/conf.d/sudam-pdv.conf <<EOF
# HTTPS na frente do PDV.
#
# A porta $PORTA fica SO na loopback, com o Node em cima (SUDAM_HOST=127.0.0.1,
# definido no drop-in). O nginx nunca escuta nela: se escutasse, os dois
# disputariam o mesmo endereco e um deles perderia o bind. O Node continua
# sendo alcancavel so por dentro desta maquina, e o trafego da rede entra
# pelo 443.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # O PDV e um sistema de loja, nao um site: nao ha pagina publica para
    # servir na raiz.
    location = / {
        return 301 https://\$host\$request_uri;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen $porta_ssl ssl;
    listen [::]:$porta_ssl ssl;
    http2 on;
    server_name _;

    ssl_certificate     $cert;
    ssl_certificate_key $chave;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;

    # Compra/venda tem JSON e export tem arquivo: 16 MB folga o browser.
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Sessao deslizante de 12 h: o proxy nao pode guardar resposta de
        # usuario logado em disco. Sem isso o logout de um caixa nao surte
        # efeito no outro.
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }
}
EOF

  if nginx -t >/dev/null 2>&1; then
    systemctl enable nginx >/dev/null 2>&1 || true
    # Recarrega sempre: `enable --now` num nginx JA ligado sai com sucesso
    # sem recarregar nada, e a configuracao recem-escrita so entraria no
    # proximo boot da maquina.
    systemctl reload nginx || systemctl restart nginx
    sleep 1
    if ! systemctl is-active --quiet nginx; then
      vermelho "   o nginx nao ficou no ar apos reload"
      journalctl -u nginx -n 20 --no-pager || true
      exit 1
    fi
    verde "   HTTPS em https://<ip-do-servidor>/  (o aviso de certificado e esperado: e autoassinado)"
    amarelo "   Os caixas passam a usar https:// e aceitar o aviso uma vez por maquina."
  else
    vermelho "   nginx -t falhou; a conficao nao foi carregada"
    nginx -t || true
    exit 1
  fi
}

cria_atalho_caixa() {
  passo "Atalho de quiosque para os caixas"
  cat > /usr/share/applications/sudam-pdv-caixa.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Sudam Gestão PDV
Comment=Abre o PDV em tela cheia no caixa
Exec=$(command -v chromium || command -v chromium-browser || command -v google-chrome) --kiosk --noerrdialogs --disable-session-crashed-bubble https://localhost:${PORTA_SSL:-443}/
Icon=network-server
Terminal=false
Categories=Office;
EOF
  chmod 644 /usr/share/applications/sudam-pdv-caixa.desktop
  verde "   /usr/share/applications/sudam-pdv-caixa.desktop"
}

mostra_ip() {
  passo "Enderecos de rede"
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -n "$ip" ]; then
    if [ "$COM_NGINX" = "1" ]; then
      verde "   nos caixas:     https://$ip/"
      verde "   neste servidor: https://localhost/"
      amarelo "   O Node so escuta em 127.0.0.1:$PORTA (interno). Entre pelo https."
    else
      verde "   neste servidor: http://localhost:$PORTA"
      verde "   nos caixas:     http://$ip:$PORTA"
    fi
  else
    amarelo "   nao consegui ler o IP. Use 'hostname -I'."
  fi
}

# ---------------- fluxo ----------------
main() {
  echo
  echo "=============================================="
  echo "  Sudam Gestão PDV - instalador Linux"
  echo "=============================================="

  precisa_root

  if [ "$ACAO" = "desinstalar" ]; then desinstalar; exit 0; fi

  passo "Verificando o sistema"
  if tem_systemd; then
    verde "   systemd disponivel"
  elif [ "$COM_SYSTEMD" = "1" ]; then
    die " este sistema nao usa systemd. Rode com --sem-systemd para instalar sem servico (a inicializacao fica por conta sua)."
  else
    amarelo "   sem systemd: os passos de servico foram pulados"
  fi
  checa_node
  command -v openssl >/dev/null 2>&1 || amarelo "   openssl ausente: sem --com-nginx o certificado nao sera gerado"

  passo "Preparando"
  cria_usuario
  cria_pastas

  passo "Instalando"
  copia_app

  if [ "$COM_SYSTEMD" = "1" ] && tem_systemd; then
    if [ "$COM_NGINX" = "1" ]; then
      export PORTA_SSL=443
      # O Node so escuta local quando ha nginx na frente.
      systemctl stop sudam-pdv 2>/dev/null || true
      mkdir -p /etc/systemd/system/sudam-pdv.service.d
      cat > /etc/systemd/system/sudam-pdv.service.d/nginx.conf <<EOF
[Service]
Environment=SUDAM_HOST=127.0.0.1
EOF
    fi
    escreve_servico
    [ "$COM_NGINX" = "1" ] && monta_nginx && cria_atalho_caixa
  else
    amarelo "   app copiado para $APP_DIR — suba na mao com:"
    echo "     sudo -u $RUN_USER env SUDAM_DB=$DATA_DIR/sudam.db SUDAM_BACKUP=$BACKUP_DIR SUDAM_PORTA=$PORTA $(command -v node) $APP_DIR/servidor/servidor.mjs"
    echo "     (o banco sera criado em $DATA_DIR/sudam.db)"
  fi

  mostra_ip

  echo
  echo "=============================================="
  verde "  Instalado."
  echo "=============================================="
  echo "  Admin:     sudo systemctl status sudam-pdv"
  echo "  Logs:      sudo journalctl -u sudam-pdv -f"
  echo "  Reiniciar: sudo systemctl restart sudam-pdv"
  echo
  echo "  Primeiro acesso: entre em $([ "$COM_NGINX" = "1" ] && echo 'https://localhost/' || echo "http://localhost:$PORTA") e crie o admin."
  echo "  O banco fica em $DATA_DIR e o backup automatico em $BACKUP_DIR."
  echo
}

main "$@"
