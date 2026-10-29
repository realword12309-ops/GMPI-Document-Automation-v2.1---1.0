# Put GMPI Document Automation online (Render + GitHub) — step by step

**Goal:** a website address like `https://gmpi-document-automation.onrender.com` that authorised GMPI staff open
from a phone, laptop or desktop PC, sign in, and use — without your own computer running anything.

> **Status of this package:** the application is prepared and was tested here in *production mode* against a real
> PostgreSQL 16 database (see `TESTING.md`). It has **not been published** — I have no access to your GitHub or Render
> accounts, so I cannot create the public address for you. Follow the steps below (about 30–45 minutes, no programming).
> The website address only exists after **you** finish Part 3.

---

## What it costs (checked on render.com, 28 October 2026 — confirm on the screen before you pay)

| Part | Plan used | Approx. price |
|---|---|---|
| Website (web service) | `0.5c-512mb` — always on | US$7 / month |
| Database (PostgreSQL) | `0.1c-256mb` — keeps data, includes backups | US$6 / month |
| GitHub private repository | Free | $0 |

**Do not choose the "Free" plans for real work:** the free database is **deleted after 30 days** and has no backups, and the
free website falls asleep after 15 minutes (first visit then takes ~1 minute) and has no Shell. The file `render.yaml`
already selects the paid plans above.

---

## Part 1 — Put the project on GitHub (private)

GitHub is just a storage place Render reads your files from. Keep it **private**.

1. Go to <https://github.com> → **Sign up** (or sign in).
2. Click **+** (top right) → **New repository**. Name: `gmpi-document-automation`. Choose **Private**.
   Leave "Add README / .gitignore / license" **unticked**. Click **Create repository**.
3. On the next page click the link **“uploading an existing file”**.
4. On your computer, unzip the ZIP I gave you. Open the folder **`gmpi-docs`**.
   Select **everything inside it** (Ctrl + A) and **drag it into the GitHub page**. (Drag the *contents*, not the ZIP file, not the outer folder.)
   * There is no `node_modules` folder in the ZIP — correct, Render installs those itself.
   * If you ever see a file called `.env`, a `data` folder, or any `.zip` / `.db` file — **do not upload it.**
5. Wait until all files are listed, then at the bottom click **Commit changes**.
6. **Check:** the repository must now show these at the top level: `render.yaml`, `package.json`, `server`, `public`, `shared`,
   `templates`, `fonts`. (`render.yaml` is the important one.) If GitHub shows no `.gitignore` / `.env.example`, that is only a
   drag-and-drop quirk with hidden-style files — add them with **Add file → Upload files** if you can; the site works without them,
   but `.gitignore` is a safety net, so please add it.
7. **Never** put passwords in any file on GitHub. You will type them into Render in Part 2.

---

## Part 2 — Create the website and database on Render

1. Go to <https://render.com> → **Get Started** → sign up with your GitHub account (**Sign in with GitHub**). Allow Render to see your repository
   (you may choose *Only select repositories* → `gmpi-document-automation`).
2. Add a payment method when asked (Account Settings → Billing). The plans in `render.yaml` are paid.
3. Dashboard → **New +** → **Blueprint**.
4. Pick **`gmpi-document-automation`** → **Connect**.
5. Render reads `render.yaml` and shows **two items**: a *web service* `gmpi-document-automation` and a *PostgreSQL* database `gmpi-db`.
   It also asks you to fill in **three boxes**. Type your own values:

   | Box | What to type | Rules |
   |---|---|---|
   | `ADMIN_USERNAME` | The login name for the main administrator, e.g. `gmpi-admin` | 3–40 characters: letters, numbers, `.` `-` `_` |
   | `ADMIN_PASSWORD` | A strong password only you know | **At least 10 characters.** There is no default password. Write it in a password manager. |
   | `SIGNATORY_PIN` | A private PIN (e.g. 6+ digits/letters) | **Not** `gmpi-admin`. It unlocks editing of the default “Prepared / Approved / Acknowledged by” names. |

6. Check the plan/price lines shown, then click **Apply** (or *Create*).
7. Wait. The first build takes about **3–6 minutes**. Open the new service **gmpi-document-automation**; the top shows its **address**
   (`https://….onrender.com`) and the status. Wait for a green **Live**.
   * If it says **Failed**: click **Logs** and see *Troubleshooting* at the end of this file.
8. Click the address. You should see the **Sign in** page. **That address is your website.** Bookmark it and share it only with staff.

**How the database gets connected:** you do nothing. `render.yaml` tells Render to give the website the database’s private address as
the secret setting `DATABASE_URL`. It never appears in your code or on GitHub, and the database is closed to the outside internet.
The first time the website starts it creates its tables automatically and creates your administrator from the three boxes above.

---

## Part 3 — First login and creating staff accounts

1. Open your website address → sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. Top right → **Users** → add one account per person. Roles:
   * **admin** – everything, including Users and Backups (keep 2: you and one trusted person)
   * **editor** – create, edit, import, save, download
   * **viewer** – look at, download and print only
3. Give each person their own password (min. 10 characters). Accounts can be disabled or reset in the same **Users** window.
4. *(Recommended)* Render → your web service → **Environment** → delete `ADMIN_PASSWORD` (it is only needed before the first user exists).
   Keep `SIGNATORY_PIN`. Saving restarts the site; that is normal.

Staff can now use the site from any device with the address and their own login. Sessions last 12 hours; the cookie is private to the browser.

---

## Part 4 — Move your existing records from the PC version (no command line)

Do this **before** staff start creating real documents (so reference numbers don’t clash — if they do, the import gives the imported record a fresh number and tells you).

1. On the computer that runs the old app: open `http://localhost:3000` → top right **Backup** → **Download full backup (.zip)**. Keep that file private.
   *(The old data is only copied, never touched or deleted.)*
