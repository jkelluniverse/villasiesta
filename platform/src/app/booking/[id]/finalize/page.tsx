import { tenantIdFromHeaders } from '@/lib/tenant';
import { withTenant, db } from '@/lib/dal';
import { loadPropertyPricing, computeQuote } from '@/lib/pricing';
import { splitEligible } from '@/lib/finalize';
import { addDays, toKey, todayKey } from '@/lib/dates';
import { squareConfigured, squareEnvironment, squareConfigProblem } from '@/lib/square';
import { chargeForBooking } from '@/lib/booking-pricing';
import { achConfigured } from '@/lib/ach';
import { TRANSFER_APPS, HOST_NAME, HOST_PHONE } from '@/lib/manual';
import { BookingStatus } from '@prisma/client';
import Link from 'next/link';
import FinalizeForm from './FinalizeForm';

const ACH_PCT = 1;

export const dynamic = 'force-dynamic';

const niceDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

export default async function FinalizePage({ params }: { params: { id: string } }) {
  return withTenant(await tenantIdFromHeaders(), async () => {
  const booking = await db().booking.findUnique({ where: { id: params.id }, include: { property: true, client: true } });
  if (!booking) return <main className="wrap" style={{ padding: '120px 0' }}><h1 className="lead">Booking not found</h1></main>;

  if (booking.status === BookingStatus.PAID || booking.status === BookingStatus.PARTIALLY_PAID) {
    return <main className="wrap" style={{ padding: '120px 0' }}><h1 className="lead">You&apos;re all set 🎉</h1><p style={{ color: 'var(--muted)' }}>This reservation is confirmed. <Link href={`/booking/${booking.id}`}>View your booking →</Link></p></main>;
  }
  if (booking.status !== BookingStatus.APPROVED) {
    return <main className="wrap" style={{ padding: '120px 0' }}><h1 className="lead">Not ready to finalize</h1><p style={{ color: 'var(--muted)' }}>This request hasn&apos;t been approved yet. <Link href={`/booking/${booking.id}`}>Check your status →</Link></p></main>;
  }

  const loaded = await loadPropertyPricing(booking.property.slug);
  const ci = toKey(booking.checkIn), co = toKey(booking.checkOut);
  const cur = booking.property.currency;
  const cardPct = loaded?.pricing.fees.cardPercent ?? 3;

  // The single resolver: owner-set price / comp-stay nights / fresh quote —
  // exactly the money the payment endpoints will charge.
  const charge = chargeForBooking(booking, loaded?.pricing ?? null);
  const baseTotal = charge.ok ? Math.round(charge.baseTotal) : Math.round(booking.total);
  const lines = charge.ok ? charge.lines : [];
  const cardTotal = Math.round(baseTotal * (1 + cardPct / 100));
  const achTotal = Math.round(baseTotal * (1 + ACH_PCT / 100));

  // Savings vs Airbnb (never shown for owner-adjusted prices — no base quote).
  const savingsQuote = !booking.priceCustom && loaded
    ? computeQuote(loaded.pricing, {
        checkIn: toKey(booking.stayCheckIn ?? booking.checkIn), checkOut: toKey(booking.stayCheckOut ?? booking.checkOut),
        guests: booking.guests, pet: booking.petFee > 0, method: 'ach', compNights: booking.compNights,
      })
    : null;
  const savings = savingsQuote?.ok ? savingsQuote.savings : null;
  const airbnbEstimate = savingsQuote?.ok ? savingsQuote.airbnbEstimate : null;
  const comp = booking.compNights > 0 && booking.stayCheckOut;

  return (
    <main className="wrap finalize" style={{ padding: '110px 0 80px' }}>
      <div className="fin-head"><span className="badge approved">✓ Approved</span><h1 className="lead" style={{ marginTop: 10 }}>Finalize your stay</h1>
        <div className="fin-ref">Reservation <b>{booking.reference}</b></div>
      </div>
      <div className="fin-grid">
        <aside className="fin-summary">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem' }}>{booking.property.name}</h3>
          <div style={{ color: 'var(--muted)', marginBottom: comp ? 6 : 16 }}>
            {comp
              ? <>Reservation {niceDate(ci)} – {niceDate(co)} (7 nights) · Your stay: {niceDate(toKey(booking.stayCheckIn!))} – {niceDate(toKey(booking.stayCheckOut!))} · {booking.guests} guests</>
              : <>{niceDate(ci)} – {niceDate(co)} · {booking.nights} nights · {booking.guests} guests</>}
          </div>
          {comp ? <div style={{ color: 'var(--muted)', fontSize: '.8rem', marginBottom: 14 }}>Booked as a full 7-night stay at a special rate — the extra nights are yours, use them or not.</div> : null}
          {savings && airbnbEstimate ? (
            <div className="save-chip">Estimated Airbnb total for these dates: ~{cur}{airbnbEstimate.toLocaleString()} — <b>you save ~{cur}{savings.toLocaleString()} booking direct.</b></div>
          ) : null}
          {lines.length ? (
            <div className="quote" style={{ marginTop: 0 }}>
              {lines.map((l, k) => (
                <div className="r" key={k}><span>{l.label.replace(/^(\d)/, (m0) => cur + m0)}</span><span className="tnum">{l.amount < 0 ? `−${cur}${Math.round(-l.amount).toLocaleString()}` : `${cur}${Math.round(l.amount).toLocaleString()}`}</span></div>
              ))}
              <div className="r total"><span>Total (transfer app · no fee)</span><b className="tnum">{cur}{baseTotal.toLocaleString()}</b></div>
              <div className="r hint">Processing fees, disclosed here and on your receipt: bank transfer +{ACH_PCT}% ({cur}{achTotal.toLocaleString()}), card +{cardPct}% ({cur}{cardTotal.toLocaleString()}). Zelle has no fee.</div>
            </div>
          ) : null}
        </aside>

        <section className="fin-pay">
          <FinalizeForm
            bookingId={booking.id}
            reference={booking.reference}
            lastName={booking.client.lastName}
            currency={cur}
            baseTotal={baseTotal}
            cardTotal={cardTotal}
            achTotal={achTotal}
            cardPct={cardPct}
            achPct={ACH_PCT}
            splitEligible={splitEligible(ci)}
            guestName={`${booking.client.firstName} ${booking.client.lastName}`.trim()}
            squareConfigured={squareConfigured()}
            squareBroken={!!squareConfigProblem()}
            squareEnv={squareEnvironment()}
            appId={process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID || ''}
            locationId={process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || ''}
            transferApps={TRANSFER_APPS}
            hostName={HOST_NAME}
            hostPhone={HOST_PHONE}
            todayKey={todayKey()}
            balanceDueKey={addDays(ci, -14)}
            nsfFee={booking.property.nsfFee}
            instantAchEnabled={achConfigured()}
          />
        </section>
      </div>
    </main>
  );
});
}
