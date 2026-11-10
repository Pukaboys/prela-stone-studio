# Prela Stone Studio — Expo Go (SDK 57)

## Run on a phone

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go. The phone and computer must be on the same network. If LAN discovery does not work, run `npx expo start --tunnel`.

This mobile target is intentionally independent from the existing Next/Vinext web editor. It stores the current project locally on the device and supports slab photo selection, slab layout, piece editing, placement checks, and assembly preview.
