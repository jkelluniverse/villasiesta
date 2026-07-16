/**
 * lib/emails.ts — Villa Siesta branded email templates
 * ---------------------------------------------------------------------------
 * One base layout + every transactional email. Email-client-safe:
 *  - table layout, fully inline styles (Gmail strips <style> and classes)
 *  - Georgia serif for display type (webfonts don't load in Gmail/Outlook;
 *    Georgia is the closest universal cousin of the site's Cormorant)
 *  - brand tokens: navy #213677 · deep #182A5E · cream #FBF7F0 · line #EAE3D6
 * Each function returns { subject, html, text }. Send via Resend.
 * ---------------------------------------------------------------------------
 */

const NAVY = "#213677", DEEP = "#182A5E", CREAM = "#FBF7F0", LINE = "#EAE3D6",
      INK = "#20242C", INK2 = "#726A5C";
const SITE = process.env.APP_URL || "https://villasiestasarasota.com";

const fmtUSD = (n: number) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ---------------------------------------------------------------- base layout
function layout(opts: {
  preheader: string;           // hidden inbox preview line
  badge?: { label: string; bg: string; ink: string };
  title: string;               // serif headline
  bodyHtml: string;            // content rows (use helpers below)
  cta?: { label: string; url: string };
  footNote?: string;
}) {
  const badge = opts.badge
    ? `<tr><td style="padding:0 40px;">
         <span style="display:inline-block;background:${opts.badge.bg};color:${opts.badge.ink};
           font:600 12px/1 Arial,sans-serif;letter-spacing:.04em;border-radius:999px;padding:7px 14px;">
           ${opts.badge.label}</span></td></tr>
       <tr><td style="height:14px;"></td></tr>`
    : "";
  const cta = opts.cta
    ? `<tr><td style="padding:8px 40px 0;">
         <a href="${opts.cta.url}"
            style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;
              font:600 13px/1 Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;
              padding:15px 28px;border-radius:8px;">${opts.cta.label}</a></td></tr>
       <tr><td style="height:8px;"></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${CREAM};">
<div style="display:none;max-height:0;overflow:hidden;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0"
         style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
    <!-- brand bar -->
    <tr><td style="background:${NAVY};padding:22px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${DEEP};width:40px;height:40px;text-align:center;vertical-align:middle;
                   font:500 18px Georgia,serif;color:#ffffff;border-radius:4px;">VS</td>
        <td style="padding-left:14px;font:500 17px Georgia,serif;color:#ffffff;letter-spacing:.28em;">VILLA&nbsp;SIESTA</td>
      </tr></table>
    </td></tr>
    <tr><td style="height:30px;"></td></tr>
    ${badge}
    <tr><td style="padding:0 40px;font:600 27px/1.2 Georgia,serif;color:${INK};">${opts.title}</td></tr>
    <tr><td style="height:14px;"></td></tr>
    ${opts.bodyHtml}
    ${cta}
    <tr><td style="height:30px;"></td></tr>
    <!-- footer -->
    <tr><td style="background:${NAVY};padding:22px 40px;">
      <div style="font:500 15px Georgia,serif;color:#ffffff;">villasiestasarasota.com</div>
      <div style="font:400 11px Arial,sans-serif;color:#cfd6ea;padding-top:5px;">
        Book direct · No booking fees · Downtown Sarasota, Florida
        ${opts.footNote ? `<br>${opts.footNote}` : ""}</div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

// ------------------------------------------------------------- body helpers
const para = (t: string) =>
  `<tr><td style="padding:0 40px;font:400 14.5px/1.65 Arial,sans-serif;color:${INK2};">${t}</td></tr>
   <tr><td style="height:16px;"></td></tr>`;

function detailCard(rows: [string, string][]) {
  const trs = rows.map(([k, v], i) =>
    `<tr>
       <td style="padding:10px 18px;font:600 11px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;
                  color:${INK2};${i ? `border-top:1px solid ${LINE};` : ""}">${k}</td>
       <td align="right" style="padding:10px 18px;font:500 14px Arial,sans-serif;color:${INK};
                  ${i ? `border-top:1px solid ${LINE};` : ""}">${v}</td>
     </tr>`).join("");
  return `<tr><td style="padding:0 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:${CREAM};border:1px solid ${LINE};border-radius:10px;">${trs}</table>
  </td></tr><tr><td style="height:16px;"></td></tr>`;
}

// =================================================================== GUEST
type B = {  // minimal booking shape the templates need
  id: string; reference?: string; firstName: string; checkIn: Date | string; checkOut: Date | string;
  nights: number; guests: number; total: number;
  depositAmount?: number | null; balanceAmount?: number | null; balanceDueDate?: Date | string | null;
};

/** A "Reference" row for the top of any detail card (omitted if absent). */
const refRow = (b: B): [string, string][] => (b.reference ? [['Reference', b.reference]] : []);

export function requestReceived(b: B) {
  const subject = "We got your Villa Siesta request";
  const html = layout({
    preheader: "Nothing has been charged — the owner replies within 24–48 hours.",
    badge: { label: "● Awaiting review", bg: "#F6EEDA", ink: "#8A6B1E" },
    title: `Your request is in, ${b.firstName}.`,
    bodyHtml:
      para(`We've sent it to the owner. You'll get an email the moment it's approved — <b style="color:${INK}">nothing has been charged.</b> The owner typically responds within 24–48 hours.`) +
      detailCard([
        ...refRow(b),
        ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
        ["Nights", String(b.nights)], ["Guests", String(b.guests)],
        ["Estimated total", fmtUSD(b.total)],
      ]),
    cta: { label: "View your request", url: `${SITE}/booking/${b.id}` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

export function approvedFinalize(b: B) {
  const subject = "Approved — finalize your Villa Siesta stay";
  const html = layout({
    preheader: "Your dates are being held. Complete payment to confirm.",
    badge: { label: "✓ Approved", bg: "#E7F1EB", ink: "#2C6E52" },
    title: "Good news — your dates are yours to take.",
    bodyHtml:
      para(`The owner approved your request and is holding your dates. Complete payment to confirm your reservation.`) +
      detailCard([
        ...refRow(b),
        ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
        ["Total", fmtUSD(b.total)],
      ]),
    cta: { label: "Finalize your booking", url: `${SITE}/booking/${b.id}` },
    footNote: "Pay by bank transfer (no fee) or card (+3%).",
  });
  return { subject, html, text: textFallback(subject, b) };
}

export function depositReceipt(b: B) {
  const subject = "Deposit received — your dates are secured";
  const html = layout({
    preheader: "Your balance will be charged automatically before arrival.",
    badge: { label: "● Secured", bg: "#E9EDF7", ink: NAVY },
    title: `Thank you, ${b.firstName} — you're booked.`,
    bodyHtml:
      para(`Your deposit is in and your dates are secured. The remaining balance will be charged automatically to your saved card.`) +
      detailCard([
        ...refRow(b),
        ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
        ["Deposit paid", fmtUSD(b.depositAmount ?? b.total / 2)],
        ["Balance", fmtUSD(b.balanceAmount ?? b.total / 2)],
        ["Balance charge date", b.balanceDueDate ? fmtDate(b.balanceDueDate) : "14 days before check-in"],
      ]),
    cta: { label: "View your booking", url: `${SITE}/booking/${b.id}` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

export function paidConfirmation(b: B) {
  const subject = "Confirmed — your Villa Siesta stay";
  const html = layout({
    preheader: "Payment received. We'll send arrival details before check-in.",
    badge: { label: "● Confirmed", bg: "#E9EDF7", ink: NAVY },
    title: "You're all set. See you in Sarasota.",
    bodyHtml:
      para(`Payment received — your reservation is confirmed. We'll email your arrival details (door code, Wi-Fi, directions) before check-in.`) +
      detailCard([
        ...refRow(b),
        ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
        ["Guests", String(b.guests)],
        ["Paid", fmtUSD(b.total)],
      ]),
    cta: { label: "View your booking", url: `${SITE}/booking/${b.id}` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

export function balanceReminder(b: B) {
  const subject = "Heads-up — your balance is charged in 3 days";
  const html = layout({
    preheader: "No action needed; your saved card will be charged automatically.",
    title: "A quick heads-up before your balance.",
    bodyHtml:
      para(`On <b style="color:${INK}">${b.balanceDueDate ? fmtDate(b.balanceDueDate) : "the scheduled date"}</b> we'll automatically charge your saved card <b style="color:${INK}">${fmtUSD(b.balanceAmount ?? 0)}</b> — the remaining balance for your stay. No action needed.`),
    cta: { label: "View your booking", url: `${SITE}/booking/${b.id}` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

/** THE ARRIVAL EMAIL — one-click from the portal (Airbnb-style pre-arrival). */
export function arrivalInfo(b: B, p: {
  address: string; doorCode: string; wifiName: string; wifiPassword: string;
  checkinTime: string; checkoutTime: string; rules: string[]; hostPhone: string;
  parking?: string; extraNotes?: string;
}) {
  const subject = `Your arrival details — Villa Siesta, ${fmtDate(b.checkIn)}`;
  const rules = p.rules.map(r =>
    `<div style="padding:4px 0;font:400 14px/1.6 Arial,sans-serif;color:${INK2};">•&nbsp; ${r}</div>`).join("");
  const html = layout({
    preheader: "Door code, Wi-Fi, directions, and house rules for your stay.",
    badge: { label: "🏝 Arrival details", bg: "#E9EDF7", ink: NAVY },
    title: `Almost time, ${b.firstName} — here's everything you need.`,
    bodyHtml:
      detailCard([
        ...refRow(b),
        ["Check-in", `${fmtDate(b.checkIn)} · after ${p.checkinTime}`],
        ["Check-out", `${fmtDate(b.checkOut)} · by ${p.checkoutTime}`],
        ["Address", p.address],
        ["Door code", `<b style="font-size:16px;letter-spacing:.06em;">${p.doorCode}</b>`],
        ["Wi-Fi", `${p.wifiName} · ${p.wifiPassword}`],
        ...(p.parking ? [["Parking", p.parking] as [string, string]] : []),
      ]) +
      `<tr><td style="padding:0 40px;font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${INK2};">House rules</td></tr>
       <tr><td style="height:6px;"></td></tr>
       <tr><td style="padding:0 40px;">${rules}</td></tr>
       <tr><td style="height:16px;"></td></tr>` +
      (p.extraNotes ? para(p.extraNotes) : "") +
      para(`Questions on the road? Call or text the owner directly at <b style="color:${INK}">${p.hostPhone}</b>.`),
    footNote: "Please keep this email handy for check-in.",
  });
  return { subject, html, text:
`Arrival details — Villa Siesta
Check-in ${fmtDate(b.checkIn)} after ${p.checkinTime} · Check-out ${fmtDate(b.checkOut)} by ${p.checkoutTime}
Address: ${p.address}
Door code: ${p.doorCode}
Wi-Fi: ${p.wifiName} / ${p.wifiPassword}
${p.parking ? "Parking: " + p.parking + "\n" : ""}Rules: ${p.rules.join("; ")}
Owner: ${p.hostPhone}` };
}

export function declined(b: B) {
  const subject = "About your Villa Siesta request";
  const html = layout({
    preheader: "Unfortunately those dates didn't work out.",
    title: "Those dates didn't work out — we're sorry.",
    bodyHtml:
      para(`Unfortunately the owner couldn't approve ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}. Nothing was charged. The calendar shows everything that's open — we'd love to host you on other dates.`),
    cta: { label: "See open dates", url: `${SITE}/#book` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

// =================================================================== OWNER
export function ownerNewRequest(b: B & { lastName: string; email: string; phone?: string; message?: string }) {
  const subject = `New booking request${b.reference ? ` [${b.reference}]` : ""} — ${b.firstName} ${b.lastName} — ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`;
  const html = layout({
    preheader: `${b.nights} nights · ${b.guests} guests · est. ${fmtUSD(b.total)}`,
    badge: { label: "● Needs review", bg: "#F6EEDA", ink: "#8A6B1E" },
    title: `${b.firstName} ${b.lastName} wants to book.`,
    bodyHtml:
      detailCard([
        ...refRow(b),
        ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · ${b.nights} nt`],
        ["Guests", String(b.guests)], ["Est. total", fmtUSD(b.total)],
        ["Email", b.email], ["Phone", b.phone || "—"],
      ]) + (b.message ? para(`<b style="color:${INK}">Message:</b> ${b.message}`) : ""),
    cta: { label: "Review in the portal", url: `${SITE}/owner` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

export function ownerPaymentAlert(b: B & { lastName: string }, kind: "deposit" | "balance" | "full") {
  const label = kind === "deposit" ? "Deposit received" : kind === "balance" ? "Balance received" : "Paid in full";
  const subject = `${label}${b.reference ? ` [${b.reference}]` : ""} — ${b.firstName} ${b.lastName} — ${fmtUSD(kind === "deposit" ? (b.depositAmount ?? 0) : kind === "balance" ? (b.balanceAmount ?? 0) : b.total)}`;
  const html = layout({
    preheader: `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`,
    badge: { label: `✓ ${label}`, bg: "#E7F1EB", ink: "#2C6E52" },
    title: `${label} for ${b.firstName}'s stay.`,
    bodyHtml: detailCard([
      ...refRow(b),
      ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
      ["Booking total", fmtUSD(b.total)],
    ]),
    cta: { label: "Open the booking", url: `${SITE}/owner` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

/** Guest pressed "I've sent it" by a transfer app — owner + dad must verify receipt. */
export function ownerManualClaim(b: B & { lastName: string }, opts: { app: string; amount: number }) {
  const subject = `Manual payment claimed — verify${b.reference ? ` [${b.reference}]` : ""} — ${b.firstName} ${b.lastName} — ${opts.app} ${fmtUSD(opts.amount)}`;
  const html = layout({
    preheader: `${b.firstName} ${b.lastName} says they sent ${fmtUSD(opts.amount)} by ${opts.app}. Confirm receipt, then record it.`,
    badge: { label: "● Verify receipt", bg: "#F6EEDA", ink: "#8A6B1E" },
    title: `${b.firstName} says they paid by ${opts.app}.`,
    bodyHtml:
      para(`Check your <b style="color:${INK}">${opts.app}</b> for <b style="color:${INK}">${fmtUSD(opts.amount)}</b> with this reservation in the memo. Once you see it, open the booking and <b style="color:${INK}">Record manual payment</b> — nothing is marked paid until you do.`) +
      detailCard([
        ...refRow(b),
        ["Guest", `${b.firstName} ${b.lastName}`],
        ["Claimed via", opts.app],
        ["Amount", fmtUSD(opts.amount)],
        ["Dates", `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
      ]),
    cta: { label: "Verify & record in the portal", url: `${SITE}/owner` },
  });
  return { subject, html, text: textFallback(subject, b) };
}

// ------------------------------------------------------------------ text
function textFallback(subject: string, b: B) {
  return `${subject}\nDates: ${fmtDate(b.checkIn)} -> ${fmtDate(b.checkOut)} (${b.nights} nights, ${b.guests} guests)\nTotal: ${fmtUSD(b.total)}\nDetails: ${SITE}/booking/${b.id}\n— Villa Siesta · villasiestasarasota.com`;
}
