@echo off
REM Makes GMPI Document Automation start by itself whenever you sign in to Windows (no start.bat needed).
cd /d "%~dp0"
if not exist node_modules ( echo Run install.bat first. & pause & exit /b 1 )
schtasks /Create /TN "GMPI Document Automation" /TR "wscript.exe //B \"%~dp0run-hidden.vbs\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 ( echo Could not create the task. Try right-click ^> Run as administrator. & pause & exit /b 1 )
schtasks /Run /TN "GMPI Document Automation" >nul 2>nul
echo.
echo Done. The application now starts automatically when you sign in.
echo Open it any time at  http://localhost:3000   (log file: %%LOCALAPPDATA%%\GMPI-Document-Automation\server.log)
pause
