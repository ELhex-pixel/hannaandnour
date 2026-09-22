# AGENTS.md

E-commerce site (Hanna & Nour, modest fashion). Vanilla HTML/CSS/JS front-end + real backend:
Supabase catalog, Stripe Checkout payments, API served by Netlify Functions (`netlify/functions/*`).

## Setup
- The site works fully static (demo catalog, localStorage cart/wishlist, no backend).
- To activate the real backend, follow `SETUP.md` (Supabase project, env vars, Stripe webhook). All secrets live in Netlify env vars — never commit `.env` or real keys.

## Working with the site
- Open any `*.html` directly in a browser for offline preview (API calls fall back to static markup).
- Every page loads, in order: `js/config.js` → `js/i18n.js` → `js/store.js` → `js/main.js` (+ a page script for shop/product/cart/checkout/account; `404.html` uses absolute `/js/...` paths and no page script).
- `js/store.js` exposes `window.HN` (IIFE, ES5 style): `api`, `tr`, `money`, `lang`, `productName`, `loadProducts`, `getProduct`, `products()`, `cart.{list,add,update,remove,clear,count}`, `wishlist.{list,toggle,has,count}`, `quickAdd`, `refreshBadge`, `updateWishlistHearts`, `isAuthConfigured`. Cart key: `localStorage['hn-cart']`, wishlist: `localStorage['hn-wishlist']` (slugs), lang: `localStorage['hn-lang']`, promo `WELCOME15`: `sessionStorage['hn-promo']`.
- Page scripts are self-contained: `shop.js`, `product.js`, `cart-page.js`, `checkout.js`, `account.js`. `main.js` only handles shared UI (header, toasts, modals, tabs, newsletter form, wishlist/quick-add delegation, qty/gallery/color/size on product page).
- Images live in `images/`. Reference local files; do not hot-link Unsplash. `collections/` is unused.

## API (Netlify Functions)
- `/api/products`, `/api/products?slug=`, `/api/checkout`, `/api/orders?session_id=` or `?email=`, `/api/newsletter`, `/api/reviews`, `/api/contact` (contact form → `contact_messages` table), `/api/stripe-webhook`, `/api/config` (public settings), `/api/admin/*` (authed) (all proxied from `/.netlify/functions/*` via netlify.toml).
- Checkout creates a pending order, redirects to Stripe; webhook marks `paid` / `abandoned`. Orders render as `HN-<hex>`.
- `orders.js` returns `{order}` for `session_id` and `{orders}` for `email`.
- Order confirmation emails: `stripe-webhook.js` sends a recap via Resend when payment becomes `paid` (best-effort, skipped if `RESEND_API_KEY` is unset). Email template lives in `buildOrderEmail()` inside `stripe-webhook.js`; sending helper is `sendEmail()` in `shared.js`.
- `stripe-webhook.js` calls the `decrement_stock(p_variant_id, p_qty)` RPC for each paid line and adapts the confirmation email/`shipLabel` for pickup orders.
- `checkout.js` (Netlify) validates **stock per variant** (`product_variants`), blocks unavailable combos, resolves `variantId` into `order_items`, computes shipping from the `settings` table (fallback: env vars) and persists `delivery_type`/`pickup_point`.
- `admin.js` API (all behind `requireAdmin`, HMAC token signed with `ADMIN_PASSWORD`, 12 h TTL): `login`, `listProducts`, `saveProduct`, `deleteProduct`, `uploadImage` (bucket `product-images`, base64 ≤ 4 MB), `listOrders`, `getOrder`, `updateOrder` (`shipping_status` new/shipped/delivered + `tracking_number` + email sent when shipped), `getSettings`, `saveSettings`, `listMessages`, `updateMessage` (mark read/unread), `deleteMessage` (Messages tab reads `contact_messages`). Client: `admin.html` + `js/admin.js`.
- Printable docs: `print.html` + `js/print.js` (invoice / packing slip / barcode label via vendored `js/vendor/jsbarcode.min.js`).
- Contact form: `contact.html` + `js/contact.js` POST to `/api/contact` (`netlify/functions/contact.js`) — validates, inserts into `contact_messages` (RLS on), best-effort email to `CONTACT_EMAIL` if `RESEND_API_KEY` set.

## Business rules (MUST stay in sync client & server)
- Tax 7 % (`checkout.js`/`cart-page.js` client; `TAX_RATE` server). Shipping: free ≥ `FREE_SHIPPING_THRESHOLD_CENTS` (7500 ¢), else standard 699 ¢, express 1200 ¢, next-day 2500 ¢.
- **Admin-editable**: the `settings` table (key `shipping`) can override tax/shipping/free-threshold/pickup rates via the `/admin` page — it takes precedence over env vars. The client fetches them from `/api/config`. Key `catalog` in `settings` stores an admin-defined list of shop colors (`{ colors: [...] }`, edited in `/admin` → Settings); the **color filter is currently removed** from `/shop`, so this field is kept in backend/admin only (not read by `shop.js`) for a future re-enable.
- A product **with `product_variants` rows = managed stock** (each color×size has its own stock; missing combo is blocked; size buttons are disabled when out of stock). A product **without variant rows = unlimited legacy product**. Cart items carry `variantId`.
- Always mirror price/tax/shipping changes in the client JS AND the Netlify functions, or the displayed total won't match the charged total.
- Static product cards on index/shop/collections/cart carry `data-slug`/`data-price-cents`/`data-name`/`data-image` and link to `product.html?slug=...`; JS re-renders them from the API when available. Product slugs must match `seed.sql`/`seed_products_2.sql`.

## i18n
- `js/i18n.js` (ES5 IIFE) exposes `window.I18n` (`en`/`fr`/`ar`), persists `localStorage['hn-lang']`, switches page `dir` for RTL. Confirm all slugs you add in `tr()` land in all three languages.

## Conventions
- i18n.js and store.js are ES5-style (`var`, IIFE). Match that style when editing them.
- Add CSS via design tokens in `:root` of `css/styles.css`. `--color-sage`/`--color-emerald`/`--color-burgundy` are gold/beige tones, not literal colors.
- Netlify functions are CommonJS (`require`/`module.exports`), Node 20. Use `shared.js` helpers (`json`, `getSupabase`, `isConfigured`, `readBody`).
- No test suite or CI. Sanity-check with `node --check <file>` on JS edits.