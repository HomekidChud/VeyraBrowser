# Veyra Browser — GitHub Pages frontend v8

This project keeps the original static HTML/CSS/JavaScript architecture and upgrades the existing browser UI in place.

The frontend calls the Render backend at:

`https://veyraserver-xscy.onrender.com`

## v8 features

- Safe localStorage parsing and app-level crash recovery overlay.
- Explicit canonical/original URL state separated from the backend proxy URL.
- Multi-tab history remains canonical and tab-local.
- Veyra Search is first-class; normal text no longer redirects to Google unless the user explicitly selects external fallback mode in settings.
- Search result UI supports provider/index metadata, loading/error/empty states, pagination/load-more, keyboard selection, and opens results through Veyra's browser/proxy.
- Built-in safe calculator uses a parser rather than `eval()` or `Function()`.
- Centralized API wrapper with request timeouts, JSON/error handling, request IDs, and network diagnostics.
- Browser console/error/unhandled-rejection/resource diagnostics are bounded and forwarded to the backend without recursive logging.
- Proxied pages communicate canonical navigation/title/favicon through `postMessage`; the frontend never uses `iframe.location.href` to infer the original site URL.
- Back/forward operate on canonical URLs and Veyra Search/calculator states.
- `/dev`, `/settings`, `#console`, search, calculator, tabs, bookmarks, source inspection, link inspection, crawl stop/export and backend health remain available.
- Static-host `404.html` route fallback supports direct refresh of `/dev`, `/settings`, `/search`, and `/calculator`, including GitHub Pages project-site subpaths.

## Deployment

Upload the contents of this frontend directory to the existing GitHub Pages site. No frontend build step is required.

For a GitHub Pages project site, the included `404.html` preserves the requested route and redirects it into the SPA using `veyra_route`, so direct refreshes of tool/search paths do not become permanent 404s.

If the Render API origin ever changes, define `window.VEYRA_API` before `app.js` or update the constant at the top of `app.js`.

## Backend dependency

Set the Render service CORS environment variable to the exact GitHub Pages/custom-domain origin when practical:

```text
FRONTEND_ORIGIN=https://YOUR-FRONTEND-HOST
```

The frontend does not contain any search-provider API key.

## Resource fidelity update

The proxy frontend now keeps canonical website URLs separate from internal `/api/view` URLs, and proxied pages unwrap accidental proxy-shaped history URLs before updating the Veyra address bar. The backend resource layer supports larger bounded image/media payloads, Range requests, source-origin referrer context, SVG references, `imagesrcset`, and common lazy-loading attributes.

## Parallel crawler robots

The Crawler preferences section now exposes a **Crawler robots** setting. A robot is one parallel worker consuming the shared backend crawl frontier. New navigations send the selected robot count to `/api/open`; the Render environment variable `CRAWLER_ROBOTS` is the server-side ceiling.

For example, the Render service can be configured with:

```text
CRAWLER_ROBOTS=24
CRAWLER_PER_HOST_CONCURRENCY=4
PROXY_WARM_ROBOTS=12
PROXY_WARM_LIMIT=64
PROXY_WARM_PER_HOST=3
```

More robots can increase crawl throughput when the Render instance, network and target hosts can sustain the additional parallelism. Per-host limits, robots.txt, crawl delays, challenge detection, response-size limits and SSRF protection remain in force.

The proxy also starts non-blocking page-resource warming. Warm robots fetch likely-needed images, stylesheets, scripts, fonts, media and other page resources into the short-lived proxy cache while the first document is already being rendered.
