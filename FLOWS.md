# Veyra Search main flows

## Start a search
- From New Tab or the address bar, enter `Indian Railways`; the active Veyra tab shows its own Search form and a simple list of links, domains and descriptions. The Web tab has no preview panels, does not request the all-category feed and does not request summaries automatically.
- Submit a different query from that form, accept a spelling correction when offered, and use More results if available. Confirm a new or restored tab retains its own results, category and answer.
- Open or reload `/search/?q=moon&type=images` under the app base, then try the same link with the legacy Pages prefix (without `/web`). Both should display Images for `moon`, not the landing or server health page.
- In a fresh guest or incognito window, search before opening a website. A search should work without creating a browsing session, and an unavailable server should leave the query in the tab with a retry action. Incognito must not put a new query in the address.

## Change category
- Use Web, Images, Videos, News, Shopping, Research, Discussions or Veyra index. Check rich cards, attributed sources, pagination, retry/empty states and site filtering.
- Switch categories with a click, swipe or arrow keys. Confirm they keep the query, request the India region on subsequent pages and can be restored through browser history without putting queries in an incognito URL.
- Old links with `type=deep` must load Web with the same query. Research must still show journal results. Shopping shows INR only when a provider supplied an explicit rupee price; other listings must not get a converted or made-up amount.
- Open a result in Veyra or Ctrl/Cmd-click to open a background tab. Videos continue through the existing YouTube watch flow where applicable.

## Ask Veyra AI
- Signed-in users can request a cited summary below their results. Confirm it stays out of the way until requested, and verify source links, unavailable state and retry with a fixture.
- Guest and incognito browsing cannot request AI summaries. Incognito disables mixed-result previews and external thumbnails.

## Surrounding browser shell
- Open and close a new tab; return to the search with its data intact. Check Calculator, History, and Settings navigation, browser resize at 375px, and the console for regressions.

## Playback popup regression
- In a fixture for an xHamster watch page, click Play repeatedly. Same-video popups (including alternate slugs for the same ID and tracking parameters) and off-site scripted popups must not create tabs. The player remains in the original tab. Links to other videos and ordinary sign-in popups on unrelated sites still work.
