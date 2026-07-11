# Install Bun (if needed), then install the latest hoomanjs globally via Bun.
# Windows (PowerShell):
#   irm https://raw.githubusercontent.com/vaibhavpandeyvpz/hooman/main/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
  Write-Host $Message
}

function Write-Ok([string]$Message) {
  Write-Host $Message -ForegroundColor Green
}

function Write-Err([string]$Message) {
  Write-Host $Message -ForegroundColor Red
}

function Get-BunBinDir {
  if ($env:BUN_INSTALL) {
    return (Join-Path $env:BUN_INSTALL "bin")
  }
  return (Join-Path $HOME ".bun\bin")
}

function Ensure-PathHasBun {
  $bin = Get-BunBinDir
  if (Test-Path $bin) {
    $parts = $env:Path -split ";" | Where-Object { $_ -and $_ -ne $bin }
    $env:Path = ($bin + ";" + ($parts -join ";")).TrimEnd(";")
    if ($env:GITHUB_PATH) {
      Add-Content -Path $env:GITHUB_PATH -Value $bin
    }
  }
}

function Ensure-Bun {
  Ensure-PathHasBun
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($bun) {
    # Not `$version`: Bun's installer also sets `$Version` (names are case-insensitive).
    $bunVersion = & bun --version
    Write-Info "Bun already installed: $bunVersion"
    return
  }

  Write-Info "Installing Bun…"
  try {
    # Isolate Bun's install.ps1 so its `$Version` cannot clash with this script.
    $bunInstall = "Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression"
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
      & pwsh -NoProfile -ExecutionPolicy Bypass -Command $bunInstall
    } else {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $bunInstall
    }
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
      throw "Bun installer exited with code $LASTEXITCODE"
    }
  } catch {
    Write-Err "Error: failed to install Bun."
    throw
  }

  Ensure-PathHasBun
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) {
    $candidate = Join-Path (Get-BunBinDir) "bun.exe"
    if (Test-Path $candidate) {
      $env:Path = "$(Get-BunBinDir);$env:Path"
    }
  }

  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) {
    Write-Err "Error: Bun installed but is not on PATH."
    Write-Err "Add $(Get-BunBinDir) to your PATH and re-run this script."
    exit 1
  }

  Write-Ok "Bun $(& bun --version) installed."
}

function Install-Hooman {
  Write-Info "Installing latest hoomanjs with Bun…"
  & bun add -g hoomanjs@latest
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Error: bun add -g hoomanjs@latest failed."
    exit $LASTEXITCODE
  }
  Ensure-PathHasBun
}

function Write-Success {
  $hoomanVersion = $null
  $hooman = Get-Command hooman -ErrorAction SilentlyContinue
  if ($hooman) {
    try {
      $hoomanVersion = (& hooman --version 2>$null)
    } catch {
      $hoomanVersion = $null
    }
  }

  $logo = @'
  _
 | |__   ___   ___  _ __ ___   __ _ _ __
 | '_ \ / _ \ / _ \| '_ ` _ \ / _` | '_ \
 | | | | (_) | (_) | | | | | | (_| | | | |
 |_| |_|\___/ \___/|_| |_| |_|\__,_|_| |_|
'@

  Write-Host ""
  Write-Host $logo -ForegroundColor Cyan
  Write-Host ""

  if ($hoomanVersion) {
    Write-Ok "Installed hooman $hoomanVersion"
  } else {
    Write-Ok "Installed hoomanjs"
  }

  Write-Host ""
  Write-Info "Get started:"
  Write-Host "  hooman          # interactive chat"
  Write-Host "  hooman exec `"…`" # one-shot prompt"
  Write-Host "  hooman --help   # all commands"
  Write-Host ""
  Write-Info "Docs: https://vaibhavpandey.com/hooman/"
  Write-Host ""
}

Ensure-Bun
Install-Hooman
Write-Success
