# Villa Siesta — In-House Platform (Next.js + Postgres)

The full booking platform: public marketing site, guest request→approve→pay flow,
owner portal, payments, Airbnb sync — one Next.js app on Railway backed by our own
PostgreSQL. This **supersedes** the Google Sheets / Apps Script backend at the repo
root (kept live until cutover).

## Status
- **Phase 1 — Foundation:** ✅ Next.js + Prisma + Postgres, seed (Villa Siesta + 22 photos + seasonal pricing + fees), public marketing site ported (brand, carousel, copy), map.
- **Phase 2 — Guest request:** ✅ live calendar/quote widget → `POST /api/bookings` (transactional, race-safe) → Pending tracker; owner + guest emails; live `/booking/[id]` status page.
- **Phase 3 — Owner portal core:** ✅ Auth.js login (roles OWNER / VIEWER); Command Center (net/occupancy/YTD/next-payout metrics + Needs-attention queue + 30-night occupancy strip + upcoming arrivals) reading live from Postgres; **approve/decline** as transactional server actions (approve consumes the dates via a `CalendarBlock`-equivalent hold and emails the guest a finalize link); one-click email/call/text on each row.
- **Phase 4 — Payments (Square):** ✅ branded `/booking/[id]/finalize` page on the **Web Payments SDK** (card element + Plaid-powered ACH; tokens only — card data never touches our server, SAQ-A scope). ACH offered first (no fee), card +3% applied **at charge time**; **50/50 split** (deposit now, card-on-file via `verifyBuyer`, balance auto-charged at check-in − 14 days) offered when check-in > 90 days out — persisted at approval, recomputed server-side. ACH completes async: a PENDING payment holds the dates and the **signed webhook** (`/api/square/webhook`) flips PAID/PARTIALLY_PAID (and releases dates on ACH returns). Daily `npm run sweep` cron charges due balances, retries declines with a fresh pay link until check-in − 7. Owner **Send bill** creates a Square payment link, emails it, logs `CommsLog`. Deterministic idempotency keys (`bk_{id}_full|deposit|balance`) make retries double-charge-proof.
- **Phases 5–6** (calendar+sync, ledger/clients): next.

### Payments (Square) — mock mode & go-live
Until `SQUARE_ACCESS_TOKEN` is set, payments run in **MOCK mode** (simulated approved charges, receipts tagged `[TEST/MOCK PAYMENT]`). To go live:
1. Set `SQUARE_ACCESS_TOKEN`, `SQUARE_ENVIRONMENT` (`sandbox`|`production`), `SQUARE_LOCATION_ID`, `SQUARE_APPLICATION_ID`, `NEXT_PUBLIC_SQUARE_APPLICATION_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID` (redeploy — `NEXT_PUBLIC_*` bake in at build).
2. Developer Dashboard → **Webhooks** → subscribe `payment.updated` (+`payment.created`) at `https://villasiestasarasota.com/api/square/webhook`; put the Signature Key in `SQUARE_WEBHOOK_SIGNATURE_KEY`.
3. Add a **Railway cron service** on this repo (Root Directory `platform`) running `npm run sweep` daily — it charges due split balances.
4. Check `/api/square/status` — booleans show exactly which vars are missing.
5. Sandbox test card: `4111 1111 1111 1111`, any future expiry/CVV. Test all four paths (FULL/card, FULL/ACH via webhook, SPLIT deposit, sweep with `balanceDueDate` set to yesterday). Then flip to production keys and run one real $1 charge + refund.
Compliance notes: the +3% card surcharge is legal in FL with disclosure (shown on the page and receipt; keep it ≤ actual cost). ACH returns can arrive days later — the webhook handles a payment that un-completes.

### Owner portal
- Lives at **`/owner`** (behind Auth.js middleware; `/owner/login` is public). The public site stays open.
- Set `OWNER_PASSWORD` (and optionally `DAD_EMAIL` + `DAD_PASSWORD` for a read-only viewer) **before seeding** — the seed hashes them into the `User` table. Change the password later by re-seeding with a new value, or updating the `User.passwordHash`.
- `NEXTAUTH_SECRET` and `NEXTAUTH_URL` are required for login to work.

## Stack
Next.js 14 (App Router, TS) · Prisma · PostgreSQL · Resend (email, optional) · Square (payments) · Auth.js.

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

## Instant ACH (direct bank details) — how it works + compliance flags

Guests can enter routing/account numbers on the Finalize page ("⚡ Instant ACH").
**Square never sees these numbers** — its ACH rail only takes Plaid tokens. The site
stores an encrypted authorization (`AchAuthorization`), holds the dates, and emails
you to **originate the debit through the business bank**, then you *Record manual
payment (Bank debit)* on the booking to settle it. Requires `ACH_ENC_KEY`
(generate: `openssl rand -base64 32`) — without it the option simply doesn't show.

Data handling: full numbers exist only AES-256-GCM-encrypted at rest; the portal
shows last-4 everywhere; the one "Reveal for origination" button decrypts server-side,
owner-only, and logs every reveal to CommsLog; the calendar sweep purges encrypted
blobs 30 days after settlement (last4 + the signed authorization stay for the audit
trail). The consent tuple (exact text + timestamp + IP + user agent) is retained —
that's your proof under NACHA WEB-debit rules if a debit is disputed.

**⚠ Compliance flags (not legal advice):**
- **NACHA account validation:** first-use WEB debits require a "commercially
  reasonable" account-validation step — a self-attestation checkbox alone does not
  satisfy it. Cheapest compliant paths: originate through the bank's own portal (its
  validation applies) or add micro-deposit verification later.
- **Returned-payment (NSF) fee:** many states cap these by statute — Florida's
  service-fee statute caps below $55 for most amounts. Confirm the enforceable figure
  with your attorney; the amount is editable in **Settings → Payments** (no deploy).
- **Statement descriptor:** the guest notice says the charge appears as
  "Property Investment Group Services, Inc." — that descriptor is set by the
  originating bank account, so confirm it matches the entity on the account you
  debit from.
- Fully automating origination later requires a processor that accepts raw bank
  data via API (Dwolla / Modern Treasury tier — or Forte). Square will never take
  these numbers.

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
