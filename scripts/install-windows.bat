@echo off
setlocal

REM TopMusicaLivePix - Instalacao no Windows (atalho)
REM Rode este arquivo com duplo clique ou pelo CMD.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 (
  echo.
  echo Falhou. Leia a mensagem acima.
  pause
)

