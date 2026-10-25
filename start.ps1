# MedOrg One-Click PowerShell Launcher
Set-Location -LiteralPath $PSScriptRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "         MedOrg One-Click Launcher (PS)" -ForegroundColor Cyan
Write-Host "=================================================="

# Check Node.js
try {
  $nodeVer = (node -v).Trim()
  $major = [int]($nodeVer -replace '^v(\d+)\..*', '$1')
  if ($major -lt 18) {
    Write-Host "[ERROR] Node.js version $nodeVer is too old. Requires Node 18+ from https://nodejs.org/" -ForegroundColor Red
    pause
    exit 1
  }
  Write-Host "[OK] Node.js $nodeVer detected." -ForegroundColor Green
} catch {
  Write-Host "[ERROR] Node.js is not installed. Please install Node 18+ from https://nodejs.org/" -ForegroundColor Red
  pause
  exit 1
}

# Ensure .env
$envPath = Join-Path $PSScriptRoot ".env"
$examplePath = Join-Path $PSScriptRoot ".env.example"
if (-not (Test-Path -LiteralPath $envPath)) {
  if (Test-Path -LiteralPath $examplePath) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Host "[OK] Created .env from .env.example" -ForegroundColor Green
  }
}

# Check node_modules
$modulesPath = Join-Path $PSScriptRoot "node_modules"
if (-not (Test-Path -LiteralPath $modulesPath)) {
  Write-Host "[SETUP] First run detected. Installing dependencies..." -ForegroundColor Yellow
  npm install
  Write-Host "[SETUP] Running setup..." -ForegroundColor Yellow
  npm run setup
}

Write-Host "[START] Launching MedOrg..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "scripts/launcher.mjs")
