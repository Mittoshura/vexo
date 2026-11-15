@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title VEXO

rem --- Find Node.js (22.13+ is required for the built-in SQLite module) ---
where node >nul 2>&1
if errorlevel 1 (
  rem Portable Node next to Hermes, if present
  for /d %%D in ("%LOCALAPPDATA%\hermes\tools\node-*") do set "PATH=%%~fD;!PATH!"
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 22 LTS or newer from https://nodejs.org and run Start.bat again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  for /f %%V in ('node -v') do echo Node.js %%V is too old: VEXO needs 22.13 or newer.
  echo Update it from https://nodejs.org and run Start.bat again.
  pause
  exit /b 1
)

rem --- First run: install dependencies ---
if not exist node_modules (
  echo Installing dependencies, this takes a minute the first time...
  call npm install-scripts approve esbuild sharp >nul 2>&1
  call npm install || (echo Dependency install failed. & pause & exit /b 1)
)

echo Building the interface...
call npm run build >nul || (echo Build failed. & pause & exit /b 1)

start "" http://127.0.0.1:3210
echo.
echo   VEXO is running on http://127.0.0.1:3210
echo   Close this window to stop it.
echo.
call npm run start
pause
