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

## Velocity controls and quick tools

- Open Performance from the browser menu and `veyra://performance`. Switch between Standard, Balanced and Boost; reload and confirm the mode is retained. Refresh the shell timing snapshot; unsupported readings should show as unavailable, not zero.
- With two settled Fast Proxy tabs, park an eligible background tab from its context menu or Performance. Cancel once, then confirm and look for the `Parked` status. Select the parked tab and confirm it reloads once. A pinned, loading, active, streamed, popup-linked, or split-pane tab must not be parked.
- In Boost, open a bookmark in a background tab. The frame and page request should wait until selection. Standard and Balanced should still open background tabs normally. An active Fast Proxy page remains navigable in every mode.
- Use F2 or the New Tab “Commands” button. Use Commands, Tabs, Bookmarks and History filters, Arrow keys, Enter and Escape. Search an unknown term; no command should run. Private windows should offer only commands and their currently open tabs.
- Open Quick Tools. Convert distances and temperatures; check a bad value, count words and characters, and format valid and invalid JSON. Closing and reopening the tools should clear pasted content. Check both dialog surfaces and the Performance view at 375px.
