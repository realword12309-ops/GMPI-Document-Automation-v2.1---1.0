@echo off
schtasks /End /TN "GMPI Document Automation" >nul 2>nul
schtasks /Delete /TN "GMPI Document Automation" /F
echo Auto-start removed. Your saved documents are NOT deleted.
pause
