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
