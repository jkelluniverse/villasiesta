# Villa Siesta — In-House Platform (Next.js + Postgres)

The full booking platform: public marketing site, guest request→approve→pay flow,
owner portal, payments, Airbnb sync — one Next.js app on Railway backed by our own
PostgreSQL. This **supersedes** the Google Sheets / Apps Script backend at the repo
root (kept live until cutover).

## Status
- **Phase 1 — Foundation:** ✅ Next.js + Prisma + Postgres, seed (Villa Siesta + 22 photos + seasonal pricing + fees), public marketing site ported (brand, carousel, copy), map.
- **Phase 2 — Guest request:** ✅ live calendar/quote widget → `POST /api/bookings` (transactional, race-safe) → Pending tracker; owner + guest emails; live `/booking/[id]` status page.
- **Phase 3 — Owner portal core:** ✅ Auth.js login (roles OWNER / VIEWER); Command Center (net/occupancy/YTD/next-payout metrics + Needs-attention queue + 30-night occupancy strip + upcoming arrivals) reading live from Postgres; **approve/decline** as transactional server actions (approve consumes the dates via a `CalendarBlock`-equivalent hold and emails the guest a finalize link); one-click email/call/text on each row.
- **Phase 4 — Payments (CSG Forte):** ✅ branded `/booking/[id]/finalize` page (Forte.js client-side tokenization; card data never hits our server), `POST /api/bookings/[id]/finalize` charges via Forte REST `sale` — **pay in full**, or **50/50 split** (deposit now + stored-token balance scheduled for check-in − 14 days) when check-in is >90 days out; echeck (ACH, no fee) first, card (+3%), manual Zelle/Cash App/Venmo/Chime surfaced; `POST /api/forte/webhook` idempotently confirms `PAID`/`PARTIALLY_PAID`; both paths create the booking's `CalendarBlock` inside a transaction (final double-booking guard, self-excluded) and email a receipt.
- **Phases 5–6** (calendar+sync, ledger/clients): next.

### Payments (Forte) — mock mode
Until the Forte env vars are set, payments run in **MOCK mode**: the finalize button simulates an approved charge (clearly logged, receipt tagged `[TEST/MOCK PAYMENT]`) so the full finalize → PAID → calendar-lock loop works before the merchant account is wired. Set these to go live (Phase-4 vars, all from Forte's Dex portal):
`FORTE_API_ACCESS_ID`, `FORTE_API_SECURE_KEY`, `FORTE_ORGANIZATION_ID`, `FORTE_LOCATION_ID`, `FORTE_ENV` (`sandbox`|`live`), `NEXT_PUBLIC_FORTE_API_LOGIN_ID`. Point Forte's webhook at `https://villasiestasarasota.com/api/forte/webhook`.

### Owner portal
- Lives at **`/owner`** (behind Auth.js middleware; `/owner/login` is public). The public site stays open.
- Set `OWNER_PASSWORD` (and optionally `DAD_EMAIL` + `DAD_PASSWORD` for a read-only viewer) **before seeding** — the seed hashes them into the `User` table. Change the password later by re-seeding with a new value, or updating the `User.passwordHash`.
- `NEXTAUTH_SECRET` and `NEXTAUTH_URL` are required for login to work.

## Stack
Next.js 14 (App Router, TS) · Prisma · PostgreSQL · Resend (email, optional) · Stripe (later) · Auth.js (later).

## Local development
```bash
cd platform
cp .env.example .env            # set DATABASE_URL to a local Postgres
npm install
npx prisma migrate deploy       # or: npx prisma migrate dev
npm run db:seed                 # seed Villa Siesta
npm run dev                     # http://localhost:3000
```

## Deploy on Railway (cutover)
The app lives in this `platform/` subdirectory so the current static site at the repo
root stays live until you switch over. To cut over:

1. **Add a PostgreSQL plugin** to the Railway project (New → Database → PostgreSQL).
   It provides `DATABASE_URL`.
2. On the **web service → Settings**: set **Root Directory** to `platform`.
   The `railway.json` here builds with Nixpacks and starts with
   `prisma migrate deploy && next start` (migrations run automatically on deploy).
3. **Variables** (service → Variables): reference the DB and set the rest —
   ```
   DATABASE_URL   # Reference → the Postgres plugin's DATABASE_URL
   APP_URL=https://villasiestasarasota.com
   NEXTAUTH_SECRET=<openssl rand -base64 32>   # for the owner portal (later phase)
   NEXTAUTH_URL=https://villasiestasarasota.com
   OWNER_EMAIL=jacob@nicecityhomes.com
   NOTIFY_EMAILS=jacob@nicecityhomes.com, DAD_EMAIL
   RESEND_API_KEY=<optional; blank logs emails to the deploy logs>
   EMAIL_FROM=Villa Siesta <bookings@villasiestasarasota.com>
   AIRBNB_ICAL_URL=<optional>
   # Stripe keys added in the Payments phase
   ```
4. **Seed once** after the first successful deploy (Railway → service → open a shell,
   or run locally against the Railway DATABASE_URL):
   ```bash
   npm run db:seed
   ```
5. The domain `villasiestasarasota.com` already points at this Railway service —
   nothing to reprint.

## Data model
See `prisma/schema.prisma`. Everything is keyed by `propertyId` (multi-property ready).
Photos are static JPGs in `public/photos/` with labels seeded from `prisma/photos.json`.

## Notes
- **No double-booking:** every date-consuming write runs inside a Prisma `$transaction`
  that re-verifies no overlapping PAID/APPROVED booking or owner/Airbnb block exists
  (`src/lib/availability.ts`). Multiple *pending* requests for the same open dates are
  allowed by design — the owner approves one.
- **Tax:** direct bookings make FL + Sarasota tourist/sales tax the owner's responsibility;
  the `TAX_PERCENT` fee collects it, remittance stays manual.
- **Email:** without `RESEND_API_KEY`, emails are logged (so the flow works pre-config).
