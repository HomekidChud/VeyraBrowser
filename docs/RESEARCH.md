# VeyraBrowser research findings

## Roblox compatibility

Roblox's official requirements page lists Chrome, Firefox, and Edge as supported browsers for the Roblox website on Windows, and Chrome, Firefox, and Safari on macOS. That is evidence for using a complete browser engine rather than treating Roblox as a static document. [1]

The Veyra fast proxy fetches HTML and rewrites links, resources, and selected browser APIs. That is useful for ordinary pages and should remain the first render for large sites. It cannot provide the same execution environment as Chromium for service workers, WebSockets, browser storage semantics, or complex client-side hydration. The Veyra runtime detects these limits and races a browser fallback for Roblox-class hosts without removing the fast proxy surface.

This keeps first usable render fast while allowing the full browser path to win when the proxy cannot complete the app. It does not claim that the Roblox native game client can run inside a server-streamed browser tab; that depends on Roblox's own launcher and platform support.

## Stable public URL and branding

The History API's `replaceState()` changes the current same-origin URL without loading the new URL. Veyra can therefore keep the actual target in in-memory tab state while normalizing the public app route to `/browse` (which is `/web/browse` when hosted under the `/web` base path). [2]

Upstream pages can send their own favicon and title. Individual Veyra browser tabs preserve that page metadata, while the outer Veyra app document keeps its own `/web` title and Veyra favicon.

## Performance principles

Caching copies of frequently accessed content closer to users reduces origin load and improves delivery, but dynamic or personalized responses must not be shared blindly. Veyra already separates session-aware responses from shareable static resources; the upgrade avoids adding unsafe cross-session page caching. [3]

## References

[1]: https://en.help.roblox.com/hc/en-us/articles/203312800-Computer-Hardware-Operating-System-Requirements "Roblox Computer Hardware & Operating System Requirements"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState "MDN History: replaceState() method"
[3]: https://developers.cloudflare.com/cache/ "Cloudflare Cache documentation"
