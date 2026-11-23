# Developer portal QA

## Web workspace and tab layout

- In Customize workspace choose Pulse, switch the tabs to the left and then right, change the rail width, and check the top layout still works. Check the compact mobile rail and reload to verify the chosen theme and layout are saved.
- Create a named, coloured group from the browser menu or tab context menu. Add another tab; expand, collapse, rename and ungroup it. Verify group membership and order survive reload.
- Open two Fast Proxy pages, then split them. Resize by mouse and keyboard, stack the panes, swap sides and choose a different partner. A running page must not reload when the split layout changes. Exit the split and confirm the active page remains clickable.
- Toggle Game Focus and verify that animations and background diagnostics are reduced without dropping the visible page or session.

## Public documentation
- Open `/dev/platform/` signed out. The old live portal shows only a sign-in form; the new entry should show the fetch guide first without signing in.
- Switch the request language, copy an example, open the embed guide, and follow its direct reference link. The API key belongs only in a server-side environment variable.
- Filter the endpoint list with a path, plain words, and a non-match. Open and reload a deep link. Try an endpoint in the playground.
- Send the public status request with no key. Send a key-required request with and without a test key, then reveal and mask that key. Generated code must not contain the pasted key.

## Account console
- Open Console, submit sign-in, then visit Overview, Workspaces, API keys, Usage and Plans & waitlist.
- Create or rotate a disposable key, show and hide the secret, copy it, and close the dialog. A stored key should show only its prefix/last four characters.
- Refresh usage, open pricing, return to the public docs and sign out. Existing sessions should still be picked up automatically.

## Layout
- Check desktop and 375px. Navigation and code copy should fit without body overflow; wide tables can scroll inside their container.

## Browser smoke checks

- Open `/browse/` with an unlocked QA API: the new-tab dashboard, address bar, browser menu and bookmarks bar appear.
- Enter a regular HTTPS URL and a search: regular navigation remains in Fast Proxy, and searches still open Veyra Search.
- Open the profile menu and its Veyra account dialog: email and password remain available, and Google site sign-in is not described as Veyra OAuth.
- Open Google sign-in choices from the browser menu or enter an `accounts.google.com` URL: verify VPN settings, editable bookmark name, extension ZIP and direct tab. Cancel with the close button or Escape, and re-open without duplicate cards.
- Open a GitHub login or signup URL: verify the direct action uses the official start page and drops transient session parameters.
- On a normal browser profile, verify **GitHub signup** is added once and opens the official signup page in a separate tab. Remove it, reload and verify it stays removed. An existing signup bookmark with a custom name should be preserved. Incognito should not seed it.
- Check toast actions, input submission, deduplication, screen fit at 375 px, and reduced-motion behavior. Check that saved Google bookmarks open directly and ordinary bookmarks do not change behavior.

## Search region and routes

