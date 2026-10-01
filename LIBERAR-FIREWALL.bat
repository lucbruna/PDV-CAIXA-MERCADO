@echo off
setlocal
title Sudam Gestao PDV - liberar acesso na rede local

rem ==========================================================
rem  Abre a porta do PDV para os outros caixas da loja.
rem
rem  O Windows bloqueia conexoes de entrada por padrao: sem esta
rem  regra, os caixas nao alcancam o mini PC pelo IP. A regra e
rem  limitada a SUA rede local (remoteip=localsubnet) e ao perfil
rem  privado -- nao abre o PDV para a internet.
rem
rem  Precisa de administrador. Clique com o botao direito neste
rem  arquivo e escolha "Executar como administrador".
rem ==========================================================

set "PORTA=8787"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Este passo precisa de privilegios de administrador.
  echo   Clique com o botao direito neste arquivo e escolha
  echo   "Executar como administrador".
  echo.
  pause
  exit /b 1
)

echo.
echo   Removendo regra antiga (se existir)...
netsh advfirewall firewall delete rule name="Sudam Gestao PDV (rede local)" >nul 2>&1

echo   Criando regra: porta %PORTA% liberada apenas para a rede local...
netsh advfirewall firewall add rule ^
  name="Sudam Gestao PDV (rede local)" ^
  dir=in action=allow protocol=TCP localport=%PORTA% ^
  profile=private remoteip=localsubnet >nul

if errorlevel 1 (
  echo.
  echo   Nao foi possivel criar a regra. Verifique se o servico
  echo   "Firewall do Windows" esta ativo e tente de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo   Pronto. A porta %PORTA% esta liberada para a rede local.
echo   Os caixas acessam pelo IP que o PDV mostra ao iniciar.
echo.
pause
