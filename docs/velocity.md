# Veyra Velocity

Velocity adds a performance profile, manual background-tab parking, a command palette, and local utilities to the Veyra web browser. Open Performance from the browser menu or enter `veyra://performance` in Veyra’s address bar. Use F2 or the New Tab “Commands” button for quick access.

## What the profiles change

| Profile | Background opens | Optional diagnostic requests | Visual effects |
| --- | --- | --- | --- |
| Standard | Load immediately | Follow the usual schedule | Unchanged |
| Balanced (default) | Load immediately | Pause scheduling while the browser window is hidden | Unchanged |
| Boost | New background pages with no existing frame wait for selection | Pause scheduling for hidden tabs and windows. Foreground diagnostic views can still request their data. | Fewer shell effects |

The profile is device-local. It does not change the session lifetime, Fast Proxy security policy, site compatibility logic, or search training. Server jobs that are already running do not stop merely because polling is paused. The active page, split panes, pinned tabs, streamed Chromium, YouTube embeds, and popup-related tabs cannot be manually parked. Parked pages reload rather than preserving arbitrary page state. A confirmation warns that playback or unsaved edits can be lost.

## Shortcuts and tools

| Default | Action |
| --- | --- |
| F2 | Command palette |
| Alt+Shift+T | Find open tab |
| Alt+Shift+P | Performance |
| Alt+Shift+U | Quick Tools |
| Alt+Shift+A | Customization Studio |
| Alt+Shift+S | Toggle split screen |
| Alt+Shift+G | Create tab group |
| Alt+Shift+C | Calculator |
| Alt+Shift+K | Keyboard shortcuts settings |
| Alt+Shift+E | Extensions |
| Alt+Shift+F | Toggle Game Focus |
| Alt+Shift+D | Duplicate tab |

Shortcuts are rebindable; a host browser or operating system may intercept some combinations. The command palette also accepts `tab:`, `bookmark:`, `history:` and `cmd:` filters. Incognito omits bookmarks and history from the palette. Quick Tools converts distance, mass, temperature, time, and data units; counts words, Unicode code points, and lines; and formats or minifies JSON. Text stays in the dialog until closed, unless explicitly copied to the device clipboard.

## Why this approach

- **Opera GX Control:** [Opera documents](https://www.opera.com/gx/features/gx-control) browser-level CPU, RAM, and bandwidth limits alongside its Hot Tabs Killer. Veyra’s hosted shell instead controls the work it starts itself and can remove eligible Fast Proxy frames; its snapshot does not imply a native resource cap or a measurement of frames per second.
- **Customization:** [GX Mods](https://www.opera.com/gx/features/mods) covers browser visuals, sounds, and layouts. Veyra keeps its existing Customization Studio separate so Boost can reduce effects without overwriting appearance settings.
- **Navigation and lifecycle:** [Vivaldi Quick Commands](https://help.vivaldi.com/desktop/shortcuts/quick-commands/) demonstrates scoped, keyboard-first navigation; [Vivaldi Workspaces](https://help.vivaldi.com/desktop/tabs/workspaces/) documents hibernation. Velocity distinguishes a never-loaded deferred page from a parked page that must reload.
- **Measurement:** [MDN’s performance fundamentals](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Fundamentals) recommends responding to visibility and avoiding unnecessary background work. The [Performance API](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/index.html) supports shell navigation timing and long tasks where available; [web.dev](https://web.dev/articles/optimize-long-tasks) explains why long tasks matter for interaction responsiveness. These readings are not a benchmark against Opera GX.
