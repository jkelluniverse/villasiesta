# Villa Siesta — Direct Booking Site

A direct-booking website for **Villa Siesta**, a 3BR / 2.5BA private-pool home in
downtown Sarasota, Florida (sleeps 6). Guests see live availability + seasonal
pricing, request dates, and — once the owner approves — get a total and payment
options. **No booking fees, no third party.**

The public site is a single static page you host on GoDaddy. The "admin" is a
**Google Sheet**, and the "API" is a **Google Apps Script Web App** that reads
that Sheet. There is no server to run and nothing to pay for beyond your domain.

```
  Guest browser ──JSONP GET──▶  Apps Script Web App ──reads──▶  Google Sheet (admin/db)
        │                              ▲   │                         ▲
        └────no-cors POST (request)────┘   └──hourly sync──▶ Airbnb .ics feed
                                            └──outbound .ics──▶ Airbnb (import)
```

---

## Files in this repo

| File | What it is |
|------|------------|
| `index.html` | The website. Same design/brand/photos/carousel as before — now wired to live data with a safe fallback. Host this on GoDaddy. |
| `api.js` | The data layer (JSONP + booking POST). The **single seam** to swap backends later. Host alongside `index.html`. |
| `apps-script/Code.gs` | The whole backend: availability/pricing/ical endpoints, booking intake, Airbnb sync, approvals, Stripe, and one-click sheet setup. |
| `apps-script/appsscript.json` | Apps Script manifest (timezone, Web App access, OAuth scopes). |
| `docs/GOOGLE_SHEET_TEMPLATE.md` | Exact tab/column layout and seed values for the admin Sheet. |

The site still works with **zero backend** — if `webAppUrl` is blank it runs
entirely on the `CONFIG` block at the top of `index.html`, exactly as before.
The backend just makes availability, prices, and fees **live and Sheet-editable.**

---

## Quick start (about 30 minutes)

### 1. Create the admin Sheet
1. Create a new Google Sheet named **"Villa Siesta Booking Engine."**
2. **Extensions → Apps Script.** Delete the starter code, paste in
   `apps-script/Code.gs`. (Optional but recommended: click the ⚙️ project
   settings, "Show appsscript.json", and paste in `apps-script/appsscript.json`.)
3. Back in the editor, run **`setupSheet`** once (choose it in the function
   dropdown → Run). Authorize when prompted. This creates all five tabs
   (Settings, Pricing, CustomDates, AirbnbBlocks, Bookings) with headers and
   sensible seed values. See `docs/GOOGLE_SHEET_TEMPLATE.md` for the layout.
4. In the **Settings** tab, fill in:
   - `notify_emails` → `jacob@nicecityhomes.com, DAD_EMAIL_HERE` (both get every request)
   - `airbnb_ical_url` → your Airbnb export URL (step 5 below; can add later)
   - `site_url` → your final domain (used for Stripe redirects; optional)

### 2. Deploy the Web App (the API)
1. In Apps Script: **Deploy → New deployment → Web app.**
2. **Execute as: Me** · **Who has access: Anyone.** Deploy, copy the
   **Web app URL** (ends in `/exec`).
3. Paste that URL in **two places** (keep them identical):
   - `index.html` → `CONFIG.webAppUrl`
   - `api.js` → `WEBAPP_URL` (optional; `CONFIG.webAppUrl` alone is enough)
4. Test in a browser: open `YOUR_EXEC_URL?route=ping` → you should see
   `{"ok":true,...}`. Try `?route=pricing` and `?route=availability` too.

> ⚠️ **Re-deploy after code changes.** Editing `Code.gs` does **not** update the
> live Web App until you **Deploy → Manage deployments → Edit → New version.**

### 3. Put the site online (GoDaddy)
Upload **`index.html`** and **`api.js`** to your GoDaddy hosting (same folder,
root). Point your domain (e.g. `villasiestasarasota.com`) at the hosting. Done —
the calendar now shows live availability and prices from your Sheet.

### 4. Turn on Airbnb two-way sync
- **Inbound (Airbnb → your site):** In Airbnb, Listing → Calendar → Availability
  → **Sync calendars → Export calendar**, copy the `.ics` URL into Settings
  `airbnb_ical_url`. Then in Apps Script run **`installSyncTrigger`** once (or
  use the *Villa Siesta ▸ Install hourly Airbnb sync* menu). It refreshes every
  hour.
- **Outbound (your site → Airbnb):** In Airbnb, **Sync calendars → Import
  calendar** and paste `YOUR_EXEC_URL?route=ical`. Airbnb will block the nights
  you've confirmed directly (and your blackout dates).

### 5. (Optional) Card payments with Stripe
1. In Apps Script: **Project Settings → Script Properties → Add property**
   `STRIPE_SECRET_KEY` = your Stripe secret key (`sk_live_…` or `sk_test_…`).
   *Never* put this in the Sheet or the site.
2. On approval, the guest's email will include a Stripe Checkout link for the
   card total (with the 3% fee already added). Without a key, the email just
   lists payment methods and asks the guest to reply for details.
   Alternatively, ignore the API and paste your own **Stripe Payment Link** into
   the approval reply per booking.

---

## Day-to-day: how the owner runs it

Everything is in the Sheet.

- **Change prices:** edit the `Pricing` tab (seasonal per-month) or add a
  `CustomDates` row of type `price` for a specific date range (e.g. holidays).
  A custom price wins over the seasonal rate.
- **Block dates:** add a `CustomDates` row of type `blackout`. (Airbnb bookings
  block automatically via the hourly sync.)
