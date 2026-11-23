# Veyra Search main flows

## Start a search
- From New Tab or the address bar, enter `Indian Railways`; the active Veyra tab shows the larger Search form and a list of links, domains and descriptions. Optional image previews load independently; Web does not request the all-category feed or request summaries automatically.
- Submit a different query from that form, accept a spelling correction when offered, and use More results if available. Confirm a new or restored tab retains its own results, category and answer.
- Open or reload `/search/?q=moon&type=images` under the app base, then try the same link with the legacy Pages prefix (without `/web`). Both should display Images for `moon`, not the landing or server health page.
- In a fresh guest or incognito window, search before opening a website. A search should work without creating a browsing session, and an unavailable server should leave the query in the tab with a retry action. Incognito must not put a new query in the address.

## Google navigation and inline search images
- With Fast Proxy active, enter `google.com`; the real Google homepage should load when it is available. Enter a query there or navigate to `https://www.google.com/search?q=northern+lights`; Fast Proxy tries the live URL. If Google challenges the proxy instead, use **Search with Veyra**; the original query opens in the same tab. **Open directly in a new tab** still goes to Google.
- Enter `search:google.com` to get search results with the official homepage first. Enter `search:google.com northern lights` to request Google alongside Veyra sources; the feed states whether Google was included. Check the command survives Back and category changes and that `site:` still filters results.
- Enter `search:nasa.gov moon landing`. Check that Web, Images and Videos keep the site scope, and that result-level previews appear only next to their matching source pages. Switch categories with **See all images** or **See all videos**. Providers may leave either section empty.
- Search for `moon`; when safe thumbnail results exist, verify Images appears alongside Web results on desktop and as a scrollable row on a phone. Select a thumbnail to open its source, or choose **See all images** to switch to the full gallery for the same query. Incognito does not request or show this preview.

## Change category
- Use Web, Images, Videos, News, Shopping, Research, Discussions or Veyra index. Check rich cards, attributed sources, pagination, retry/empty states and site filtering.
- Switch categories with a click or arrow keys. At 375px, swipe the single horizontal row to see later categories. Scroll near the end of a long result list to append the next batch without jumping or repeating links; use **More results** when the viewport does not scroll and **Retry more results** if a batch fails.
- Old links with `type=deep` must load Web with the same query. Research must still show journal results. Shopping shows INR only when a provider supplied an explicit rupee price; other listings must not get a converted or made-up amount.
- Open a result in Veyra or Ctrl/Cmd-click to open a background tab. Videos continue through the existing YouTube watch flow where applicable.

## Ask Veyra AI
- Signed-in users have a Veyra AI panel above the result list. It must not send a request until the user asks for a summary, picks a suggested follow-up, or types a question. Verify that citations open in Veyra and that each follow-up retrieves evidence for the current query, category and site filter.
- Start over, change the category or search, open another tab, or sign out during a reply. Follow-ups must not bleed into a different search or account. The current chat shows at most five turns and does not restore after reload.
- Guest and incognito browsing cannot request AI summaries or follow-ups. Incognito disables external thumbnails and uses local initials instead of requesting favicons. Check the favicon fallback and image pagination when the provider repeats a result or a thumbnail fails.

## Surrounding browser shell
- Open and close a new tab; return to the search with its data intact. Check Calculator, History, and Settings navigation, browser resize at 375px, and the console for regressions.

## Open a QR link
- From the main menu choose **Scan QR code**. Test **Take photo** on a phone and **Choose image** with a JPEG, PNG or WebP. Confirm the scan stays on the device and no destination request occurs during the preview.
- Use a code containing `https://example.com/path?value=hello%20world#section`. Check the preview shows the host and full URL, and only **Open in Veyra** navigates the active tab, preserving the path, query and fragment. Plain HTTP displays a warning.
- Scan an image without a QR code, a text or Wi-Fi code, a malformed or local-network URL, and a file over 12 MB. Confirm none can navigate. Cancel or press Escape while reading, then reopen and scan again; no previous link should remain.
- Check the dialog at 375 px, including a long destination and keyboard focus on dismissal. Device Cast must still generate its own pairing code; the public-link scanner is not a replacement for the device-pairing flow.

## TikTok and proxy recovery
- In a regular tab, paste a public TikTok video or photo URL. The panel opens without connecting to TikTok. Load it, use its official controls, and close it. Check that a silent iframe does not imply readiness, an unavailable post stays unavailable despite late events, and photo navigation identifies the visible slide.
- Paste a TikTok share link. It should offer **Open on TikTok** and **Use Fast Proxy**, with no player or automatic third-party request. Check the official link opens a separate tab without a referrer, and that **Use Fast Proxy** replaces the panel in the same Veyra tab.
- In incognito, with a VPN, or when VPN status is unknown, a TikTok post must not instantiate a direct player. A profile, unrelated site, and unrelated lookalike URLs should continue to use normal browsing.
- Open a Fast Proxy site that stays blank. If Chromium is disabled, Veyra should keep the page and offer site options with a retry and explicit direct link. A populated site, a different tab, and a stale message after navigation should not get that notice.

## Match scores and social smoke checks
- On deployed GitHub Pages, search Web, Images, Videos and Veyra index. Each result in a batch has an estimated 1–100% match. Open More results and check existing cards stay in place. At 375px, check the score, title, and category rail still fit.
- Type a multiword prefix, clear it while a request is running, and switch tabs. Suggestions should complete the entire query, never replace it with a single word, and never arrive for a stale input or private window.
- Try a public YouTube watch, timed share, and Shorts link. Only a verified eligible video exposes **Load YouTube player**; an unavailable check exposes **Retry eligibility check**. **Use Fast Proxy** stays in the Veyra tab, and **Open on YouTube** preserves Shorts, Live, and timestamp intent.
- Try TikTok load, close, initialization, buffering, error, and retry. On Reddit, X, Instagram and Twitch, try a normal page and a blocked or slow fixture. Recovery should explain the failure, preserve the frame, and never open an outside tab automatically.

## Playback popup regression
- In a fixture for an xHamster watch page, click Play repeatedly. Same-video popups (including alternate slugs for the same ID and tracking parameters) and off-site scripted popups must not create tabs. The player remains in the original tab. Links to other videos and ordinary sign-in popups on unrelated sites still work.
