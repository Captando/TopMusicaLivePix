<#
  TopMusicaLivePix - Atualizacao no Windows (PowerShell)

  O que faz:
  - Faz git fetch/pull (ff-only) para baixar a ultima versao do GitHub
  - Roda npm i para atualizar dependencias

  Uso:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-windows.ps1

  Dicas:
  - Se voce alterou arquivos rastreados pelo Git (ex: config/rules.json), o pull pode dar conflito.
    Para evitar isso, use um arquivo de regras separado e aponte RULES_PATH no .env.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [string]$RepoDir = "",
  [switch]$AllowDirty
)

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Warn([string]$msg) {
  Write-Host "AVISO: $msg" -ForegroundColor Yellow
}

function Write-Err([string]$msg) {
  Write-Host "ERRO: $msg" -ForegroundColor Red
}

function Has-Command([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Resolve-RepoDir {
  if ($RepoDir) { return $RepoDir }

  $here = (Get-Location).Path
  if (Test-Path (Join-Path $here ".git")) { return $here }

  $default = Join-Path $env:USERPROFILE "TopMusicaLivePix"
  if (Test-Path (Join-Path $default ".git")) { return $default }

  return $null
}

try {
  Write-Step "Verificando ferramentas"
  if (-not (Has-Command "git")) { throw "git nao encontrado. Instale: https://git-scm.com/" }
  if (-not (Has-Command "node")) { throw "node nao encontrado. Instale Node.js LTS: https://nodejs.org/" }
  if (-not (Has-Command "npm")) { throw "npm nao encontrado. Reinstale Node.js LTS: https://nodejs.org/" }

  $dir = Resolve-RepoDir
  if (-not $dir) {
    throw "Nao encontrei o repositorio. Rode este script dentro da pasta do projeto ou instale em %USERPROFILE%\\TopMusicaLivePix."
  }

  Push-Location $dir
  Write-Step "Repositorio: $dir"

  if (-not (Test-Path ".git")) { throw "Nao e um repositorio git: $dir" }

  $dirty = (git status --porcelain)
  if ($dirty -and -not $AllowDirty) {
    Write-Warn "Existem alteracoes locais. Para sua seguranca, vou parar aqui."
    Write-Host ""
    Write-Host $dirty
    Write-Host ""
    Write-Host "Opcoes:"
    Write-Host "- Desfazer/commitar suas alteracoes e rodar de novo"
    Write-Host "- Ou rode com -AllowDirty (nao recomendado)"
    throw "Repositorio com alteracoes locais."
  }

  Write-Step "Buscando atualizacoes (git fetch)"
  git fetch origin | Out-Host

  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne "main") {
    Write-Warn "Branch atual: $branch (recomendado: main)"
  }

  Write-Step "Atualizando (git pull --ff-only)"
  git pull --ff-only origin $branch | Out-Host

  Write-Step "Atualizando dependencias (npm i)"
  npm i | Out-Host

  Write-Step "Pronto"
  Write-Host "Se o app estiver rodando, reinicie: npm run dev"
  Pop-Location
  exit 0
} catch {
  Write-Err $_.Exception.Message
  try { Pop-Location } catch {}
  exit 1
}

