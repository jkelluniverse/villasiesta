/* =============================================================================
 * Villa Siesta — Booking Engine (Google Apps Script backend)
 * =============================================================================
 * This one script is the whole API + Airbnb sync + owner tools. It reads and
 * writes a single Google Sheet ("Villa Siesta Booking Engine") whose tabs ARE
 * the admin panel: Settings, Pricing, CustomDates, AirbnbBlocks, Bookings.
 *
 * Endpoints (served by doGet, returned as JSONP so the static site can read them):
 *   ?route=availability  → blocked date ranges (bookings + blackouts + Airbnb)
 *   ?route=pricing       → seasonal rates, custom overrides, fees, min/max
 *   ?route=ical          → outbound .ics of confirmed bookings + blackouts (for Airbnb)
 *   ?route=ping          → {ok:true} health check
 * doPost(route=book)     → logs a request, re-checks availability, emails everyone.
 *
 * SETUP:  Extensions → Apps Script from your Sheet, paste this in, then run
 *         setupSheet() once (or use the "Villa Siesta" menu). Deploy → New
 *         deployment → Web app → Execute as: Me, Access: Anyone. See README.md.
 * ========================================================================== */

/* ------------------------------- constants -------------------------------- */
var TZ = 'America/New_York';
var TAB = {
  settings: 'Settings',
  pricing: 'Pricing',
  custom: 'CustomDates',
  airbnb: 'AirbnbBlocks',
  bookings: 'Bookings'
};
var BOOKING_HEADERS = ['received','first','last','email','phone','guests',
  'check_in','check_out','nights','quote','payment_method','status','notes'];
var BLOCKING_STATUSES = ['approved','paid'];   // which booking rows block dates

/* ------------------------------ web endpoints ----------------------------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var route = (p.route || '').toLowerCase();
  try {
    if (route === 'ical') {
      return ContentService.createTextOutput(outboundIcs_())
        .setMimeType(ContentService.MimeType.ICAL);
    }
    if (route === 'availability') return jsonp_(p.callback, availabilityPayload_());
    if (route === 'pricing')      return jsonp_(p.callback, pricingPayload_());
    if (route === 'ping')         return jsonp_(p.callback, { ok: true, ts: nowIso_() });
    return jsonp_(p.callback, { ok: true, service: 'Villa Siesta Booking Engine', routes: ['availability','pricing','ical','ping'] });
  } catch (err) {
    return jsonp_(p.callback, { error: String(err) });
  }
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  try {
    return jsonp_(p.callback, handleBooking_(p));
  } catch (err) {
    return jsonp_(p.callback, { ok: false, error: String(err) });
  }
}

/* Wrap any object as JSONP if a callback name was supplied, else plain JSON. */
function jsonp_(callback, obj) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ----------------------------- payload builders --------------------------- */
function pricingPayload_() {
  var s = getSettings_();
  var seasonal = getSeasonalRates_();
  var custom = getCustomDates_().filter(function (c) {
    return c.type === 'price' || c.type === 'min_nights';
  }).map(function (c) {
    return { start: c.start, end: c.end, type: c.type, value: c.value };
  });
  return {
    currency: s.currency || '$',
    seasonal: seasonal,
    custom: custom,
    cleaningFee: num_(s.cleaning_fee, 0),
    petFee: num_(s.pet_fee, 0),
    extraGuestFee: num_(s.extra_guest_fee, 0),
    extraGuestAfter: num_(s.extra_guest_after, 6),
    taxPercent: num_(s.tax_percent, 0),
    cardFeePercent: num_(s.card_fee_percent, 3),
    minNights: num_(s.min_nights, 7),
    maxNights: num_(s.max_nights, 20),
    rateRangeLabel: s.rate_range_label || rateRangeLabel_(seasonal),
    updated: nowIso_()
  };
}

function availabilityPayload_() {
  return { blocked: getBlockedRanges_(), updated: nowIso_() };
}

/* -------------------------- availability / blocking ----------------------- */
/* Every source of "unavailable" merged into {start,end,source} ranges.
   end = departure day (exclusive), matching the site's calendar expansion. */
