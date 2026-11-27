# 2027 UP Vidhan Sabha Public Opinion Survey

Mobile-first, bilingual (Hindi + English) public opinion survey web app covering all **75 districts** and **403 Vidhan Sabha constituencies** of Uttar Pradesh.

## Key Features
- **Cover Splash & 1-Question-per-Screen Flow:** `"2027 में यूपी में किसकी सरकार?"` splash entry followed by 5 focused steps (District Dropdown → Vidhan Sabha Seat Dropdown → Key Issue → Opinion Poll with leader PNG cutouts → Optional Age Group).
- **Official 18th Assembly Dataset:** 75 districts and 403 seats sourced from `uplegisassembly.gov.in` (`data/up-constituencies.json` & `data/up-constituencies.js`).
- **Infographics Dashboard:** Instant SVG Circle Donut Graph, Ranked Horizontal Bar Graph, Vertical Age Column Graph, Seat Switcher `<select>`, and WhatsApp deep-link share card.
- **Zero-Framework Speed:** Lightweight static HTML/CSS/Vanilla JS (~31 KB gzipped) ready for GitHub Pages and Cloudflare Pages.

## Local Preview
```bash
python -m http.server 8080
# Open http://localhost:8080
```

## Production Backend Wiring
See [`docs/DATABASE_AND_FLOW.md`](docs/DATABASE_AND_FLOW.md) for Firebase Firestore pre-aggregated counters + Cloudflare Turnstile + Cloudflare Pages Functions (`functions/api/vote.js`, `functions/api/results.js`).

## Image Credits
See [`docs/IMAGE_CREDITS.md`](docs/IMAGE_CREDITS.md) for Wikimedia Commons portrait sources and open licenses.
