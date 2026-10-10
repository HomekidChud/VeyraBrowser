# Veyra Browser

Veyra Browser is a static JavaScript client for the Veyra Browser API and a Capacitor Android application.

## Extension security

The Store keeps legacy CSS-only packages and supports signed, human-reviewed v2 bundles with content scripts and a restricted background iframe. Executable packages require a trusted Ed25519 signature, explicit HTTPS site scope, and per-device install consent. Content scripts run in the visited page context, so signatures and static checks do not guarantee harmless behavior. Executable bundles are not automatically synced between devices.

## Development

```bash
npm install
npm run check
npm run sync
```

The static application lives in `web/`. GitHub Pages is deployed from `web/` by `.github/workflows/pages.yml`; Android builds copy the same directory through Capacitor.

## Android

```bash
npm run apk:debug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## API configuration

The browser uses the API origin declared by the `veyra-api` metadata in `web/index.html` and `web/browse/index.html`. It defaults to `https://veyraserver-xscy.onrender.com` and does not accept API origins from URL parameters.

## Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).