- Start on a Web search and submit a query with non-Latin text. Scroll to append another batch, or use **More results** if the list is short. Check that it appends without duplicates and the India region is carried through category changes and pagination.
- Reload a legacy `/search/?q=…&type=deep` link; check that it opens Web with the same query and never requests the retired endpoint. In a signed-in fixture, switch categories and confirm reload and browser back/forward preserve the search. Guests and private windows should not persist new searches in the address bar. Check **Web**, **Images**, **Research** (Crossref) and **Veyra index** still show their own results.
- Test valid `site:` and `-site:` filters, a malformed scope, an empty response, and a partial provider response. Check retry, result navigation and 375px layout, including scrollable category tabs and wrapping source labels.
- Open a standard Web search with a Veyra crawler result. The publisher URL and page excerpt are visible. Press Enter on **Source evidence: Strong** to read why it was rated and confirm the note says it is not a fact-check. A provider-only result instead reads **Source evidence: Not checked**. Check at 375 px and confirm evidence is not shown in incognito or on category cards.
- After a page of repeated links, **More results** should skip it and show the next new batch without removing existing results or moving keyboard focus. If a source fails after a repeated page, **Retry more results** should retry that source. The app stops skipping after a bounded number of requests.
- Search Videos and Shopping with no in-app matches: see clearly labeled YouTube and Indian retailer links outside Veyra, not products or videos counted as results. Verify outbound links send nothing until clicked, and are hidden for a scoped or incognito search. Confirm Openverse previews load without allowing arbitrary thumbnail hosts.
- Search Videos for “how to fix a leaking tap” and “how to make crispy dosa”. Verify the labeled YouTube cards point to `watch?v=…` and attribute the creator. In Shopping, search “wireless headphones” and “USB-C 65W charger”, then verify the cards link to direct Indian retailer listings, any displayed price is in rupees, and no standalone cable is shown for the charger query.
- With results and signed out, use **Sign in to use Veyra AI** and dismiss the sign-in dialog. Check the search is still active and no answer request was made. In an authenticated fixture, sign in on the same page and expect **Veyra AI overview** to answer automatically, before regular results, with source chips and a source panel. Check source links, desktop side-by-side and phone stacking, and that there is no chat input or follow-up control.
- Change query and category during a slow overview, scroll for more results, and check the newest overview gets one request and the old one cannot return. Exercise unavailable evidence, a failing provider with retry, invalid citations, and sign-out. An existing guest session stays private; incognito and searches without matching pages never call AI.

## Session privacy and VPN

- In a fresh guest context, browse a fixture site, end the session and confirm the tab closes without restoring its URL. Reload and verify browsing history, tab state and the session ID weren't written to local storage. Confirm the intentionally saved GitHub signup bookmark still exists.
- In incognito, open the profile menu and select **Hide screen**. Check that Escape doesn't reveal the screen, and **Reveal screen** restores it. Switch browser tabs to check the automatic cover at desktop and phone widths. Check that Device Cast is absent from the menu and cannot be opened by route.
- Open the VPN popover and full VPN panel. Verify a configured exit remains visible when the session-status request fails, that status is marked unknown, and that catalog failure is not described as zero configured exits.
- Open the downloads page and verify the launcher ZIP link. Check the official GitHub signup bookmark in a new context without entering credentials.

## Browser admin access

- Baseline: `veyra://admin` exposes overview, sessions, crawls, requests, logs, ads, config and tools. Confirm the upgraded panel keeps them available from both browser entry pages.
- Open `/web/admin` directly and reload `/web/admin/`. Expect a sign-in prompt signed out, a clear denial as a member, and the console as an administrator. Follow the sign-in button and verify successful sign-in opens the console without navigating away.
- A verified administrator should see one **Admin panel** bookmark in the Veyra bookmarks bar. Click it to reopen the panel, and sign out with the panel open. The console and bookmark should disappear immediately. A stale saved session must not show the console or shortcut.
- Simulate a failed access check and a failed download of the admin module. Verify a visible Retry button restores the console when the request can succeed.
- With a disposable administrator, switch Public → Staff only, cancel once, and confirm again. The summary should show only saved settings. A fresh visitor and a valid invite holder should see the lock screen, and their API requests should fail. Administrator recovery sign-in should still open the panel; a regular account should not pass it.
- While locked, turn new browser waitlist signups off and on. Check that the gate form reflects the setting and that the queue keeps its entries. The separate developer-platform waitlist must not be changed by this switch.
- Enable access test mode, run read-only checks, then disable it. Confirm the checks match public, invite holder and staff behavior, and that nobody gains an account, credential or access from test mode.
- Return to Invite only, redeem an existing invite, then switch Public. Reload in a fresh context; restart the fixture API and verify the persisted settings. Simulate a stale revision, rejected save and older server; expect clear errors or read-only status without showing a false save.
- Review a disposable browser waitlist entry, rotate a link, and verify no live mail is sent during QA. Test the policy form and confirmation with the keyboard. At 375 px, status text and controls must wrap without horizontal page overflow.
# Console Lab workbench checks

