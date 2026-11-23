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

Search fills the active browser tab. Web combines links and snippets with an optional Images preview; the preview loads separately so it cannot hold up Web results. Images and Videos use a gallery, and News, Shopping, Research, Discussions, and Veyra index have their own views. The browser requests the India region on every page. Providers without a regional filter, such as Crossref and Hacker News, still include global results. Shopping opens Indian merchant pages in Veyra and shows a rupee price only when one is explicitly supplied; prices are not converted and stock is not inferred.

Enter `google.com` to load the real site through Fast Proxy, or `search:google.com` to look up the domain inside Search. With more words, `search:google.com northern lights` asks Google alongside Veyra’s other sources and indicates whether Google results appear. This is different from `site:google.com northern lights`, which limits results to pages hosted at Google. When Google presents a CAPTCHA or an unsupported search interstitial in Fast Proxy, choose **Search with Veyra** to keep the query in the current tab or open the original Google URL directly.

Categories sit side by side; swipe the row on a phone to see the rest. Scrolling near the bottom loads another batch when one is available. The **More results** button remains for short result lists, keyboard navigation, and retry. Web can continue into the Veyra crawler index after provider pages run out.

Open `/search/?q=moon&type=images` under the deployed app base to link directly to a result category. Old `type=deep` links now open Web with the same query. The web and Android shells use the same route. Search requests go to the Veyra API without opening a proxy browsing session first; a proxy session is still required when opening a website.

Signed-in users can request a cited summary below the results. A search never starts a summary automatically. Incognito does not request inline image previews or load result thumbnails, and guest and incognito sessions cannot request AI summaries.

Deploy the matching VeyraServer category endpoint first, then ship the Pages and Capacitor client. An older API still supports Web and Veyra index. See [Search smoke checks](FLOWS.md) for browser QA.

### YouTube Watch Desk

The official player is available only after the Veyra API returns `ready` from `GET /api/media/youtube/:id`. Configure `YOUTUBE_DATA_API_KEY` in the server environment (not in this repository or the static client). The [YouTube status lookup](https://developers.google.com/youtube/data/guides/made_for_kids_status) checks whether the selected video is embeddable and not Made for Kids; the watch page links out when eligibility cannot be established. The queue is held in the active tab's memory and is not a recommendation feed.

## Debugging and known issues

For live end-to-end debugging sessions (GeoFS / Cesium through the Fast Proxy, OSM tile-template preload fix, session time-limit config mismatch) see
[`../VeyraServer/docs/DEBUG_SESSION_2026-10-11_B.md`](https://github.com/HomekidChud/VeyraServer/blob/main/docs/DEBUG_SESSION_2026-10-11_B.md) (also [PR #12](https://github.com/HomekidChud/VeyraServer/pull/12)) and
[`../VeyraServer/docs/GEOFS_DEBUG_REPORT.md`](https://github.com/HomekidChud/VeyraServer/blob/main/docs/GEOFS_DEBUG_REPORT.md).

## Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).