function getBlockedRanges_() {
  var out = [];

  // 1) Confirmed direct bookings
  var b = sheet_(TAB.bookings);
  if (b && b.getLastRow() > 1) {
    var rows = b.getRange(2, 1, b.getLastRow() - 1, BOOKING_HEADERS.length).getValues();
    rows.forEach(function (r) {
      var rec = zip_(BOOKING_HEADERS, r);
      var status = String(rec.status || '').toLowerCase().trim();
      if (BLOCKING_STATUSES.indexOf(status) === -1) return;
      var ci = toKey_(rec.check_in), co = toKey_(rec.check_out);
      if (ci && co) out.push({ start: ci, end: co, source: 'booking' });
    });
  }

  // 2) Owner blackouts
  getCustomDates_().forEach(function (c) {
    if (c.type === 'blackout') out.push({ start: c.start, end: c.end, source: 'blackout' });
  });

  // 3) Airbnb-synced blocks
  var a = sheet_(TAB.airbnb);
  if (a && a.getLastRow() > 1) {
    var av = a.getRange(2, 1, a.getLastRow() - 1, 4).getValues();
    av.forEach(function (r) {
      var start = toKey_(r[0]), end = toKey_(r[1]);
      if (start && end) out.push({ start: start, end: end, source: 'airbnb' });
    });
  }
  return out;
}

/* Server-side re-check used before accepting/approving a booking. */
function isRangeAvailable_(ciKey, coKey) {
  if (!ciKey || !coKey || ciKey >= coKey) return false;
  var ranges = getBlockedRanges_();
  for (var i = 0; i < ranges.length; i++) {
    // overlap if start < existing.end AND end > existing.start
    if (ciKey < ranges[i].end && coKey > ranges[i].start) return false;
  }
  return true;
}

/* ------------------------------ booking intake ---------------------------- */
function handleBooking_(p) {
  var s = getSettings_();
  var ci = toKey_(p.checkin || p.check_in);
  var co = toKey_(p.checkout || p.check_out);
  if (!ci || !co) return { ok: false, error: 'Missing dates' };

  var nights = daysBetween_(ci, co);
  var available = isRangeAvailable_(ci, co);

  var pet = /^(1|true|yes|on)$/i.test(String(p.pet || ''));
  var q = computeQuote_(ci, co, num_(p.guests, 2), pet, 'ach');   // baseline (no card fee) estimate

  var row = {
    received: nowIso_(),
    first: p.first || '',
    last: p.last || '',
    email: p.email || '',
    phone: p.phone || '',
    guests: p.guests || '',
    check_in: ci,
    check_out: co,
    nights: nights,
    quote: p.quote || (q ? money_(s, q.total) : ''),
    payment_method: '',
    status: available ? 'requested' : 'conflict',
    notes: (pet ? '[pet] ' : '') + (available ? '' : 'AUTO: dates unavailable at submit. ') + (p.message || '')
  };
  appendBooking_(row);

  notifyOwners_(s, row, available, q);
  if (row.email) confirmGuest_(s, row, available);

  return { ok: true, status: row.status, nights: nights };
}

function appendBooking_(row) {
  var sh = ensureBookings_();
  sh.appendRow(BOOKING_HEADERS.map(function (h) { return row[h]; }));
}

/* --------------------------------- quote ---------------------------------- */
/* Mirrors the site's math so approval emails match what the guest saw. */
function computeQuote_(ciKey, coKey, guests, pet, method) {
  var s = getSettings_();
  var seasonal = getSeasonalRates_();
  var custom = getCustomDates_();
  var nights = daysBetween_(ciKey, coKey);
  if (nights <= 0) return null;

  var sub = 0, d = parseKey_(ciKey);
  for (var i = 0; i < nights; i++) {
    sub += nightlyRate_(d, seasonal, custom);
    d.setDate(d.getDate() + 1);
  }
  var lines = [];
  lines.push({ label: Math.round(sub / nights) + ' avg × ' + nights + ' nights', amount: sub });

  var total = sub;
  var clean = num_(s.cleaning_fee, 0);
  if (clean) { lines.push({ label: 'Cleaning fee', amount: clean }); total += clean; }

  if (pet) { var pf = num_(s.pet_fee, 0); if (pf) { lines.push({ label: 'Pet fee', amount: pf }); total += pf; } }

  var egf = num_(s.extra_guest_fee, 0), after = num_(s.extra_guest_after, 6);
  if (egf > 0 && guests > after) {
    var extra = guests - after, eg = extra * egf;
    lines.push({ label: 'Extra guest (' + extra + ' × ' + egf + ')', amount: eg });
    total += eg;
  }
  var taxPct = num_(s.tax_percent, 0);
  if (taxPct > 0) { var tax = Math.round(total * taxPct) / 100; lines.push({ label: 'Tax (' + taxPct + '%)', amount: tax }); total += tax; }

  var cardPct = num_(s.card_fee_percent, 3);
  if (method === 'card' && cardPct > 0) {
    var cf = Math.round(total * cardPct) / 100;
    lines.push({ label: 'Card processing (' + cardPct + '%)', amount: cf });
    total += cf;
  }
  total = Math.round(total);
  return { nights: nights, subtotal: sub, total: total, lines: lines };
}

