# VeyraBrowser performance and chrome upgrade

## Requirements

- Keep ordinary sites on the existing fast proxy path.
- Start Roblox and similar browser-dependent apps on the fast proxy immediately, while racing Chromium as a compatibility fallback.
- Never expose upstream favicon thumbnails in the Veyra tab strip; use the Veyra mark for page tabs.
- Keep the top-level browser route stable at `/browse` (deployed beneath `/web` on the GitHub Pages site) rather than exposing `?url=<external-site>` in the public URL.
- Preserve the real destination internally for navigation, history, bookmarks, and proxy requests.

## Implementation

- `web/src/app.js`: preserve upstream page metadata in page tabs, remove external URL query parameters from the SPA route, normalize incoming query routes with `replaceState`, and keep the fast proxy first for Roblox-class hosts while racing Chromium as fallback.
- `web/src/bootstrap.js`: keep the outer document title stable as `/web` after app startup.
- `web/browse/index.html`, `web/index.html`: set stable `/web` titles in the entry documents.
- `docs/RESEARCH.md`: record evidence and constraints from Roblox, MDN, and Cloudflare documentation.

## Design and interaction

The existing product style is retained: quiet dark browser chrome, compact controls, and Veyra blue accent. Branding is intentionally stable in the tab strip so upstream sites cannot replace Veyra's visual identity. Navigation remains ordinary browser-like in the app state, while the public SPA URL becomes a privacy-preserving shell route.

The compatibility rule is explicit: fast proxy is the first render for every site, including large dynamic sites, while Chromium races only when a host is known to need browser APIs. This preserves the quick proxy surface and still provides a compatibility path for pages that cannot fully render through rewriting.

## Project structure

- `web/`: static GitHub Pages and Capacitor web application.
- `web/src/app.js`: tabs, routes, navigation, engine selection, and page surfaces.
- `web/src/bootstrap.js`: shared entry bootstrap, asset paths, theme, and document startup.
- `web/assets/`: durable Veyra icons and application assets.
- `docs/`: project documentation and research records.
