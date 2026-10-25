@echo off
setlocal enabledelayedexpansion

:: Navigate to batch directory safely handling spaces and parentheses
cd /d "%~dp0"

echo ==================================================
echo              MedOrg One-Click Launcher
echo ==================================================
echo.

:: 1. Check Node.js installation
where node >nul 2>nul
if %ERRORLEVEL% neq 0 goto NodeMissing

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_VER_RAW=%%v
set NODE_MAJOR=%NODE_VER_RAW:~1%

if %NODE_MAJOR% lss 18 goto NodeTooOld
echo [OK] Node.js %NODE_VER_RAW% detected.
goto CheckEnv

:NodeMissing
echo [ERROR] Node.js is not installed or not in PATH.
echo Please install Node.js 18 or higher from: https://nodejs.org/
echo.
pause
exit /b 1

:NodeTooOld
echo [ERROR] Node.js version is too old: %NODE_VER_RAW%
echo MedOrg requires Node.js 18 or higher.
echo Please update Node.js from: https://nodejs.org/
echo.
pause
exit /b 1

:CheckEnv
:: 2. Ensure .env exists
if exist "%~dp0.env" goto CheckModules
if exist "%~dp0.env.example" (
  copy "%~dp0.env.example" "%~dp0.env" >nul
  echo [OK] Created .env from .env.example
) else (
  echo DATABASE_URL="file:../data/medorg.db" > "%~dp0.env"
  echo [OK] Created default .env
)

:CheckModules
:: 3. Check node_modules
if exist "%~dp0node_modules" goto LaunchApp
echo [SETUP] First run detected. Installing dependencies...
call npm install
echo [SETUP] Initializing database and data directories...
call npm run setup

:LaunchApp
echo [START] Launching MedOrg...
echo.
node "%~dp0scripts\launcher.mjs"

pause
