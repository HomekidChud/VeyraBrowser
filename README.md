# Veyra Browser — GitHub Pages frontend v8.3

This project preserves the original static HTML/CSS/JavaScript architecture and upgrades the browser UI in place.

The frontend calls the Render backend at:

`https://veyraserver-xscy.onrender.com`

## v8.3 features

- Safe localStorage parsing and app-level crash recovery overlay.
- Explicit canonical/original URL state separated from the backend proxy URL.
- Multi-tab history remains canonical and tab-local.
- Per-tab proxy session continuity: proxied pages can retain a bounded server-side cookie jar across Veyra navigation, forms and page API requests.
- Veyra Search is first-class; normal text no longer redirects to Google unless the user explicitly selects external fallback mode in settings.
- Veyra Search presents first-party index coverage, result counts, response time, domains, snippets, favicons, indexed dates, pagination, query suggestions, keyboard navigation, and local search operators.
- Empty search results explain that Veyra does not fabricate pages and show how opening a site grows the index; Render `INDEX_SEEDS` can grow it automatically in the background.
- Built-in safe calculator uses a parser rather than `eval()` or `Function()`.
- Centralized API wrapper with request timeouts, JSON/error handling, request IDs, and network diagnostics.
- Browser console/error/unhandled-rejection/resource diagnostics are bounded and forwarded to the backend without recursive logging.
- Proxied pages communicate canonical navigation/title/favicon/session state through `postMessage`; the frontend never uses `iframe.location.href` to infer the original site URL.
- Back/forward operate on canonical URLs and Veyra Search/calculator states.
- Crawl status exposes logical crawler robots separately from actual network slots so the UI does not confuse a 1,000-robot logical fleet with 1,000 simultaneous outbound requests.
- `/dev`, `/settings`, `#console`, search, calculator, tabs, bookmarks, source inspection, link inspection, crawl stop/export and backend health remain available.
- Static-host `404.html` route fallback supports direct refresh of `/dev`, `/settings`, `/search`, and `/calculator`, including GitHub Pages project-site subpaths.

## Deployment

Upload the contents of this frontend directory to the existing GitHub Pages site. No frontend build step is required.

For a GitHub Pages project site, the included `404.html` preserves the requested route and redirects it into the SPA using `veyra_route`, so direct refreshes of tool/search paths do not become permanent 404s.

If the Render API origin ever changes, define `window.VEYRA_API` before `app.js` or update the constant at the top of `app.js`.

## Backend dependency

Set the Render service CORS environment variable to the exact GitHub Pages origin:

```text
FRONTEND_ORIGIN=https://homekidchud.github.io
```

The frontend does not contain any search-provider API key.

## Resource fidelity update

The proxy frontend now keeps canonical website URLs separate from internal `/api/view` URLs, unwraps accidental proxy-shaped history URLs, preserves a per-tab proxy session across navigation/forms, and displays expanded crawl coverage for HTML, CSS, JS, data, assets, logical robots and actual network slots.

The backend resource layer supports larger bounded image/media payloads, Range requests, source-origin referrer context, selected public-site request metadata, SVG references, `imagesrcset`, common lazy-loading attributes, JSON/XML/text capture, and preservation of upstream 2xx statuses such as 201/204 where applicable.


## v8.5 browser features
The Veyra frontend includes a custom inspect-element mode, custom downloads (Ctrl+J), local history (Ctrl+H), an extension store/developer mode with safe manifest imports, and a loading-state toolbar button that becomes Stop while a page is loading.

## v8.5 browser features
The toolbar's Reload control becomes a Stop control while a page is loading. The tools dropdown provides Inspect element, Find in page, Print, Downloads, History, Extensions, Calculator, Search and diagnostics. Keyboard shortcuts include Ctrl+J, Ctrl+H, Ctrl+Shift+I, Ctrl+F and Ctrl+P. The extension developer mode accepts local JSON manifests with CSS-only UI customization; arbitrary script, network and credential access is deliberately excluded.
