# Using GMPI Document Automation from other PCs (office network)

The app is a Node.js + Express server (`server/index.js`, port 3000). It now listens on all network
interfaces (`"host": "0.0.0.0"` in `config.json`), so other computers on the same office network can open it.

## One-time setup on the HOST PC (the PC that runs the app)
1. **Allow the port through Windows Firewall (private network only):** right-click `allow-network-access.bat`
   -> *Run as administrator*. It opens TCP 3000 only for the *Private/Domain* profile and only to the *local subnet*.
   (Undo any time with `remove-network-access.bat`.)
2. Make sure the office network is marked **Private**: Settings -> Network & internet -> Wi-Fi/Ethernet -> your
   network -> *Network profile type = Private*.
3. **Restart the app** (close the black window, double-click `start.bat`; if you installed auto-start, sign out and in,
   or run `schtasks /End /TN "GMPI Document Automation"` then `schtasks /Run /TN "GMPI Document Automation"`).
4. The black window now prints the address for other PCs, e.g. `http://192.168.1.25:3000`.

## Find the host PC's IPv4 address (if you need it)
Open Command Prompt on the host PC and run `ipconfig`. Under your active adapter (Wi-Fi or Ethernet) read
**IPv4 Address**, e.g. `192.168.1.25`. Ignore `169.254.x.x` (no network) and virtual adapters (VirtualBox, WSL, VPN).
Other PCs open: `http://<that IPv4 address>:3000`  ->  e.g. **http://192.168.1.25:3000**
Tip: ask IT to give the host PC a fixed ("reserved") IP so the address never changes.

## Login is now required
Opening the app to the network automatically switches on login (roles: admin / editor / viewer).
* On the **first start** an administrator is created and its password is shown **once** in the start window
  (username `admin`). If you start via the hidden auto-start task, it is in
  `%LOCALAPPDATA%\GMPI-Document-Automation\server.log`. Log in, then add a user per person under **Users**,
  or from the host: `npm run create-user -- juan editor`. Forgot it: `npm run reset-password -- admin`.
* Passwords must be at least 10 characters.
* **Change `signatoryPin`** in `config.json` (the default `gmpi-admin` is public) - it protects the approver names.
* Your existing saved documents stay where they were (`%LOCALAPPDATA%\GMPI-Document-Automation`).
* The host PC must stay switched on, signed in (or auto-start installed) and not asleep.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Works on host, not on others | Firewall step not done, or network is *Public*. Re-run `allow-network-access.bat`. |
| "This site can't be reached" on others | Wrong IP (use `ipconfig` again), different Wi-Fi/VLAN/guest network, or Wi-Fi "client isolation" on the router. |
| Test from the other PC | PowerShell: `Test-NetConnection 192.168.1.25 -Port 3000` should say `TcpTestSucceeded : True`. |
| Browser shows login again | Sessions last 12 h (`sessionHours` in `config.json`). |

## Why `localhost` must NOT be used by other PCs
`localhost` always means "this computer". The app's browser code already uses relative addresses (`/api/...`), so it
works from any address. The only places that mention localhost are the host-PC shortcuts (`start.bat`,
`open-app.bat`, `install-autostart.bat`) - they are for the host PC and are correct as they are. Any
*other* tool or script of yours that calls `http://localhost:3000` from a different PC must use the host's IP instead.

## Outside the office (internet access) - separate, NOT enabled
Do **not** port-forward port 3000 on your router: the app speaks plain HTTP and the host PC would be exposed.
Safer options, in order:
1. **VPN into the office** (company VPN, or a mesh VPN such as Tailscale/WireGuard): remote users then use the same
   `http://<host IP>:3000` address. Nothing is exposed publicly. Recommended.
2. **Proper hosting** per `DEPLOY.md`: Render/Railway/own server + managed PostgreSQL (`DATABASE_URL`), **HTTPS**
   (reverse proxy such as Caddy, or the host's built-in TLS), `NODE_ENV=production`, a private `SIGNATORY_PIN`, and
   strong `ADMIN_PASSWORD`. The app refuses to start in production with the default PIN.
3. Never expose the database, `.env`, the data/backup folders, or credentials. Keep PostgreSQL on a private network
   (or restricted by IP) and keep secrets in environment variables, not in the project folder.
