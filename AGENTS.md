# AGENTS.md

Static multi-page e-commerce site (Hanna & Nour, modest fashion). Vanilla HTML/CSS/JS only — no framework, no build step, no package.json, no tests, no CI.

## Working with the site
- Preview by opening any `*.html` directly in a browser (no server needed).
- `js/main.js` is loaded by all 9 pages. It is an IIFE that guards every element lookup, so it runs safely everywhere.
- `js/i18n.js` is loaded by all 9 pages (before `main.js`). Every page's `.lang-switcher` is functional.
- Images are stored locally in `images/` (`hero.jpg`, `silk-hijab.jpg`, `eid-abaya.jpg`, `everyday-hijab.jpg`, `velvet-abaya.jpg`, `prayer-wear.jpg`, `pearl-brooch.jpg`, `craftsmanship.jpg`, plus `favicon.svg`). Reference a local path directly if an image is missing; do not hot-link Unsplash.
- `collections/` is empty (unused).

## i18n
- i18n.js exposes `window.I18n`, supports `en`/`fr`/`ar`, persists choice in `localStorage['hn-lang']`, and switches page `dir` for RTL.
- Translate text with `data-i18n="key"` and placeholders with `data-i18n-placeholder="key"`; add new keys to all three languages in the `DICT`.

## Conventions
- i18n.js is ES5-style (`var`, IIFE). Match that style when editing.
- Add CSS via the custom properties (design tokens) in `:root` of `css/styles.css`. Color names are misleading: `--color-sage`, `--color-emerald`, and `--color-burgundy` are gold/beige tones, not their literal colors.
- Cart/wishlist logic in main.js is in-memory toast feedback only — no persistence, no real checkout.