- **Raise the minimum for a range:** add a `CustomDates` row of type
  `min_nights`. (Overrides can only *raise* the minimum — the public 7-night
  floor is always enforced.)
- **Change fees / times / policy:** edit the `Settings` tab
  (`cleaning_fee`, `pet_fee`, `extra_guest_fee`, `tax_percent`, etc.).
- **Approve a booking:** open the `Bookings` tab, click the request row, then
  **Villa Siesta ▸ Approve selected booking** — or just type `approved` in that
  row's `status` cell. Either way the guest is emailed their total + payment
  options, and the dates flow into the outbound Airbnb calendar.

Requests arrive as email to **both** `notify_emails`, are logged to `Bookings`
with status `requested`, and the guest gets an automatic "request received" note.

---

## How it talks to the backend (the CORS story)

Apps Script Web App responses **cannot be read by a normal cross-origin
`fetch`.** So:

- **GET (availability, pricing):** the site uses **JSONP** — it loads
  `…?route=pricing&callback=fn` as a `<script>` and the Apps Script replies with
  `fn({…})`. Implemented in `api.js` → `jsonp()`; the script returns
  `ContentService` output with `MimeType.JAVASCRIPT`.
- **POST (booking request):** sent with **`mode:'no-cors'`**. The browser fires
  it but hides the response — that's fine, because the Apps Script logs the row
  and sends all emails server-side. The site optimistically shows "Request
  sent ✔".
- **`route=ical`** returns real `text/calendar` (no callback) so Airbnb can
  import it directly.

If the Web App is unreachable, `api.js` fails quietly and the page falls back to
the `CONFIG` values baked into `index.html` — **the page never breaks.**

---

## Pricing & fee logic (same on the site and in emails)

```
per night        = custom-date price override if present, else seasonal month rate
accommodation    = sum of per-night rates
stay total       = accommodation
                 + cleaning fee
                 + pet fee            (only if the guest opts in)
                 + extra-guest fee    (only for guests beyond extra_guest_after)
                 + tax%               (if set; applied to accommodation + fees)
                 + 3% card fee        (ONLY when the guest chooses to pay by card,
                                       shown at payment time — never on the public quote)
min / max nights = enforced, with per-range min_nights overrides (never below 7)
```

The public quote is an **estimate**; nothing is charged on the site. The final
total is confirmed by the owner at approval, and `Code.gs` recomputes it the same
way for the payment email.

---

## Double-booking safeguards

Airbnb gives individual hosts **no real-time API — only iCal feeds that refresh
every 1–3 hours.** There is always a short sync-lag window, so the site never
promises real-time sync. Instead it defends in depth:

1. **Server-side re-check** of availability in `doPost` when a request arrives,
   and again at approval — a taken range is flagged/refused.
2. **Hourly Airbnb inbound sync** (`syncAirbnb` trigger) + a manual
   *Sync Airbnb calendar now* menu item.
3. **Outbound `.ics`** so Airbnb blocks your confirmed direct bookings + blackouts.
4. **`booking_mode = request`** by default — the owner one-click approves, which
   is the safest model for a single owner-operator.
5. The calendar tells guests availability updates every few hours and is **final
   at approval.**

---

## Taxes — read this

Booking direct makes **you** responsible for collecting and remitting **Florida +
Sarasota County tourist/sales tax** (Airbnb currently does this for you on its
bookings). The `tax_percent` field in Settings adds the tax line to quotes and
emails, but **registration and remittance are your responsibility** — this site
does not file or pay anything. Consult the FL Dept. of Revenue and Sarasota
County Tax Collector.

## Minimum stay

The public minimum is **7 nights** (City of Sarasota short-term-rental rule) and
is always enforced. Custom `min_nights` rows may only raise it for a given range.

---

## Upgrade path (only if you outgrow this)

Google Sheets + Apps Script is perfect for one property at low volume, but it is
not concurrency-safe under heavy simultaneous load and has daily quotas
(Gmail ~100 emails/day — plenty here). If volume grows, the **same front-end**
can be repointed at a **Next.js + Supabase + Stripe** backend on Vercel for
real-time, atomic, concurrency-safe bookings. Because every data call goes
through **`api.js`**, that migration is just rewriting three methods there
(`endpoint()`, `load()`, `submitBooking()`) — the rest of the site is untouched.

---

## Build phases (what shipped)

- **Phase 1 — Live availability:** Sheet + `availability`/`pricing` endpoints;
  site reads them into the existing calendar. Requests log + email both. ✔
- **Phase 2 — Owner control:** `CustomDates` overrides (custom prices, blackouts,
  min-night overrides) + Settings fees flowing into the quote; approval workflow. ✔
- **Phase 3 — Sync:** hourly Airbnb inbound sync + outbound `.ics`; all safeguards. ✔
- **Phase 4 — Payments:** Stripe Checkout (or Payment Links) with the 3% card fee
  + cash options; payment-on-approval emails. ✔
- **Phase 5 — Polish:** graceful offline fallback + this README. ✔

## Out of scope

Single property only — no multi-property, guest login, or reviews. Not real-time
with Airbnb (iCal lag). Tax remittance is not automated (see above).

## What Jacob must provide

- Airbnb **export `.ics` URL** → Settings `airbnb_ical_url`.
- Dad's email → Settings `notify_emails`.
- (If using card) a **Stripe account** + secret key (or a Payment Link).
- Domain (e.g. `villasiestasarasota.com`) pointed at GoDaddy.
- After deploy: **import** the site's outbound `.ics` into Airbnb.
