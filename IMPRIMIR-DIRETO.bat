@echo off
setlocal
title Sudam Gestao PDV - Impressao direta

rem Impressao direta requer Chromium com --kiosk-printing. O navegador envia
rem para a impressora padrao do Windows sem abrir a caixa de impressao.
set "PDV_URL=https://192.168.1.14:8787"
set /p "PDV_URL=Endereco do PDV (Enter usa %PDV_URL%): "
if not defined PDV_URL set "PDV_URL=https://192.168.1.14:8787"

set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined BROWSER (
  echo Nao encontrei Microsoft Edge ou Google Chrome neste computador.
  echo Instale um deles e tente novamente.
  pause
  exit /b 1
)

if not exist "%LocalAppData%\SudamGestaoPDV\PerfilImpressao" mkdir "%LocalAppData%\SudamGestaoPDV\PerfilImpressao"
start "Sudam Gestao PDV" "%BROWSER%" --kiosk-printing --user-data-dir="%LocalAppData%\SudamGestaoPDV\PerfilImpressao" "%PDV_URL%"
endlocal