- Open `veyra://console-lab` and its existing plural spelling in the Veyra address bar. The singular address stays visible and no browsing proxy session starts. Reload and back/forward keep the lab usable. A signed-out or non-admin account sees the access prompt; verified admins see Console Lab.
- From Overview, open all modules: Console, Agent Studio, Live Activity, Neural Analytics, Task Runs, Crawler Fleet and Diagnostics. Check console help and filtering, editable agent templates, profile save/filter and run history, status refresh, and the local diagnostics and clear report controls. Server probes still require Fast Proxy.
- Open Website Analytics. Start with no metrics, then load the explicitly labeled demo or an aggregate CSV. Run a typed trend task, a top-pages or channels task and anomaly detection. Verify export, clear, invalid input, missing data and unknown task states. The CSV stays in this frame and no website-wide traffic is inferred from a URL.

## Customization Studio

- Open Settings → Appearance via the toolbar, menu or `veyra://customize`. Test themes, color mode, custom accent, typeface, density, and tab shape against the live preview and shell.
- Choose an independent wallpaper and Speed Dial layout, then open a New tab. Upload and remove a raster wallpaper; reject invalid files. Incognito should never load normal-window images or setups.
- Switch tab sides and hide/restore optional toolbar shortcuts without losing their menu actions. Toggle Game Focus and reduced motion, and preview or mute the opt-in tab sounds.
- Save, switch, export, import and remove a named setup. Reject invalid imports without applying anything. Verify reload persistence and that resetting the look leaves unrelated settings intact.
- At desktop and 375px, check the Studio, New tab, search, History, account UI and the signed-out Console Lab guard.
- Switch between a light and a dark theme from the expanded gallery. Pick a custom chrome tint, clear it, and check that changing the accent separately does not change the tint.
- Verify Studio category labels, headings, form labels, and setup names have readable contrast in both modes. In light mode, search Settings for “Wallpaper fit” and check the result on desktop and mobile.
- Choose a wallpaper. Test fit, horizontal and vertical position, dimming and intensity against the preview and New tab. Hide and restore the logo and dashboard search independently. The address bar must always be reachable.
- Change the active-tab indicator and top tab width. Move Downloads to the first optional toolbar slot and verify its visual and keyboard order. Hide an optional tool without losing its menu action.
- Undo and redo a look change (including a slider drag), and verify that changing a non-appearance setting is not reverted. Rename and update a saved setup, switch away and reapply it, then export it. Verify an older setup file still imports and that an invalid toolbar order or wallpaper setting is rejected.
- Export Sakura and Tide, inspect the downloaded JSON for the selected palette and wallpaper framing, then re-import. Check the wallpaper controls by touch and reload at phone width.

## Settings Control Deck and media

- In Keyboard shortcuts, filter by command and category. Record three combinations, remove one, then cancel. Move an existing binding only after checking the conflict confirmation. Save, trigger the command, reload, disable it, and restore defaults. Verify Escape closes the editor and restores button focus.
- On a touch phone viewport, open Edit, choose modifiers and a key, and tap Add without a keyboard. Check feedback for duplicates, invalid combinations and a fourth binding. Test conflict consent, cancel, reload, clear and restore, including a narrow portrait and short landscape viewport.
- In Video guides, expand the written steps and follow the section link. Verify no MP4 request on page entry, then play a clip from the dialog, close with Escape, and verify focus returns to Watch video. Repeat on a narrow phone.
- Open Settings Overview, pin and unpin Appearance and Performance, then reload. Change Overview layout, Settings spacing and panel contrast from Appearance → Layout. Verify dark and light mode, narrow-phone fit, keyboard navigation and setup export.
- Search for “wallpaper fit” and “focus rings”, edit a match, and clear with Escape. A second query must reuse matching sections and keep unrelated sections detached without making requests for off-screen sections.
- Open a YouTube watch, Shorts or timed share link. The official player should fill the active Veyra tab without waiting for a Veyra session. The direct YouTube link must open separately. Non-video links, private windows, VPN sessions and the inline-player opt-out must stay on regular routes.
- Open a now.gg game URL. Use the direct launch button to reach the same official URL in a browser tab, without attempting to frame it. Normal Bloxity links must remain on the existing Fast Proxy path.
- In an ordinary tab, open a YouTube watch link. With the eligibility API returning `ready`, verify the official player on the left and a Watch queue on the right; at phone width the queue stacks below. Paste a second link, switch to it without leaving the tab, use Back, and remove it. On `external`, `unavailable`, or API failure, verify that no player loads and Open on YouTube is still available. Private and VPN sessions must not instantiate the direct player.

