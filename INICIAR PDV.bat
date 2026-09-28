@echo off
cd /d "%~dp0"
title Sudam Gestao - PDV
if not exist "%~dp0index.html" (
  echo Nao foi encontrado index.html na pasta do sistema.
  pause
  exit /b 1
)
start "" "%~dp0index.html"
