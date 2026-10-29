# Test checklist — phone and a second computer (after the website is live)

Use your real website address (`https://….onrender.com`). Tick every line. If something fails, note the line, the device and what you saw.
Test with **a throw-away customer name** (e.g. "TEST – delete me") and delete it afterwards (Saved drafts & history → Delete).

## A. On a phone (do it once on iPhone/Safari **or** Android/Chrome — ideally both)
Turn **Wi-Fi off** for one pass (mobile data) — this proves it does not depend on your office network or your PC.

- [ ] The address opens and shows the **Sign in** page (padlock/HTTPS shown). No “localhost”, no error page.
- [ ] Wrong password → red message “Incorrect username or password.” Correct password → home screen.
- [ ] The home screen fits the screen width — you never have to scroll sideways. Buttons are easy to tap.
- [ ] **Official Price List** card → form opens. Typing in a field does **not** make the page zoom in.
- [ ] Fill customer name, add a product row (type in the table; the table scrolls sideways inside its own box).
- [ ] *(optional, if you have an Excel file on the phone)* **Import Excel / CSV** → choose file → review → Import.
- [ ] **Save Draft** → green “Saved to server (version 1)” and a reference number like `PL-2026-0001`.
- [ ] **Preview Official Price List** → the whole A4 page is visible, shrunk to fit; you can pinch-zoom to read it.
- [ ] **Download Word** → file arrives (Files / Downloads) and opens in Word/Google Docs. Check heading, products, prices.
- [ ] **Download PDF** → file arrives and opens; layout matches the preview (2 signature blocks on a Price List).
- [ ] Repeat quickly with **Price Increase Notice** (preview, Word, PDF).
- [ ] **Saved drafts & history** → your test document is listed; tap it to reopen; **Versions & files** lists the downloaded Word/PDF.
- [ ] Rotate the phone sideways — nothing breaks.
- [ ] **Sign out** → back to Sign in. Pressing the browser Back button does not show documents.

## B. On a second computer (different network if possible — e.g. at home, not the office)
- [ ] Open the same address in a browser (Chrome/Edge/Firefox). Sign in with a **different** account (e.g. an editor).
- [ ] The document you saved on the phone is in **Saved drafts & history** (proves records are online, not on one device).
- [ ] Open it, change the customer name, **Save Draft** → on the phone, refresh the list: the change appears.
- [ ] Open the **same** document on both devices, save on one, then save on the other → the second one is told the document changed and offers “Save as new copy” (nothing is silently overwritten).
- [ ] **Print Official Price List** → print preview shows only the document on A4 (no website menus).
- [ ] Download Word and PDF → same content as on the phone.
- [ ] Sign in with a **viewer** account → can open and download, but has no Save / Import / Start New buttons.

## C. Staying power (the proof that data is permanent)
- [ ] Render dashboard → your website → **Manual Deploy → Restart service** (or wait for the next update). Reopen the site: sign in again if asked; **all documents are still there**.
- [ ] Sign in as **admin** → **Backup → Download full backup**. The ZIP downloads.
- [ ] *(once)* On a computer: open the site, wait 20+ minutes, open again — it responds immediately (paid plan, no sleeping).

## D. Access control
- [ ] In a private/incognito window open `https://YOUR-ADDRESS/api/docs` → you see `login_required`, **not** any documents.
- [ ] A disabled user (Users → Disable) can no longer sign in, and an already signed-in session of that user stops working.