function nightlyRate_(dateObj, seasonal, custom) {
  var key = Utilities.formatDate(dateObj, TZ, 'yyyy-MM-dd');
  for (var i = 0; i < custom.length; i++) {
    var c = custom[i];
    if (c.type === 'price' && key >= c.start && key < c.end) return Number(c.value);
  }
  return Number(seasonal[dateObj.getMonth() + 1] || 0);
}

/* ------------------------------ sheet readers ----------------------------- */
function getSettings_() {
  var sh = sheet_(TAB.settings);
  var out = {};
  if (!sh || sh.getLastRow() < 1) return out;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  vals.forEach(function (r) {
    var k = String(r[0] || '').trim();
    if (k && k.toLowerCase() !== 'key') out[k] = r[1];
  });
  return out;
}

function getSeasonalRates_() {
  var sh = sheet_(TAB.pricing);
  var rates = {};
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    vals.forEach(function (r) {
      var m = monthNum_(r[0]);
      if (m) rates[m] = Number(r[1]) || 0;
    });
  }
  // fill any missing months so the site never gets undefined
  for (var i = 1; i <= 12; i++) if (rates[i] == null) rates[i] = rates[i] || 0;
  return rates;
}

function getCustomDates_() {
  var sh = sheet_(TAB.custom);
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  vals.forEach(function (r) {
    var start = toKey_(r[0]), end = toKey_(r[1]);
    var type = String(r[2] || '').toLowerCase().trim();
    if (!start || !end || !type) return;
    out.push({ start: start, end: end, type: type, value: r[3], note: r[4] || '' });
  });
  return out;
}

/* --------------------------------- emails --------------------------------- */
function notifyOwners_(s, row, available, q) {
  var to = String(s.notify_emails || '').trim();
  if (!to) return;
  var name = s.property_name || 'Villa Siesta';
  var subject = (available ? 'New booking request' : '⚠ CONFLICT — booking request') +
    ' — ' + name + ' — ' + row.check_in + ' → ' + row.check_out;
  var body = [
    name + ' — booking request',
    available ? '' : '*** These dates looked UNAVAILABLE when submitted — check before approving. ***',
    '',
    'Guest:   ' + row.first + ' ' + row.last,
    'Email:   ' + row.email,
    'Phone:   ' + row.phone,
    'Guests:  ' + row.guests,
    'Dates:   ' + row.check_in + ' → ' + row.check_out + '  (' + row.nights + ' nights)',
    'Quote:   ' + row.quote,
    'Notes:   ' + row.notes,
    '',
    'To approve: open the Sheet, set this row\'s status to "approved" (or use the',
    'Villa Siesta ▸ Approve selected booking menu). That emails the guest their',
    'total + payment options, and adds the dates to the outbound Airbnb calendar.'
  ].join('\n');
  var opts = { name: name };
  if (row.email) opts.replyTo = row.email;
  MailApp.sendEmail(to.replace(/\s+/g, ''), subject, body, opts);
}

function confirmGuest_(s, row, available) {
  var name = s.property_name || 'Villa Siesta';
  var subject = 'We received your request — ' + name;
  var body = [
    'Hi ' + (row.first || 'there') + ',',
    '',
    'Thanks for your request to book ' + name + '.',
    'Dates: ' + row.check_in + ' → ' + row.check_out + '  (' + row.nights + ' nights)',
    'Estimated total: ' + row.quote,
    '',
    'Nothing has been charged. The owner will confirm availability and reply with',
    'your final total and payment options (ACH e-Check, card, or Zelle/Cash App/',
    'Venmo/Chime). Availability can take a few hours to settle and is final at',
    'approval.',
    '',
    available ? '' : 'Note: these dates may have just been taken — the owner will confirm.',
    '',
    '— ' + name
  ].join('\n');
  MailApp.sendEmail(row.email, subject, body, { name: name, replyTo: firstEmail_(s.notify_emails) });
}

