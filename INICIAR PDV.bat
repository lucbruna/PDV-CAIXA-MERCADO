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

rem Sobe o servidor so se ja nao estiver no ar (evita porta ocupada
rem quando o usuario abre o atalho duas vezes).
for /f "tokens=2 delims=:" %%a in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING"') do set PIDPORT=%%a
if defined PIDPORT (
  echo   Servidor ja esta rodando na porta 8787.
  goto abrir
)

echo   Iniciando o servidor do PDV...
start "Sudam PDV - Servidor" /min cmd /c "cd /d "%~dp0servidor" && node servidor.mjs"

rem Espera o servidor responder antes de abrir o navegador. Sem isso o
rem primeiro carregamento cai na tela de "servidor nao encontrado" e o
rem usuario pensa que o sistema quebrou.
set /a TENTATIVAS=0
:espera
timeout /t 1 /nobreak >nul
set /a TENTATIVAS+=1
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',8787);exit 0}catch{exit 1}" >nul 2>nul
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

:abrir
echo.
echo   PDV no ar em:  http://localhost:8787
echo   Para os outros caixas, use o IP que o servidor mostrar no inicio.
echo   Para fechar tudo, feche a janela "Sudam PDV - Servidor".
echo.
start "" "http://localhost:8787"
endlocal
