# Developer portal QA

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
