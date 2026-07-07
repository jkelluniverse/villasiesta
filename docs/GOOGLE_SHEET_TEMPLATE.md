# Google Sheet template — "Villa Siesta Booking Engine"

Running `setupSheet()` (Apps Script, or the *Villa Siesta ▸ Set up / repair sheet
tabs* menu) creates all of this automatically. This doc is the reference for what
each tab holds and how the owner edits it. **The Sheet is the admin panel and the
database — there is no separate dashboard.**

A date is **unavailable** if it falls in any `Bookings` row that is
`approved`/`paid`, any `CustomDates` `blackout`, or any `AirbnbBlocks` row. All
date ranges use `end_date` = **departure/checkout day (exclusive)** — the same
convention as the site calendar.

---

## Tab: `Settings`  (key / value)

| key | example | meaning |
|-----|---------|---------|
| `property_name` | Villa Siesta | shown in emails |
| `currency` | `$` | currency symbol |
| `min_nights` | `7` | public minimum stay (legal floor — do not lower) |
| `max_nights` | `20` | maximum stay before "contact owner" |
| `checkin_time` | `4:00 PM` | shown in approval email |
| `checkout_time` | `10:00 AM` | shown in approval email |
| `cleaning_fee` | `300` | per stay |
| `pet_fee` | `250` | per stay, applied only if guest opts in |
| `extra_guest_fee` | `0` | per extra guest, per stay (`0` = off) |
| `extra_guest_after` | `6` | charge extra-guest fee beyond this many guests |
| `tax_percent` | `0` | FL + Sarasota tourist/sales tax % (you remit — see README) |
| `card_fee_percent` | `3` | added only when guest pays by card |
| `cancellation_policy` | `Flexible` | shown in approval email |
| `rate_range_label` | `$275–$380` | the "seasonal" label on the site |
| `notify_emails` | `jacob@nicecityhomes.com, dad@example.com` | **both** emailed on every request |
| `airbnb_ical_url` | `https://www.airbnb.com/calendar/ical/....ics` | Airbnb export feed |
| `booking_mode` | `request` | `request` (owner approves) or `instant` |
| `site_url` | `https://villasiestasarasota.com` | Stripe success/cancel redirect |
| `stripe_currency` | `usd` | Stripe Checkout currency |

## Tab: `Pricing`  (seasonal defaults)

| month | nightly_rate |
|-------|--------------|
| 1–4 | 380 |
| 5 | 320 |
| 6–9 | 275 |
| 10–11 | 320 |
| 12 | 380 |

`month` may be a number (`1`–`12`) or a name (`Jan`, `January`). One row per
month.

## Tab: `CustomDates`  (owner overrides + blackouts)

| start_date | end_date | type | value | note |
|------------|----------|------|-------|------|
| 2026-12-24 | 2026-12-31 | `price` | 450 | holiday premium |
| 2026-08-10 | 2026-08-14 | `blackout` | | owner staying |
| 2026-02-01 | 2026-03-01 | `min_nights` | 14 | peak-season minimum |

- `price` → overrides the seasonal nightly rate for that range (wins over Pricing).
- `blackout` → marks the range unavailable.
- `min_nights` → raises the minimum stay for that range (can only raise, never
  below the legal 7).

## Tab: `AirbnbBlocks`  (auto — do not edit)

| start_date | end_date | summary | last_synced |
|------------|----------|---------|-------------|

Rewritten every hour by `syncAirbnb()` from the Airbnb `.ics` feed.

## Tab: `Bookings`  (the log — append-only)

| received | first | last | email | phone | guests | check_in | check_out | nights | quote | payment_method | status | notes |
|----------|-------|------|-------|-------|--------|----------|-----------|--------|-------|----------------|--------|-------|

- Requests append here automatically with `status = requested` (or `conflict` if
  the dates looked taken at submit time).
- Set `status` to **`approved`** (menu or type it) → guest is emailed the total +
  payment options, and the dates join the outbound Airbnb calendar.
- `approved` and `paid` rows block their dates everywhere.
- `[pet]` in `notes` means the guest opted into the pet fee.
