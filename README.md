# Veyra Browser

Veyra Browser is a static JavaScript client for the Veyra Browser API and a Capacitor Android application.

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

### YouTube Watch Desk

The official player is available only after the Veyra API returns `ready` from `GET /api/media/youtube/:id`. Configure `YOUTUBE_DATA_API_KEY` in the server environment (not in this repository or the static client). The [YouTube status lookup](https://developers.google.com/youtube/data/guides/made_for_kids_status) checks whether the selected video is embeddable and not Made for Kids; the watch page links out when eligibility cannot be established. The queue is held in the active tab's memory and is not a recommendation feed.

## Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).
