import { prisma } from '@/lib/db';
import { loadPropertyPricing, computeQuote } from '@/lib/pricing';
import { splitEligible } from '@/lib/finalize';
import { addDays, toKey, todayKey } from '@/lib/dates';
import { squareConfigured, squareEnvironment } from '@/lib/square';
import { storedBaseTotal } from '@/lib/owner-pricing';
import { achConfigured } from '@/lib/ach';
import { TRANSFER_APPS, HOST_NAME, HOST_PHONE } from '@/lib/manual';
import { BookingStatus } from '@prisma/client';
import Link from 'next/link';
import FinalizeForm from './FinalizeForm';

const ACH_PCT = 1;

export const dynamic = 'force-dynamic';

const niceDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

export default async function FinalizePage({ params }: { params: { id: string } }) {
  const booking = await prisma.booking.findUnique({ where: { id: params.id }, include: { property: true, client: true } });
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
  const baseQuote = loaded ? computeQuote(loaded.pricing, { checkIn: ci, checkOut: co, guests: booking.guests, pet: booking.petFee > 0, method: 'ach' }) : null;
  const cardPct = loaded?.pricing.fees.cardPercent ?? 3;

  // Owner-adjusted price: show the STORED breakdown (incl. any discount) —
  // the same money the payment endpoints will charge.
  const custom = booking.priceCustom;
  const baseTotal = custom
    ? Math.round(storedBaseTotal(booking))
    : baseQuote?.ok ? baseQuote.total : Math.round(booking.total);
  const lines = custom
    ? [
        { label: `${Math.round(booking.subtotal / booking.nights)} avg × ${booking.nights} nights`, amount: booking.subtotal },
        ...(booking.discount > 0 ? [{ label: 'Discount', amount: -booking.discount }] : []),
        ...(booking.cleaningFee > 0 ? [{ label: 'Cleaning fee', amount: booking.cleaningFee }] : []),
        ...(booking.petFee > 0 ? [{ label: 'Pet fee', amount: booking.petFee }] : []),
        ...(booking.taxAmount > 0 ? [{ label: 'Tax', amount: booking.taxAmount }] : []),
      ]
    : baseQuote?.ok ? baseQuote.lines : [];
  const cardTotal = Math.round(baseTotal * (1 + cardPct / 100));
  const achTotal = Math.round(baseTotal * (1 + ACH_PCT / 100));

  return (
    <main className="wrap finalize" style={{ padding: '110px 0 80px' }}>
      <div className="fin-head"><span className="badge approved">✓ Approved</span><h1 className="lead" style={{ marginTop: 10 }}>Finalize your stay</h1>
        <div className="fin-ref">Reservation <b>{booking.reference}</b></div>
      </div>
      <div className="fin-grid">
        <aside className="fin-summary">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem' }}>{booking.property.name}</h3>
          <div style={{ color: 'var(--muted)', marginBottom: 16 }}>{niceDate(ci)} – {niceDate(co)} · {booking.nights} nights · {booking.guests} guests</div>
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
}
