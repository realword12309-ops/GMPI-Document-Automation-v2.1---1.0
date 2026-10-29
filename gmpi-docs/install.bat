@echo off
REM GMPI Document Automation - one-time install
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause & exit /b 1
)
call npm install --omit=dev
if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
echo.
echo Install complete. Double-click start.bat to run the application.
pause
