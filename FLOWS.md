# Veyra Search main flows

## Start a search
- From New Tab or the address bar, enter `Yr Wyddfa`; the active Veyra tab shows its own Search form, AI overview when signed in, and Web results across the content area. The Web tab has no category preview panel and does not request the all-category feed, at desktop or phone widths.
- Submit a different query from that form, accept a spelling correction when offered, and use More results if available. Confirm a new or restored tab retains its own results, category and answer.

## Change category
- Use Web, Images, Videos, News, Shopping, Research, Discussions or Veyra index. Check rich cards, attributed sources, pagination, retry/empty states and site filtering.
- Select a category from a mixed Web preview, then navigate back. Confirm the active category can be restored through browser history without putting queries in an incognito URL.
- Open a result in Veyra or Ctrl/Cmd-click to open a background tab. Videos continue through the existing YouTube watch flow where applicable.

## Ask Veyra AI
- Signed-in Web search shows the existing cited AI overview. A dedicated category can request its own cited summary.
- Guest and incognito browsing cannot request AI summaries. Incognito disables mixed-result previews and external thumbnails.

## Surrounding browser shell
- Open and close a new tab; return to the search with its data intact. Check Calculator, History, and Settings navigation, browser resize at 375px, and the console for regressions.

## Playback popup regression
- In a fixture for an xHamster watch page, click Play repeatedly. Same-video popups (including alternate slugs for the same ID and tracking parameters) and off-site scripted popups must not create tabs. The player remains in the original tab. Links to other videos and ordinary sign-in popups on unrelated sites still work.
