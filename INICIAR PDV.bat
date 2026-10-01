@echo off
setlocal
cd /d "%~dp0"
title Sudam Gestao - PDV

if not exist "%~dp0index.html" (
  echo Nao foi encontrado index.html na pasta do sistema.
  pause
  exit /b 1
)

rem ==========================================================
rem  Modo rede: se existir a pasta servidor\, o sistema sobe o
rem  servidor local e abre pelo endereco dele. Sem essa pasta,
rem  o app abre direto do disco (modo local, so neste PC).
rem ==========================================================
if exist "%~dp0servidor\servidor.mjs" goto modoServidor

rem --- modo local: abre o arquivo no navegador ---
start "" "%~dp0index.html"
exit /b 0

:modoServidor
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado.
  echo   O modo rede precisa do Node.js 22 ou mais novo.
  echo   Baixe em https://nodejs.org  e execute de novo.
  echo.
  pause
  exit /b 1
)

rem Ter o Node instalado nao basta: o sistema usa node:sqlite, que so existe
rem a partir do 22.5. Sem esta checagem, uma maquina com Node 18 ou 20 passa
rem no "where node", sobe o servidor, e morre em ERR_UNKNOWN_BUILTIN_MODULE --
rem o operador veria so "O servidor nao respondeu em 20 segundos".
rem A propria versao do Node faz a conta e devolve o codigo de saida: mais
rem simples e mais confiavel do que parsesar a versao dentro de um for.
rem Este trecho NAO usa parenteses de proposito: dentro de um bloco ( ... ) o
rem cmd expande %VAR% quando o bloco entra, antes do for definir a variavel.
node -e "var v=process.versions.node.split('.').map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=5))?0:1)" >nul 2>nul
if not errorlevel 1 goto versaoOk
set "NODEVER="
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODEVER=%%v"
echo.
if defined NODEVER goto versaoRuim
echo   Nao consegui ler a versao do Node.js.
goto versaoFim
:versaoRuim
echo   Node.js %NODEVER% encontrado, mas o PDV precisa do 22.5 ou mais novo.
:versaoFim
echo   Motivo: o sistema usa node:sqlite, que nasceu no 22.5.
echo   Baixe a versao atual em https://nodejs.org  e execute de novo.
echo.
pause
exit /b 1

:versaoOk

rem Sem TLS, a inicializacao local nao expoe credenciais aos outros dispositivos.
rem Acesso pela rede exige certificado configurado antes de iniciar.
if "%SUDAM_TLS%"=="1" (
  set "SUDAM_HOST=0.0.0.0"
  set "SUDAM_PROBE_URL=https://127.0.0.1:8787/api/base"
) else (
  set "SUDAM_HOST=127.0.0.1"
  set "SUDAM_PROBE_URL=http://127.0.0.1:8787/api/base"
)

rem Sobe o servidor so se ja nao estiver no ar (evita porta ocupada
rem quando o usuario abre o atalho duas vezes).
rem A busca e pela porta, entao elaTAMBEEM acha qualquer outro programa
rem escutando na 8787. A sondagem seguinte confirma se quem respondeu e
rem mesmo o PDV: se nao for, avisamos em vez de abrir o navegador na tela
rem errada.
set "PIDPORT="
for /f "tokens=2 delims=:" %%a in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING"') do set PIDPORT=%%a
if defined PIDPORT goto confirmarQueEhOPdv

echo   Iniciando o servidor do PDV...
start "Sudam PDV - Servidor" /min cmd /c "cd /d "%~dp0servidor" && node servidor.mjs"

rem Espera o servidor responder antes de abrir o navegador. Sem isso o
rem primeiro carregamento cai na tela de "servidor nao encontrado" e o
rem usuario pensa que o sistema quebrou.
rem A sondagem e por HTTP e nao so por TCP: em /api/base so o PDV responde 401
rem sem token. Se o bind falhou porque outro programa pegou a 8787, a conexao
rem TCP funcionaria mesmo assim e o navegador abriria a tela errada.
set /a TENTATIVAS=0
:espera
timeout /t 1 /nobreak >nul
set /a TENTATIVAS+=1
node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';var u=new URL(process.env.SUDAM_PROBE_URL);var h=require(u.protocol==='https:'?'https':'http');h.get(u,function(r){process.exit(r.statusCode===401?0:1)}).on('error',function(){process.exit(1)})" >nul 2>nul
if not errorlevel 1 goto abrir
if %TENTATIVAS% GEQ 20 (
  echo.
  echo   O servidor nao respondeu em 20 segundos.
  echo   Veja a janela "Sudam PDV - Servidor" para o erro.
  echo.
  pause
  exit /b 1
)
goto espera

:confirmarQueEhOPdv
rem Alguem ja escuta na 8787, mas pode ser outro programa. A impressao
rem digital e a mesma do teste acima: 401 em /api/base e o PDV; qualquer outra
rem resposta e ocupante estranho.
node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';var u=new URL(process.env.SUDAM_PROBE_URL);var h=require(u.protocol==='https:'?'https':'http');h.get(u,function(r){process.exit(r.statusCode===401?0:1)}).on('error',function(){process.exit(1)})" >nul 2>nul
if not errorlevel 1 goto abrir
echo.
echo   A porta 8787 esta ocupada por OUTRO programa, e nao pelo PDV.
echo   O PDV precisa dessa porta para funcionar.
echo.
echo   Feche o outro programa (ou libere a porta 8787) e abra o PDV de novo.
echo.
pause
exit /b 1

:abrir
echo.
if "%SUDAM_TLS%"=="1" goto abrirTls
echo   PDV local em:   http://localhost:8787
echo   Sem TLS, o servidor aceita conexoes apenas deste computador.
start "" "http://localhost:8787"
goto fim
:abrirTls
echo   PDV seguro em:  https://localhost:8787
echo   Com TLS, os outros caixas podem usar o IP do servidor.
start "" "https://localhost:8787"
:fim
echo   Para fechar tudo, feche a janela "Sudam PDV - Servidor".
echo.
endlocal