/* Payment email on approval: total by method + Stripe link (if configured). */
function sendPaymentEmail_(s, row) {
  var pet = /\[pet\]/i.test(String(row.notes || ''));
  var guests = num_(row.guests, 2);
  var achQuote = computeQuote_(row.check_in, row.check_out, guests, pet, 'ach');
  var cardQuote = computeQuote_(row.check_in, row.check_out, guests, pet, 'card');
  if (!achQuote) return;

  var name = s.property_name || 'Villa Siesta';
  var cur = s.currency || '$';
  var lines = [
    'Hi ' + (row.first || 'there') + ',',
    '',
    'Good news — your dates at ' + name + ' are approved!',
    'Dates: ' + row.check_in + ' → ' + row.check_out + '  (' + row.nights + ' nights)',
    '',
    'Your total:',
    '  • ACH bank transfer (e-Check) — no fee: ' + cur + achQuote.total.toLocaleString(),
    '  • Zelle · Cash App · Venmo · Chime — no fee: ' + cur + achQuote.total.toLocaleString(),
    '  • Credit / Debit card (+' + num_(s.card_fee_percent, 3) + '%): ' + cur + cardQuote.total.toLocaleString(),
    ''
  ];

  var payUrl = '';
  try { payUrl = createStripeCheckout_(s, cardQuote.total, name + ' — ' + row.check_in + ' to ' + row.check_out, row.email); }
  catch (e) { payUrl = ''; }

  if (payUrl) {
    lines.push('Pay by card securely here (fee included):');
    lines.push('  ' + payUrl);
    lines.push('');
  }
  lines.push('For ACH or the cash apps, reply to this email and we\'ll send details.');
  lines.push('Check-in ' + (s.checkin_time || '4:00 PM') + ' · Check-out ' + (s.checkout_time || '10:00 AM') + '.');
  lines.push('Cancellation policy: ' + (s.cancellation_policy || 'Flexible') + '.');
  lines.push('');
  lines.push('— ' + name);

  MailApp.sendEmail(row.email, 'Your booking is approved — ' + name, lines.join('\n'),
    { name: name, replyTo: firstEmail_(s.notify_emails) });
}

/* ------------------------------- Stripe ----------------------------------- */
/* Creates a Checkout Session for the exact card total. Needs Script Property
   STRIPE_SECRET_KEY. Returns the hosted URL, or '' if not configured. */
function createStripeCheckout_(s, totalAmount, description, email) {
  var key = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!key) return '';
  var cur = (String(s.stripe_currency || 'usd')).toLowerCase();
  var successUrl = s.site_url || 'https://example.com';
  var payload = {
    'mode': 'payment',
    'success_url': successUrl + '?paid=1',
    'cancel_url': successUrl + '?paid=0',
    'line_items[0][price_data][currency]': cur,
    'line_items[0][price_data][product_data][name]': description,
    'line_items[0][price_data][unit_amount]': String(Math.round(totalAmount * 100)),
    'line_items[0][quantity]': '1'
  };
  if (email) payload['customer_email'] = email;
  var res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + key },
    payload: payload,
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText() || '{}');
  if (data && data.url) return data.url;
  Logger.log('Stripe error: ' + res.getContentText());
  return '';
}

/* ----------------------------- Airbnb sync -------------------------------- */
/* Time-driven trigger (hourly): pull the Airbnb .ics and rewrite AirbnbBlocks. */
function syncAirbnb() {
  var s = getSettings_();
  var url = String(s.airbnb_ical_url || '').trim();
  if (!url) return;
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    var events = parseIcs_(res.getContentText());
    var sh = ensureTab_(TAB.airbnb, ['start_date', 'end_date', 'summary', 'last_synced']);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
    var stamp = nowIso_();
    if (events.length) {
      sh.getRange(2, 1, events.length, 4).setValues(events.map(function (ev) {
        return [ev.start, ev.end, ev.summary || 'Airbnb', stamp];
      }));
    }
  } catch (err) {
    Logger.log('syncAirbnb failed: ' + err);
    var to = firstEmail_(s.notify_emails);
    if (to) MailApp.sendEmail(to, '⚠ Villa Siesta: Airbnb calendar sync failed',
      'The hourly Airbnb sync could not read the feed.\n\nURL: ' + url + '\nError: ' + err +
      '\n\nAvailability is still protected by request-mode approval, but re-check the feed URL in Settings.');
  }
}

