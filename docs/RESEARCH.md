# VeyraBrowser research findings

## Roblox compatibility

Roblox's official requirements page lists Chrome, Firefox, and Edge as supported browsers for the Roblox website on Windows, and Chrome, Firefox, and Safari on macOS. That is evidence for using a complete browser engine rather than treating Roblox as a static document. [1]

The Veyra fast proxy fetches HTML and rewrites links, resources, and selected browser APIs. That is useful for ordinary pages, but it cannot provide the same execution environment as Chromium for service workers, WebSockets, browser storage semantics, or complex client-side hydration. The Veyra runtime already detects these limits and can request a browser fallback; Roblox is now selected for Chromium before the proxy race begins.

This improves first usable render and avoids spending a request on a proxy shell that will be discarded. It does not claim that the Roblox native game client can run inside a server-streamed browser tab; that depends on Roblox's own launcher and platform support.

## Stable public URL and branding

The History API's `replaceState()` changes the current same-origin URL without loading the new URL. Veyra can therefore keep the actual target in in-memory tab state while normalizing the public app route to `/browse` (which is `/web/browse` when hosted under the `/web` base path). [2]

Upstream pages can send their own favicon and title. Veyra now keeps the outer tab strip branded with the Veyra mark and the stable `/web` label instead of displaying upstream metadata.

## Performance principles

Caching copies of frequently accessed content closer to users reduces origin load and improves delivery, but dynamic or personalized responses must not be shared blindly. Veyra already separates session-aware responses from shareable static resources; the upgrade avoids adding unsafe cross-session page caching. [3]

## References

[1]: https://en.help.roblox.com/hc/en-us/articles/203312800-Computer-Hardware-Operating-System-Requirements "Roblox Computer Hardware & Operating System Requirements"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState "MDN History: replaceState() method"
[3]: https://developers.cloudflare.com/cache/ "Cloudflare Cache documentation"