## Website recovery

- Open a regular HTTPS page and choose **Site not working?** from the browser menu, or **Site options** from the address-bar site panel. Neither action should navigate or open a tab. Verify the options describe the current destination and warn that opening it directly leaves Veyra’s proxy, VPN and private window.
- Click **Open original site** and verify the same path, query and fragment open in a separate browser tab without an opener or a Veyra referrer. Try **Retry in Veyra** separately and verify it reloads inside Veyra. The browser menu should not offer these options on built-in pages.
- With the browsing API unavailable, verify the error screen shows **Try again** and **Open original site**, does not navigate automatically, and that **Try again** works with the frontend content security policy enabled. Recover the fixture API and retry. Check that the error screen is replaced and that another site can still be opened normally.

## Extension actions

- In Developer mode, load an unpacked fixture with an action and background worker. Check compatibility details, pin from the manager or puzzle menu, and invoke the button with the keyboard to update its badge. Verify the pin survives reload.
- Check the pin limit, disabling and re-enabling a pinned action, unpinning, removing, and re-importing the same package. A popup manifest must display its compatibility warning without running the popup. A private window must not load normal-window pins.
- On a phone, check the puzzle menu still offers actions and the address bar has space. Explain that this is a compatibility layer, not full Chrome Web Store support.

## Velocity controls and quick tools

- Open Performance from the browser menu and `veyra://performance`. Switch between Standard, Balanced and Boost; reload and confirm the mode is retained. Refresh the shell timing snapshot; unsupported readings should show as unavailable, not zero.
- With two settled Fast Proxy tabs, park an eligible background tab from its context menu or Performance. Cancel once, then confirm and look for the `Parked` status. Select the parked tab and confirm it reloads once. A pinned, loading, active, streamed, popup-linked, or split-pane tab must not be parked.
- In Boost, open a bookmark in a background tab. The frame and page request should wait until selection. Standard and Balanced should still open background tabs normally. An active Fast Proxy page remains navigable in every mode.
- Use F2 or the New Tab “Commands” button. Use Commands, Tabs, Bookmarks and History filters, Arrow keys, Enter and Escape. Search an unknown term; no command should run. Private windows should offer only commands and their currently open tabs.
- Open Quick Tools. Convert distances and temperatures; check a bad value, count words and characters, and format valid and invalid JSON. Closing and reopening the tools should clear pasted content. Check both dialog surfaces and the Performance view at 375px.

## Interactive delivery

- In Performance, choose a Chromium stream preset and reload; its selection should stay on the current device. Run the connection check with success, timeout, and Chromium disabled: it must distinguish Veyra response time from game ping and never invent an FPS reading.
- On a Chromium-enabled fixture, open a continuously moving page and check that multiple frames appear before the first metadata poll repeats. A burst of frames should show the newest frame, without painting a previous tab after switching.
- Try an older server without the live stream: the first screenshot should display, and completed input should request a fresh image without waiting for periodic status. Switch away, switch back, and close the streamed tab; no old stream should keep drawing.
- Check pointer click, wheel, keyboard and navigation on the streamed surface, plus normal Fast Proxy proxy pages, Settings, and Velocity commands. Verify session expiration, background visibility and reconnect behavior.
