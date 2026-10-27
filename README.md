# Velior API

Node.js (Express 5 + MySQL 8) backend for the Velior Fragrances storefront
(`../Velior Fragrances`) and admin panel (`../Velior Admin`).

## Run

```
npm install
npm run dev     # development (auto-restart)
npm start       # production
```

Copy `.env.example` to `.env` and fill it in. `JWT_SECRET` is required (32+ chars).

**Deploying:** `CORS_ORIGINS` must list the live storefront and admin
origins (e.g. `https://veliorfragrances.com,https://admin.veliorfragrances.com`;
`www.` variants are matched automatically). If the storefront's origin is
missing, the browser blocks every request and the site shows "Can't reach
the server" and its bundled (old) prices. Set `PUBLIC_URL` to the API's own
public URL so product images resolve.

## Database

Fresh database:

```
mysql -u <user> -p velior_fragrances < db/schema.sql
mysql -u <user> -p velior_fragrances < db/seed.sql
```

Existing database from before the admin panel: run `db/migrations/002_admin.sql`,
then `db/migrations/003_cleanup.sql` (removes development test data and the old
`is_dummy` flag), `004_customer_gender.sql`, `005_finance.sql` (order
channel, unit costs, stock purchases, expenses, partner stores) and
`006_production.sql` (production batches: cost breakdown, in-production
status), once each, in that order.

Create an admin login — this prints the SQL, it doesn't touch the DB:

```
npm run admin:sql -- --name "Your Name" --email you@example.com --password "a long password"
```

### Data rules

- **Catalogue.** The seeded products (Ambron … Tester Set) and FIRST10 are
  ordinary rows, managed from the admin like anything added later.
- **Orders** are re-priced and stock-checked server-side in a transaction;
  delivery fee and the default delivery estimate come from settings.
  Cancelling returns stock, reopening takes it again (409 if short).
- **Costs.** Stock purchases add units and set the product's average unit
  cost; each sold line copies that cost (`order_items.unit_cost`), so the
  dashboard's cost of goods doesn't shift when later purchases cost more.
  Net profit = revenue − cost of goods − expenses.
- **Settings** live as one JSON row per section in `settings`; missing rows
  fall back to the defaults in `src/lib/settings.js`.
- **Images** upload to `uploads/products/` and are stored as `/uploads/...`
  paths, served as absolute URLs on `PUBLIC_URL`. The seeded catalogue's
  images live in `uploads/seed/` (committed). Back up `uploads/` with the DB.

## Endpoints

Responses use `{ isRequestSuccessful, message, successResponse }`; 400s add
`errors: { "field.path": "message" }`.

### Storefront (public)

| Method | Path | Purpose |
|---|---|---|
| GET  | /api/health | Health check |
| GET  | /api/products | Visible products: sizes, prices, stock, images, notes, page content |
| GET  | /api/products/:slug | One product |
| GET  | /api/settings | Delivery fee, announcement, contact, socials, homepage numbers |
| GET  | /api/testimonials | Featured reviews, newest first |
| GET  | /api/faqs | FAQs in display order |
| POST | /api/promo/validate | `{ code }` → discount rate (404 if invalid) |
| POST | /api/orders | Place an order |
| GET  | /api/orders/track/:number | Track by full order number or running number |
| POST | /api/contact | Save a contact message |

### Admin (`/api/admin`, Bearer JWT)

The full contract is in `../Velior Admin/README.md`. Only `auth/login`,
`auth/forgot-password` and `auth/reset-password` are open. A password change
or reset signs out every other session (`token_version`).
