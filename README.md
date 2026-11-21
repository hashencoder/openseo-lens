# OpenSEO Lens

A free, open-source SEO toolbar for Chrome, Edge, Brave and other Chromium browsers.
**No account. No sign-in. No API keys.** On-page analysis runs entirely in your browser.

## Features

| Tab | What you get |
|---|---|
| **Overview** | A 0–100 on-page score, error/warning/notice counts, title/description/H1/canonical/robots at a glance, and a list of issues ranked by severity (~45 checks) |
| **Content** | Word count, reading time, Flesch readability, text/HTML ratio, the heading tree (flags skipped levels), and 1-, 2- and 3-word keyword density |
| **Keywords** | **Demand score** (0–100, with a rough monthly-search range) from Google autocomplete depth, Wikipedia pageviews (a real 12-month trend) and YouTube/DuckDuckGo/Amazon suggestions. **Keyword difficulty** (0–100) from the live Google top 10. Also intent and head/long-tail type, hundreds of ideas plus a questions filter (each scored), a pick of 16 countries and 10 languages, and CSV export |
| **Links** | Every link with anchor text, internal/external split, and nofollow/sponsored/ugc. A **broken-link checker**, top linked domains, on-page highlighting, CSV export |
| **Images** | Missing or empty alt text, missing dimensions, heavy files, natural vs displayed size, format, lazy loading, CSV export |
| **Schema** | JSON-LD blocks (bad JSON is flagged), microdata, RDFa, and one-click Rich Results / schema.org validation |
| **Social** | A Google result preview using pixel-width truncation, Facebook/LinkedIn and X/Twitter card previews, and every OG/Twitter tag |
| **Technical** | HTTP status, the **full redirect chain**, response and security headers, a robots.txt tester (Googlebot, Bingbot, GPTBot, CCBot, `*`), sitemap discovery, hreflang, a resource breakdown and detected technology |
| **Speed** | Real Core Web Vitals from your own visit (LCP, CLS, INP, FCP, TTFB, TBT), plus a Lighthouse run through Google's public PageSpeed endpoint |
| **Backlinks** | Backlinks and referring domains from public sources that need no key: Wikipedia's external-link index (12 languages), Hacker News stories and comments, Lobsters, and Stack Overflow mentions. Also links seen on pages **you** browsed (stored locally). Switch between the whole domain and this URL. **Verify links** loads each referring page to confirm the link is still there and records its anchor text and dofollow/nofollow. Also shows top referring domains, anchor texts and CSV export |
| **Domain** | Tranco popularity rank, domain age, registrar and expiry (RDAP), Wayback first-seen date, DNS records |
| **Tools** | JSON/CSV/Markdown export, heading outlines on the page, keyword ideas from autocomplete (a–z expansion), and links to free external checks |
| **SERP overlay** | A bar under each Google/Bing/DuckDuckGo result showing position, domain, title length, URL depth and Tranco rank. On Google, a **keyword-difficulty panel** above the results shows KD, demand, intent, SERP features (AI Overview, People also ask, shopping, ads…) and weak spots (forums or off-topic pages you can outrank), with a top-10 breakdown |

The toolbar badge shows the page's HTTP status: green 200, amber when the page was redirected, red for errors.

Shortcuts: `Alt+Shift+S` opens the popup and `Alt+Shift+H` highlights links.

## Install (about 30 seconds)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `openseo-lens` folder.
4. Pin the extension, open any website and click the icon.

> HTTP status, headers and redirects are captured while a page loads. On tabs that were already open before you installed, reload once.

## What it does *not* do (honest limits)

Commercial SEO tools build their backlink indexes, "domain rating" and traffic estimates with their own web-scale crawlers.
No free, keyless source covers the whole web, so OpenSEO Lens does two things instead:

- **Backlinks** come from large public platforms (Wikipedia, Hacker News, Lobsters, Stack Overflow) plus a **local link graph** that grows as you browse. Coverage is strong for well-known sites and thin for small ones. Each link can be verified live.
- **Search volume:** exact Google volumes exist only inside Google Ads (which needs a login) or in paid databases. OpenSEO Lens shows a **demand score** built from public signals, plus a rough range (`<100`, `100–1K`, `1K–10K`, `10K–100K`, `100K+`). It is good for comparing and ranking keywords, but it is not an exact count. The Wikipedia view numbers are real data, for the topic rather than the query.
- **Keyword difficulty** is computed the way commercial tools describe theirs: the strength of the pages ranking in the top 10. Strength here comes from domain popularity (Tranco), how closely each title matches the query, homepage results, and forum/UGC weak spots, with the top 3 weighted higher. It reads **your own normal Google search**: either the page you are on, or one search opened in a background tab when you click *Check difficulty*. It never mass-queries Google. If Google shows a captcha, the tab is left open for you to solve.
- **Popularity** comes from the [Tranco](https://tranco-list.eu) research ranking. **Age and history** come from RDAP and the Internet Archive.
- For a complete backlink list of a site **you own**, use Google Search Console or Bing Webmaster Tools. Both are free, but they need you to verify ownership.

## Privacy

Page content is never uploaded. The only network calls are to these public endpoints, made when you open the related tab or press a button:
`tranco-list.eu`, `rdap.org`, `wikipedia.org`, `wikimedia.org` (pageviews), `duckduckgo.com/ac` and `completion.amazon.com` (autocomplete), `hn.algolia.com`, `lobste.rs`, `api.stackexchange.com`, `web.archive.org` / `archive.org`, `cloudflare-dns.com`, `googleapis.com/pagespeedonline` (Run button), and `suggestqueries.google.com` (Get ideas).
The broken-link checker requests the page's own link URLs, and **Verify links** requests the referring pages.

**Local link graph:** on pages you visit, the extension records which *external* sites the page links to (URL, anchor text, rel). It skips search engines, local addresses and pages with a password field, stores this only in `chrome.storage.local`, and never uploads it. You can turn it off or delete it in Settings. Results are cached locally (domain data for 7 days) and can be cleared in Settings.

## Project layout

```
manifest.json          MV3 manifest
background.js          service worker: redirect/header capture, badge, keyless data sources, link checker
content/vitals.js      Core Web Vitals observers (runs at document_start on every page)
content/linkgraph.js   local link graph recorder (outbound links → Backlinks tab)
content/analyzer.js    on-page extractor, injected on demand by the popup
content/highlight.js   link highlighter overlay
content/serp.js/.css   search-results overlay
lib/audit.js           audit rules + score
lib/robots.js          RFC 9309 robots.txt parser/matcher
popup/                 the toolbar UI
options/               settings
test/harness.html      dev harness: renders the real popup against test/fixture.html with a stubbed chrome API
```

No build step and no dependencies. It is plain JavaScript, so you can edit a file and reload the extension.

To develop the UI without reloading the extension, run `python -m http.server 8765` in this folder and open `http://127.0.0.1:8765/test/harness.html`.

## License

MIT. See [LICENSE](LICENSE).

## Author & contributors

Created and maintained by **Prafful Sharma** ([@hashencoder](https://github.com/hashencoder)).

Contributions are welcome. Open an issue or a pull request.