/* Minimal robust VEVENT parser: DTSTART/DTEND (date form) + SUMMARY. */
function parseIcs_(text) {
  if (!text) return [];
  text = text.replace(/\r\n[ \t]/g, '');           // unfold folded lines
  var lines = text.split(/\r\n|\n|\r/);
  var events = [], cur = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') { if (cur && cur.start && cur.end) events.push(cur); cur = null; return; }
    if (!cur) return;
    var m = line.match(/^(DTSTART|DTEND|SUMMARY)([^:]*):(.+)$/);
    if (!m) return;
    var prop = m[1], val = m[3].trim();
    if (prop === 'SUMMARY') { cur.summary = val; return; }
    var dm = val.match(/(\d{4})(\d{2})(\d{2})/);
    if (!dm) return;
    var key = dm[1] + '-' + dm[2] + '-' + dm[3];
    if (prop === 'DTSTART') cur.start = key; else cur.end = key;
  });
  return events;
}

/* ------------------------- outbound iCal (for Airbnb) --------------------- */
function outboundIcs_() {
  var s = getSettings_();
  var name = s.property_name || 'Villa Siesta';
  var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Villa Siesta//Booking Engine//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd'T'HHmmss'Z'");

  getBlockedRanges_().forEach(function (r, i) {
    if (r.source === 'airbnb') return;   // don't echo Airbnb's own blocks back to it
    out.push('BEGIN:VEVENT');
    out.push('UID:vs-' + r.source + '-' + i + '-' + r.start + '@villasiesta');
    out.push('DTSTAMP:' + stamp);
    out.push('DTSTART;VALUE=DATE:' + r.start.replace(/-/g, ''));
    out.push('DTEND;VALUE=DATE:' + r.end.replace(/-/g, ''));
    out.push('SUMMARY:' + (r.source === 'booking' ? 'Booked (direct)' : 'Unavailable'));
    out.push('END:VEVENT');
  });
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

/* ------------------------------ owner tools ------------------------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Villa Siesta')
    .addItem('Set up / repair sheet tabs', 'setupSheet')
    .addSeparator()
    .addItem('Approve selected booking', 'approveSelectedBooking')
    .addItem('Sync Airbnb calendar now', 'syncAirbnb')
    .addItem('Install hourly Airbnb sync', 'installSyncTrigger')
    .addToUi();
}

/* Flip the selected Bookings row to "approved" and email the guest to pay. */
function approveSelectedBooking() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB.bookings);
  var ui = SpreadsheetApp.getUi();
  if (!sh || ss.getActiveSheet().getName() !== TAB.bookings) {
    ui.alert('Open the Bookings tab and click the row you want to approve first.'); return;
  }
  var r = sh.getActiveRange().getRow();
  if (r < 2) { ui.alert('Click a booking row (not the header).'); return; }
  var vals = sh.getRange(r, 1, 1, BOOKING_HEADERS.length).getValues()[0];
  var row = zip_(BOOKING_HEADERS, vals);
  row.check_in = toKey_(row.check_in); row.check_out = toKey_(row.check_out);

  if (!isRangeAvailable_(row.check_in, row.check_out)) {
    var go = ui.alert('Heads up', 'These dates now overlap another block. Approve anyway?', ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) return;
  }
  sh.getRange(r, BOOKING_HEADERS.indexOf('status') + 1).setValue('approved');
  var s = getSettings_();
  if (row.email) sendPaymentEmail_(s, row);
  ui.alert('Approved. Payment email sent to ' + (row.email || '(no email on file)') + '.');
}