2. Open your **online** website → sign in as admin → **Backup** → under **“Add records from a backup file”** choose that `.zip` → **Add records** → OK.
3. The window reports how many documents, saved versions and generated Word/PDF files were added. Open **Saved drafts & history** to check.
4. This step only **adds**. It never deletes or overwrites online records, and it never copies old login accounts.
   Running it twice is harmless. Keep the ZIP until you have checked everything.

If the old app has a **different data folder** (e.g. you moved it), run `npm run backup` there and use that ZIP instead.
The first-version drafts (`data\drafts\*.json`) are converted automatically by the PC version the first time it starts — start it once, then take the backup.

---

## Part 5 — Backups (your safety net)

* Paid Render databases include **automatic backups** — open Render → `gmpi-db` and look for its **Backups / Recovery** section; note how many days are kept (Render may change the wording).
* In addition, once a week or after big jobs: website → **Backup → Download full backup**. Store it somewhere private (not in a shared folder).
  It contains customer/price data and password hashes.
* A backup can be re-added online with the “Add records from a backup file” button (Part 4).

---

## Part 6 — Administrator account: create, change, reset

**Create (first time):** from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` boxes in Part 2. No default login exists anywhere.

**Change someone’s password (you are signed in as admin):** **Users** → **Reset password** next to the name → type a new one (min. 10 characters).

**You are locked out (forgot the only admin password).** You need access to your Render account — that is what keeps this secure:
1. Render → website `gmpi-document-automation` → **Environment** → **Add Environment Variable** three times:
   `ADMIN_RESET` = `true`, `ADMIN_USERNAME` = *the admin’s login name*, `ADMIN_PASSWORD` = *a new password (≥ 10 chars)*.
2. **Save changes** (the site restarts, ~1 minute). In **Logs** you will see `ADMIN_RESET: password of "…" was reset…`.
3. Sign in with the new password.
4. **Immediately delete all three variables** (`ADMIN_RESET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) and save again. (If you leave `ADMIN_RESET=true`, every restart would reset the password again.)
   That reset also signs out all sessions of that account and re-activates it as administrator. If the name does not exist yet, it is created.

*(Alternative on a paid plan: Render service → **Shell** → `npm run reset-password -- username`.)*

---

## Part 7 — Updating the website later

Upload the changed files to GitHub (**Add file → Upload files**, same names replace the old ones → **Commit**). Render rebuilds and publishes automatically.
**Your records are in the database, not in the files, so updates never delete them.** Database changes (if any) are applied in order without dropping data.

---

## Optional — your own address (e.g. docs.gmpi.com.ph)
Render → website → **Settings → Custom Domains** → follow Render’s DNS instructions at your domain provider. HTTPS is added automatically.

---

## Troubleshooting

| What you see | What it means / what to do |
|---|---|
| Build **Failed** in Logs, mentions `package.json` / “Cannot find” | Files were uploaded inside an extra folder. `render.yaml` and `package.json` must be at the **top level** of the GitHub repository. |
| Logs: `Could not start: DATABASE_URL is not set` | Blueprint wasn’t used or the database link was removed. Re-check Environment → `DATABASE_URL` is "from database `gmpi-db`". |
| Logs: `Set a private SIGNATORY_PIN …` | Add `SIGNATORY_PIN` (not `gmpi-admin`) under Environment. |
| Logs: `No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD` | Add those two variables (password ≥ 10 characters), save, then remove the password later. |
| Page says “Cannot reach the GMPI server” | The service is restarting/waking. Wait a minute and refresh. |
| “Incorrect username or password” repeatedly | After 5 failures that login is blocked for 10 minutes. Wait, or use Part 6. |
| Slow first visit after a quiet period | Only on the Free plan (sleeps). Use the paid plan in `render.yaml`. |
| Word/PDF download does nothing on iPhone | Use Safari or Chrome; allow downloads; look in the **Files** app → Downloads. |

---

## Environment variables (reference)

| Variable | Needed? | Meaning |
|---|---|---|
| `NODE_ENV=production` | yes (set by `render.yaml`) | Turns on login, secure cookies, safe-start checks. |
| `DATABASE_URL` | yes (automatic) | PostgreSQL address. Without it the site **refuses to start** (so data can never silently sit on temporary disk). |
| `PORT` | automatic | Supplied by Render; the server listens on it (and on all network interfaces). |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | first start | Creates the first administrator, only while no user exists. |
| `SIGNATORY_PIN` | yes | Private PIN for editing default approver names. Default `gmpi-admin` is refused online. |
| `ADMIN_RESET=true` | emergency only | With the two above: reset that admin’s password. Remove afterwards. |
| `SESSION_HOURS` | optional | Login length, default 12. |
| `DATABASE_SSL=true` | optional | Force TLS to the database if your provider needs it. |
| `ALLOW_LOCAL_DB_IN_PRODUCTION=true` | **do not use online** | Lets production mode use a local file database (for a private server with its own permanent disk only). |

## Security rules (short)
* GitHub repository **private**; never upload `.env`, backups, `.db` files.
* Secrets only in Render’s Environment tab.
* Give people the lowest role they need; disable accounts of people who leave (**Users → Disable**).
* Browsers only talk to the same website (no cross-site API access); the API requires login; the database accepts only the website.

---

## Alternative: your own server with Docker (advanced)
```
git clone <your private repo> gmpi && cd gmpi
cp .env.example .env     # edit: POSTGRES_PASSWORD, ADMIN_USERNAME, ADMIN_PASSWORD, SIGNATORY_PIN
docker compose up -d --build
```
Listens on port 3000; put an HTTPS proxy (Caddy/nginx) in front. The Docker image path was **not** build-tested here (no Docker daemon available).
