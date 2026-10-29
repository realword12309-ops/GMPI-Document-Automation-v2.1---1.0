@echo off
REM Removes the firewall rule created by allow-network-access.bat. Right-click > Run as administrator.
net session >nul 2>&1
if errorlevel 1 ( echo Please right-click this file and choose "Run as administrator". & pause & exit /b 1 )
netsh advfirewall firewall delete rule name="GMPI Document Automation (LAN)"
echo Done. Other computers can no longer reach the app (this PC still can).
pause