/* onEdit: if the owner types "approved" into a status cell, send the pay email. */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== TAB.bookings) return;
    var col = e.range.getColumn(), r = e.range.getRow();
    if (r < 2 || col !== BOOKING_HEADERS.indexOf('status') + 1) return;
    if (String(e.value || '').toLowerCase().trim() !== 'approved') return;
    var vals = sh.getRange(r, 1, 1, BOOKING_HEADERS.length).getValues()[0];
    var row = zip_(BOOKING_HEADERS, vals);
    row.check_in = toKey_(row.check_in); row.check_out = toKey_(row.check_out);
    if (row.email) sendPaymentEmail_(getSettings_(), row);
  } catch (err) { Logger.log('onEdit: ' + err); }
}

function installSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAirbnb') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAirbnb').timeBased().everyHours(1).create();
  try { SpreadsheetApp.getUi().alert('Hourly Airbnb sync installed.'); } catch (e) {}
}

/* --------------------------- one-time sheet setup ------------------------- */
function setupSheet() {
  var settings = ensureTab_(TAB.settings, ['key', 'value']);
  seedIfEmpty_(settings, [
    ['property_name', 'Villa Siesta'],
    ['currency', '$'],
    ['min_nights', 7],
    ['max_nights', 20],
    ['checkin_time', '4:00 PM'],
    ['checkout_time', '10:00 AM'],
    ['cleaning_fee', 300],
    ['pet_fee', 250],
    ['extra_guest_fee', 0],
    ['extra_guest_after', 6],
    ['tax_percent', 0],
    ['card_fee_percent', 3],
    ['cancellation_policy', 'Flexible'],
    ['rate_range_label', '$275–$380'],
    ['notify_emails', 'jacob@nicecityhomes.com, DAD_EMAIL_HERE'],
    ['airbnb_ical_url', ''],
    ['booking_mode', 'request'],
    ['site_url', 'https://villasiestasarasota.com'],
    ['stripe_currency', 'usd']
  ]);

  var pricing = ensureTab_(TAB.pricing, ['month', 'nightly_rate']);
  seedIfEmpty_(pricing, [
    [1, 380], [2, 380], [3, 380], [4, 380], [5, 320], [6, 275],
    [7, 275], [8, 275], [9, 275], [10, 320], [11, 320], [12, 380]
  ]);

  ensureTab_(TAB.custom, ['start_date', 'end_date', 'type', 'value', 'note']);
  seedIfEmpty_(sheet_(TAB.custom), [
    ['2026-12-24', '2026-12-31', 'price', 450, 'Holiday week premium (example — edit or delete)']
  ]);

  ensureTab_(TAB.airbnb, ['start_date', 'end_date', 'summary', 'last_synced']);
  ensureBookings_();
  try { SpreadsheetApp.getUi().alert('Sheet ready. Fill in Settings (notify_emails, airbnb_ical_url), then deploy the Web App.'); } catch (e) {}
}

function ensureBookings_() { return ensureTab_(TAB.bookings, BOOKING_HEADERS); }

/* --------------------------------- helpers -------------------------------- */
function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function ensureTab_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  var need = headers.some(function (h, i) { return String(have[i] || '') !== h; });
  if (need) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function seedIfEmpty_(sh, rows) {
  if (!sh || sh.getLastRow() > 1 || !rows.length) return;
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function zip_(keys, vals) {
  var o = {}; keys.forEach(function (k, i) { o[k] = vals[i]; }); return o;
}

function num_(v, dflt) {
  if (v === '' || v == null) return dflt;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? dflt : n;
}

function firstEmail_(csv) { return String(csv || '').split(',')[0].trim(); }

function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }

/* Coerce a cell (Date object or string) to a 'yyyy-MM-dd' key. */
function toKey_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function parseKey_(key) { var p = key.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }

function daysBetween_(a, b) { return Math.round((parseKey_(b) - parseKey_(a)) / 86400000); }

function monthNum_(v) {
  if (v == null || v === '') return 0;
  var n = Number(v);
  if (n >= 1 && n <= 12) return n;
  var names = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var i = names.indexOf(String(v).toLowerCase().slice(0, 3));
  return i === -1 ? 0 : i + 1;
}

function rateRangeLabel_(seasonal) {
  var vals = Object.keys(seasonal).map(function (k) { return seasonal[k]; }).filter(function (n) { return n > 0; });
  if (!vals.length) return '';
  return '$' + Math.min.apply(null, vals) + '–$' + Math.max.apply(null, vals);
}

function money_(s, n) { return (s.currency || '$') + Number(n).toLocaleString(); }
