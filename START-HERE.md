# Jeo Stone Studio — source

Slab layout, vein matching and cut lists for stone fabricators (website and desktop app).

## Run locally

Install Node.js 22.13 or newer and pnpm, extract the ZIP, then open a terminal in the project folder:

    pnpm install --frozen-lockfile
    pnpm dev

Open http://localhost:5173 (or the address printed by the server).

To build:

    pnpm build

## Contents

- app/page.tsx: sales website (features, pricing, FAQ); app/site.css its styles
- app/login, app/account: sign in / free trial, licence, how to buy, downloads
- app/admin: owner page (customers; switch on a plan after payment)
- app/studio/page.tsx: the studio (pieces, slab layout, 2D/3D assembly)
- app/api/auth, app/api/licence, app/api/admin: accounts, desktop licences, owner tools
- app/api/projects, app/api/images: saved projects and slab photos (per account)
- lib/model.ts: project data model and placement checks
- lib/plans.ts: prices, trial length, computers per licence

Storage is Cloudflare R2 when deployed there, otherwise files in DATA_DIR
(default ~/jeo-stone-studio-data) on the Node server.

## Desktop app (Windows and macOS)

The desktop app is the same studio wrapped in Electron. It runs the studio
server privately on the computer (127.0.0.1) and works offline. Projects and
slab photos are stored in:

- Windows: `%APPDATA%\Jeo Stone Studio\data`
- macOS: `~/Library/Application Support/Jeo Stone Studio/data`

(File → Open Data Folder in the app opens it.)

Commands:

    pnpm desktop        # build and open the desktop app (development)
    pnpm desktop:win    # Windows installer → release/Jeo Stone Studio Setup <version>.exe
    pnpm desktop:mac    # macOS .dmg (must run on a Mac)

Mac installers are built by GitHub: Actions → "Desktop installers" → Run
workflow, then download them under Artifacts. Pushing a tag such as `v1.0.1`
also attaches both installers to a GitHub Release.

The installers are not code-signed yet. Windows shows "Windows protected your
PC" (More info → Run anyway); macOS needs right-click → Open the first time.
The app version is in `desktop/app/package.json`.

## Selling: accounts, licences and payments

The website sells the studio. Visitors create an account (14-day free trial,
no card). To buy, they contact you (details in lib/site-config.ts) and pay by
bank transfer. You then open /admin (signed in as ADMIN_EMAIL), find the
customer and press "Add plan" with the amount paid. Prices and plans are in
lib/plans.ts (Monthly €19, Yearly €199; 2 computers each, 1 during the trial).
Adding a plan again extends from the current end date; "End now" locks a
customer out. Plans do not renew by themselves. (Online payment is not built
in; an earlier PayPal checkout is in the git history.)

- Online studio (/studio): needs a signed-in account with an active licence.
  Each account only sees its own projects. One account can be signed in on
  at most 2 browsers at a time (MAX_BROWSERS in lib/plans.ts); a third
  sign-in is refused until one browser signs out (My account → Browsers). A
  browser unused for 7 days gives up its place. On /admin you can sign a
  customer out of every browser.
- Desktop app: on first start it asks for the website email and password and
  activates that computer. The licence is a signed token stored on the
  computer. When online the app checks the subscription on every start and
  every few hours (renewals, plan changes, removed computers). Offline it
  keeps full use for 7 days since the last check (OFFLINE_GRACE_DAYS in
  lib/licence-token.ts); after that, or when the licence has ended, it runs
  in limited mode: projects can be opened and viewed, but adding pieces,
  saving, slab photos, exports and downloads are switched off until a check
  succeeds ("Check again"). Customers can remove a computer on My account.
  Website sync uses the computer's licence, not a browser place.
- Downloads: put the installers and a manifest in the data folder under
  downloads/ (see lib/downloads.ts). Only accounts with an active licence can
  download; /api/app-version tells the desktop app about updates.

Environment variables on the host (Hostinger: website → Environment variables):

