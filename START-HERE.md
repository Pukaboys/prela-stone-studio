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
- app/login, app/account: sign in / free trial, licence, PayPal checkout, downloads
- app/studio/page.tsx: the studio (pieces, slab layout, 2D/3D assembly)
- app/api/auth, app/api/licence, app/api/paypal: accounts, desktop licences, payments
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
no card), then buy a plan on My account with PayPal. Prices and plans are in
lib/plans.ts (Monthly €19, Yearly €199; 2 computers each, 1 during the trial).
Paying again extends from the current end date. Plans do not renew by
themselves.

- Online studio (/studio): needs a signed-in account with an active licence.
  Each account only sees its own projects.
- Desktop app: on first start it asks for the website email and password and
  activates that computer. The licence is a signed token stored on the
  computer, so the app works offline; it refreshes daily when online and
  stops after 30 days without contact or when the licence ends. Customers can
  remove a computer on My account.
- Downloads: put the installers and a manifest in the data folder under
  downloads/ (see lib/downloads.ts). Only accounts with an active licence can
  download; /api/app-version tells the desktop app about updates.

Environment variables on the host (Hostinger: website → Environment variables):

| Name | Value |
| --- | --- |
| LICENSE_PRIVATE_KEY | Contents of release/LICENSE_PRIVATE_KEY.txt. Required. Keep it secret, never commit it. |
| PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET | From developer.paypal.com → Apps & Credentials |
| PAYPAL_ENV | `sandbox` while testing, `live` for real payments |
| ADMIN_EMAIL | Your own account: unlimited licence, sees the existing projects |
| SESSION_SECRET | Optional; otherwise generated once and stored in the data folder |

The public half of the licence key is built into the app
(lib/licence-public-key.ts). If the private key is ever lost or leaked,
generate a new pair; existing desktop activations will then need to sign in
again. The website address the desktop app talks to is "licenseServer" in
desktop/app/package.json.

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
                     # scanner, accounts, licences, PayPal,
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
