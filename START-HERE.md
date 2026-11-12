# Prela Stone Studio — source download

Browser-based slab layout and vein-matching app for Prela Mermer.

## Run locally

Install Node.js 22.13 or newer and pnpm, extract the ZIP, then open a terminal in the prela-stone-studio folder:

    pnpm install --frozen-lockfile
    pnpm dev

Open http://localhost:5173 (or the address printed by the server).

To build:

    pnpm build

## Contents

- app/page.tsx: editor and 2D/3D assembly previews
- app/globals.css: interface styles
- app/api/projects: saved-project API
- app/api/images: slab-image API
- lib/model.ts: project data model and placement checks
- public/demo-slab.png: illustrative demo texture
- pnpm-lock.yaml: dependency lockfile

The backend uses Cloudflare Workers and an R2 binding named BUCKET. Local development simulates that binding; deployment on another service needs equivalent storage or an adapted backend. This is not a standalone PHP app.

The archive includes source, configuration, and demo assets. It excludes installed dependencies, Git history, generated builds, credentials, uploaded slab photos, and saved project data. The existing Sites project ID remains in .openai/hosting.json as non-secret deployment configuration.

This version supports manual 2D planning, rectangular pieces, positionable rectangular openings, 90-degree cut rotation, and 3D assembly positioning with Z height and XYZ rotation. Exports are planning layouts, not machine-ready cutting files.

## Desktop app (Windows and macOS)

The desktop app is the same studio wrapped in Electron. It runs the studio
server privately on the computer (127.0.0.1) and works offline. Projects and
slab photos are stored in:

- Windows: `%APPDATA%\Prela Stone Studio\data`
- macOS: `~/Library/Application Support/Prela Stone Studio/data`

(File → Open Data Folder in the app opens it.)

Commands:

    pnpm desktop        # build and open the desktop app (development)
    pnpm desktop:win    # Windows installer → release/Prela Stone Studio Setup <version>.exe
    pnpm desktop:mac    # macOS .dmg (must run on a Mac)

Mac installers are built by GitHub: Actions → "Desktop installers" → Run
workflow, then download them under Artifacts. Pushing a tag such as `v1.0.1`
also attaches both installers to a GitHub Release.

The installers are not code-signed yet. Windows shows "Windows protected your
PC" (More info → Run anyway); macOS needs right-click → Open the first time.
The app version is in `desktop/app/package.json`.

## Website password (important)

Set the environment variable `STUDIO_PASSWORD` on the host (Hostinger:
website → Environment variables) to require a team password. Without it,
anyone with the address can open, change and overwrite projects. Signing in
gives a 30-day session; changing the password signs everyone out; repeated
wrong guesses are blocked for 15 minutes. The desktop app needs no password
(it only listens on this computer).

## Desktop ↔ website sync

In the desktop app: Projects → Website sync → enter the website address and
the team password once. Then "Upload this project" sends the open project
with its slab photos; "Show website projects" lists them for download. The
same project ID is used on both sides, so uploading again updates the copy.

## Production output

Export → Print cut list / Save PDF (drawing and table per slab), Download DXF
for CNC / saw (R12, millimetres; layers SLAB, MARGIN, CUT, OPENING,
MITRE_BELOW, MITRE_ABOVE, TEXT) and Quote… (prices saved with the project).
Slab layout → Auto-arrange places all pieces; Fix problems moves only pieces
that overlap, overhang or hit a defect.

## Tests and checks

    pnpm test        # unit tests (geometry, placement, mitres, openings,
                     # scanner, sign-in, quote/DXF, auto-arrange)
    pnpm typecheck
    pnpm lint

GitHub runs all of these plus a production build on every push (.github/workflows/ci.yml).

## Releases, updates and signing

Push a tag such as `v1.0.1` to build the Windows and Mac installers on
GitHub and attach them to a release. The tag sets the app version; the
desktop app checks for newer releases on start and in Help → Check for
Updates. Local builds stay at 1.0.0; the sidebar shows the build date and
commit so builds can be told apart.

To sign the installers, add these repository secrets (Settings → Secrets →
Actions): Windows `WIN_CSC_LINK` (base64 .pfx) and `WIN_CSC_KEY_PASSWORD`;
macOS `MAC_CSC_LINK` (base64 Developer ID .p12), `MAC_CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Without them the
installers are built unsigned.