| Name | Value |
| --- | --- |
| LICENSE_PRIVATE_KEY | Contents of release/LICENSE_PRIVATE_KEY.txt. Required. Keep it secret, never commit it. |
| ADMIN_EMAIL | Your own account: opens /admin, and sees the projects made before accounts existed. Counts only after the address is proven by its confirmation (or reset) link, so nobody can claim it by signing up first |
| ADMIN_ACCOUNT_ID | Optional: your account's ID instead (shown on My account). Needed while email is not set up |
| SESSION_SECRET | Optional; otherwise generated once and stored in the data folder |
| SITE_URL | The website address used in email links, e.g. `https://jeostonestudio.com` (set it once email is on) |
| SMTP_HOST, SMTP_PORT | Hostinger: `smtp.hostinger.com`, `465` |
| SMTP_USER, SMTP_PASS | The mailbox that sends, e.g. `info@your-domain.com`, and its password |
| SMTP_SECURE | Optional: `ssl` (default on 465) or `starttls` (587) |
| MAIL_FROM | Optional sender name, e.g. `Jeo Stone Studio <info@your-domain.com>` |
| CRON_SECRET | Optional, 16+ characters: lets a cron job call `/api/cron/reminders?key=…` |

The public half of the licence key is built into the app
(lib/licence-public-key.ts). If the private key is ever lost or leaked,
generate a new pair; existing desktop activations will then need to sign in
again. The website address the desktop app talks to is "licenseServer" in
desktop/app/package.json.

### Email

With the SMTP settings above, the website sends:

- a confirmation link at sign-up (the studio and desktop activation open once
  the address is confirmed; accounts made before email was set up count as
  confirmed),
- "Forgot password?" reset links (1 hour, single use; signs out every browser),
- reminders 7 days and 1 day before a licence ends, and when it has ended
  (once each per end date; checked hourly while the site has visitors, or by
  a cron job calling `/api/cron/reminders?key=CRON_SECRET`),
- "Payment received" when you add a plan on /admin, and a note to ADMIN_EMAIL
  for every new trial.

Without SMTP settings none of this is sent and sign-up works without
confirmation. The password is only read from the environment, never stored
in the code.

### Admin page security

/admin needs the owner account (above), signed in, plus two-step login: on the
first visit you scan a QR code with an authenticator app (Google/Microsoft
Authenticator, 1Password…) and get 10 one-time recovery codes. Each browser
asks for a fresh code every 12 hours; 5 wrong codes block for 15 minutes.
Every admin action and two-step login is in the Activity list (time, IP,
before/after), stored per month in the data folder under audit/. Lost phone
and no recovery codes: delete the "totp" entry from your account file in the
data folder (accounts/<id>/account.json) and set it up again.

### Saving

The studio saves by itself about 3 seconds after the last change (not in
limited mode), keeps a copy of unsaved changes in the browser / app so a crash
or a lost connection loses nothing ("Unsaved changes found → Restore" on the
next start), and reopens the last project on start.

### Settings (gear button in the studio header)

- Cutting rules, saved with each project: saw blade thickness, edge trim,
  space between pieces (snap, Auto-arrange and checks), distance from
  defects, smallest distance from a cut-out to the piece edge (default 50 mm)
  and between cut-outs. "Use for new projects" makes them the start values.
- Working preferences, kept on each computer/browser: magnetic snap on/off,
  snap distance, move grid, arrow-key step, wheel rotation step, new slab
  thickness, new piece size, autosave, reopen the last project.

## Desktop ↔ website sync

In the desktop app: Projects → Website sync → enter the website address and
your account email and password once. Then "Upload this project" sends the
open project with its slab photos; "Show website projects" lists them for
download. The same project ID is used on both sides, so uploading again
updates the copy.

## Production output

Export → Print cut list / Save PDF (drawing and table per slab), Download DXF
for CNC / saw (R12, millimetres; layers SLAB, MARGIN, CUT, OPENING,
MITRE_BELOW, MITRE_ABOVE, TEXT) and Quote… (prices saved with the project).
Slab layout → Auto-arrange places all pieces; Fix problems moves only pieces
that overlap, overhang or hit a defect.

## Tests and checks

    pnpm test        # unit tests (geometry, placement, mitres, openings,
                     # scanner, accounts, licences, owner page,
                     # quote/DXF, auto-arrange)
    pnpm typecheck
    pnpm lint

GitHub runs all of these plus a production build on every push (.github/workflows/ci.yml).

## Releases, updates and signing

Push a tag such as `v1.0.1` to build the Windows and Mac installers on
GitHub and attach them to a release. The tag sets the app version; the
desktop app asks the website (/api/app-version) for newer versions on start
and in Help → Check for Updates. Local builds stay at 1.0.0; the sidebar shows the build date and
commit so builds can be told apart.

To sign the installers, add these repository secrets (Settings → Secrets →
Actions): Windows `WIN_CSC_LINK` (base64 .pfx) and `WIN_CSC_KEY_PASSWORD`;
macOS `MAC_CSC_LINK` (base64 Developer ID .p12), `MAC_CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Without them the
installers are built unsigned.
