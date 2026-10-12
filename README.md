# Veyra Browser

Veyra Browser is a static JavaScript client for the Veyra Browser API and a Capacitor Android application.

## Maintenance and QA

The 8.28.29 Fast Proxy follow-up continues the earlier test suites rather than replacing them. See the [26-site Fast Proxy report](docs/qa/2026-10-12/fast-proxy/README.md) for the latest findings, selected screenshots, cookie/SRI tests and native-browser handoff limitations. The [earlier maintenance report](docs/qa/2026-10-12/README.md) retains the production baseline and casting/extension/DevTools findings.

Run `npm ci && npm run check` for regression coverage. For a bounded live run, install Chromium with `npx playwright install chromium`, then run `npm run test:live`; results go to the ignored `qa-output/` directory.

The casting protocol now uses separate browser/device capabilities. Deploy the matching VeyraServer changes alongside this browser release; these changes are not a claim that every major site, third-party login or physical casting device works.

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

The browser uses the API origin declared by the `veyra-api` metadata in `web/index.html` and `web/browse/index.html`. It defaults to `https://veyraserver-xscy.onrender.com`. For local Termux development, serve `web/` on loopback and pass a loopback-only override:

```bash
python3 -m http.server 8080 --directory web
# Open http://127.0.0.1:8080/?veyra_api=http%3A%2F%2F127.0.0.1%3A10000
```

The override is accepted only when the page itself is served from `localhost`, `127.0.0.1`, or `::1`; public deployments continue using the fixed Render metadata.

## Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).
