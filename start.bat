@echo off
REM GMPI Document Automation - start the server and open the browser
cd /d "%~dp0"
if not exist node_modules ( echo Run install.bat first. & pause & exit /b 1 )
start "" "http://localhost:3000"
node server\index.js
pause
