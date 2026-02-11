@echo off
setlocal

REM TopMusicaLivePix - Atualizacao no Windows (atalho)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-windows.ps1"
if errorlevel 1 (
  echo.
  echo Falhou. Leia a mensagem acima.
  pause
)

