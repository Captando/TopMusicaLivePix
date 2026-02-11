<#
  TopMusicaLivePix - Instalacao no Windows (PowerShell)

  Objetivo:
  - Instalar ferramentas (Git, Node.js LTS, ngrok) via winget (se disponivel)
  - Clonar o repo (se ainda nao estiver na pasta)
  - Instalar dependencias (npm i)
  - Criar e configurar .env (gera WEBHOOK_SECRET automaticamente)

  Uso (recomendado):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1

  Observacoes:
  - Se o winget nao existir no seu Windows, o script vai orientar instalacao manual.
  - Se voce acabou de instalar Node/Git, talvez precise abrir um novo terminal.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [string]$RepoSsh = "git@github.com:Captando/TopMusicaLivePix.git",
  [string]$InstallDir = (Join-Path $env:USERPROFILE "TopMusicaLivePix"),
  [switch]$SkipToolInstall
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

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($machine -and $user) {
    $env:Path = "$machine;$user"
  } elseif ($machine) {
    $env:Path = $machine
  } elseif ($user) {
    $env:Path = $user
  }
}

function Has-Command([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Ensure-Winget {
  if (Has-Command "winget") { return $true }
  Write-Warn "winget nao encontrado. Instale manualmente as ferramentas abaixo:"
  Write-Host "- Git: https://git-scm.com/"
  Write-Host "- Node.js (LTS): https://nodejs.org/"
  Write-Host "- ngrok: https://ngrok.com/"
  return $false
}

function Winget-Install([string]$id) {
  Write-Host "Instalando via winget: $id"
  winget install --id $id -e --source winget --accept-source-agreements --accept-package-agreements | Out-Host
  Refresh-Path
}

function Ensure-Tool([string]$cmd, [string]$wingetId, [string]$manualUrl) {
  if (Has-Command $cmd) { return }

  if ($SkipToolInstall) {
    throw "Ferramenta '$cmd' nao encontrada. Instale manualmente: $manualUrl"
  }

  if (-not (Ensure-Winget)) {
    throw "Instalacao automatica indisponivel (sem winget). Instale '$cmd' manualmente: $manualUrl"
  }

  Winget-Install $wingetId

  if (-not (Has-Command $cmd)) {
    Write-Warn "Instalado '$cmd', mas o terminal pode nao ter atualizado o PATH."
    Write-Warn "Feche este PowerShell, abra novamente e rode o script de novo."
    throw "PATH nao atualizado para '$cmd'."
  }
}

function Random-Hex([int]$bytesLen) {
  $bytes = New-Object byte[] $bytesLen
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Ensure-EnvFile([string]$repoDir) {
  $envExample = Join-Path $repoDir ".env.example"
  $envFile = Join-Path $repoDir ".env"

  if (-not (Test-Path $envExample)) {
    throw "Arquivo .env.example nao encontrado em: $envExample"
  }

  if (-not (Test-Path $envFile)) {
    Copy-Item -Path $envExample -Destination $envFile -Force
  }

  $lines = Get-Content -Path $envFile -ErrorAction Stop

  $secret = $null
  foreach ($line in $lines) {
    if ($line -match "^\s*WEBHOOK_SECRET\s*=\s*(.+)\s*$") {
      $secret = $Matches[1]
    }
  }

  if (-not $secret) {
    $generated = Random-Hex 24
    $newLines = @()
    foreach ($line in $lines) {
      if ($line -match "^\s*WEBHOOK_SECRET\s*=") {
        $newLines += "WEBHOOK_SECRET=$generated"
      } else {
        $newLines += $line
      }
    }
    Set-Content -Path $envFile -Value $newLines -Encoding utf8
    Write-Host "WEBHOOK_SECRET gerado e salvo em .env."
  } else {
    Write-Host "WEBHOOK_SECRET ja existe no .env (mantido)."
  }

  return $envFile
}

function Resolve-RepoDir {
  # Se o script estiver rodando dentro do repo, use a pasta atual.
  $here = (Get-Location).Path
  if (Test-Path (Join-Path $here "package.json")) {
    return $here
  }
  return $null
}

try {
  Write-Step "Verificando ferramentas (Git, Node.js, ngrok)"
  Ensure-Tool "git" "Git.Git" "https://git-scm.com/"
  Ensure-Tool "node" "OpenJS.NodeJS.LTS" "https://nodejs.org/"
  Ensure-Tool "npm" "OpenJS.NodeJS.LTS" "https://nodejs.org/"
  Ensure-Tool "ngrok" "ngrok.ngrok" "https://ngrok.com/"

  $repoDir = Resolve-RepoDir
  if (-not $repoDir) {
    Write-Step "Clonando repositorio em: $InstallDir"
    if (-not (Test-Path $InstallDir)) {
      New-Item -ItemType Directory -Path $InstallDir | Out-Null
    }
    git clone $RepoSsh $InstallDir | Out-Host
    $repoDir = $InstallDir
  } else {
    Write-Step "Repositorio detectado na pasta atual: $repoDir"
  }

  Write-Step "Instalando dependencias (npm i)"
  Push-Location $repoDir
  npm i | Out-Host

  Write-Step "Criando/configurando .env"
  $envFile = Ensure-EnvFile $repoDir

  Write-Step "Pronto"
  Write-Host "1) Abra no navegador: http://127.0.0.1:3000/"
  Write-Host "2) Rode o servidor:"
  Write-Host "   npm run dev"
  Write-Host "3) Em outro terminal, crie o tunel:"
  Write-Host "   ngrok http 3000"
  Write-Host ""
  Write-Host "Arquivo configurado: $envFile"
  Write-Host ""
  Write-Host "IMPORTANTE:"
  Write-Host "- Configure o webhook no LivePix apontando para /webhook/livepix?token=SEU_WEBHOOK_SECRET"
  Write-Host "- Leia SECURITY.md antes de expor o webhook"

  Pop-Location
  exit 0
} catch {
  Write-Err $_.Exception.Message
  exit 1
}

