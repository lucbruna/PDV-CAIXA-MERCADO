@echo off
setlocal
cd /d "%~dp0"
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
if not defined ISCC (
  echo Inno Setup 6 nao foi encontrado.
  echo Instale o Inno Setup 6 e rode este arquivo novamente.
  pause
  exit /b 1
)
"%ISCC%" "%~dp0instalador.iss"
if errorlevel 1 exit /b %errorlevel%
echo.
echo Instalador criado em: "%~dp0dist\Sudam-Gestao-PDV-Setup-1.0.0.exe"
pause
