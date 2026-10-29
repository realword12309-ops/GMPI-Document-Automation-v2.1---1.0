@echo off
REM GMPI Document Automation - let other computers on the OFFICE network open the app.
REM Opens TCP port 3000 on this PC for the local network only (Private profile + local subnet).
REM It is NOT opened to the internet or to Public Wi-Fi networks. Right-click > Run as administrator.
net session >nul 2>&1
if errorlevel 1 ( echo Please right-click this file and choose "Run as administrator". & pause & exit /b 1 )
netsh advfirewall firewall delete rule name="GMPI Document Automation (LAN)" >nul 2>&1
netsh advfirewall firewall add rule name="GMPI Document Automation (LAN)" dir=in action=allow protocol=TCP localport=3000 profile=private,domain remoteip=localsubnet
if errorlevel 1 ( echo Could not create the firewall rule. & pause & exit /b 1 )
echo.
echo Done. Port 3000 is now open to computers on your local network (private/domain networks only).
echo If this PC's network is marked "Public", change it to Private: Settings ^> Network ^& internet ^> Wi-Fi/Ethernet ^> Network profile type ^> Private.
echo Then run start.bat - it prints the address other PCs should use.
pause
