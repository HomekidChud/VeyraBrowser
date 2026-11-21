# Veyra Browser

Veyra Browser is a static JavaScript client for the Veyra Browser API and a Capacitor Android application.

## Development

```bash
npm install
npm run check
npm run sync
```

The static application lives in `web/`. GitHub Pages uses **Deploy from a branch**, with `main` and `/(root)` as its only publishing source. The project landing page redirects into `web/`, and the root `404.html` restores deep links there. Keep the root directory layout when publishing: deploying `web/` directly as a separate Pages artifact would hide the canonical `/VeyraBrowser/web/` routes. Android builds still copy `web/` through Capacitor.

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

### Veyra Search

Search fills the active browser tab. Web shows text results and the AI overview when available. Images, Videos, News, Shopping, Research, Discussions, and Veyra index can each be opened directly. Shopping links open the merchant in Veyra; the browser does not process purchases. Without an eBay connection, product discovery depends on the configured web providers and does not show prices or stock.

Open `/search/?q=moon&type=images` under the deployed app base to link directly to a result category. The web and Android shells use the same route. Search requests go to the Veyra API without opening a proxy browsing session first; a proxy session is still required when opening a website.

Signed-in users can request a cited summary of the source pages behind a category. This is text retrieval, not analysis of image pixels, video playback, or retailer inventory. Incognito does not load result thumbnails, and guest and incognito sessions cannot request AI summaries.

Deploy the matching VeyraServer category endpoint first, then ship the Pages and Capacitor client. An older API still supports Web and Veyra index. See [Search smoke checks](FLOWS.md) for browser QA.

### YouTube Watch Desk

The official player is available only after the Veyra API returns `ready` from `GET /api/media/youtube/:id`. Configure `YOUTUBE_DATA_API_KEY` in the server environment (not in this repository or the static client). The [YouTube status lookup](https://developers.google.com/youtube/data/guides/made_for_kids_status) checks whether the selected video is embeddable and not Made for Kids; the watch page links out when eligibility cannot be established. The queue is held in the active tab's memory and is not a recommendation feed.

## Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).
