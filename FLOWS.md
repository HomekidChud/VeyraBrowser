# Veyra Search main flows

## Start a search
- From New Tab or the address bar, enter `Indian Railways`; the active Veyra tab shows its own Search form and a simple list of links, domains and descriptions. The Web tab has no preview panels, does not request the all-category feed and does not request summaries automatically.
- Submit a different query from that form, accept a spelling correction when offered, and use More results if available. Confirm a new or restored tab retains its own results, category and answer.
- Open or reload `/search/?q=moon&type=images` under the app base, then try the same link with the legacy Pages prefix (without `/web`). Both should display Images for `moon`, not the landing or server health page.
- In a fresh guest or incognito window, search before opening a website. A search should work without creating a browsing session, and an unavailable server should leave the query in the tab with a retry action. Incognito must not put a new query in the address.

## Change category
- Use Web, Images, Videos, News, Shopping, Research, Discussions or Veyra index. Check rich cards, attributed sources, pagination, retry/empty states and site filtering.
- Switch categories with a click or arrow keys. At 375px, swipe the single horizontal row to see later categories. Scroll near the end of a long result list to append the next batch without jumping or repeating links; use **More results** when the viewport does not scroll and **Retry more results** if a batch fails.
- Old links with `type=deep` must load Web with the same query. Research must still show journal results. Shopping shows INR only when a provider supplied an explicit rupee price; other listings must not get a converted or made-up amount.
- Open a result in Veyra or Ctrl/Cmd-click to open a background tab. Videos continue through the existing YouTube watch flow where applicable.

## Ask Veyra AI
- Signed-in users can request a cited summary below their results. Confirm it stays out of the way until requested, and verify source links, unavailable state and retry with a fixture.
- Guest and incognito browsing cannot request AI summaries. Incognito disables mixed-result previews and external thumbnails.

## Surrounding browser shell
- Open and close a new tab; return to the search with its data intact. Check Calculator, History, and Settings navigation, browser resize at 375px, and the console for regressions.

## TikTok and proxy recovery
- In a regular tab, paste a public TikTok video or photo URL. The panel opens without connecting to TikTok. Click **Load TikTok player**, use the official player, close it, and check that it loads again only on request. Check reported errors, silence, a late player event, and the retry on desktop and at 375px.
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
