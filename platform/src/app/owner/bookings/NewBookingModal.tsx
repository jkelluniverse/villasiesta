'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createManualBooking } from '../actions';

export default function NewBookingModal({ currency }: { currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState('2');
  const [priceMode, setPriceMode] = useState<'auto' | 'custom'>('auto');
  const [nightly, setNightly] = useState('');
  const [discount, setDiscount] = useState('');
  const [noCleaning, setNoCleaning] = useState(false);
  const [markPaid, setMarkPaid] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);

  const nights = checkIn && checkOut && checkIn < checkOut
    ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 864e5) : 0;

  const submit = () => {
    setErr('');
    start(async () => {
      const res = await createManualBooking({
        firstName, lastName, email, phone: phone || undefined,
        checkIn, checkOut, guests: parseInt(guests) || 1,
        nightly: priceMode === 'custom' && nightly !== '' ? parseFloat(nightly) : null,
        discount: parseFloat(discount) || 0,
        noCleaningFee: noCleaning,
        markPaid, sendEmail,
      });
      if (res.ok && res.bookingId) router.push(`/owner/bookings/${res.bookingId}`);
      else setErr(res.error || 'Could not create the booking.');
    });
  };

  return (
    <>
      <button className="op-btn op-btn-primary" onClick={() => setOpen(true)}>＋ New booking</button>
      {open ? (
        <div className="mp-overlay" onClick={() => !pending && setOpen(false)}>
          <div className="mp-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginBottom: 4 }}>New booking</h2>
            <div className="op-note" style={{ marginBottom: 12 }}>Book a guest directly — friends &amp; family, phone bookings, comps. Minimum-stay rules don&apos;t apply to you; availability does.</div>

            <div className="ae">
              <div className="ae-two">
                <div><label>First name</label><input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
                <div><label>Last name</label><input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
              </div>
              <div className="ae-two">
                <div><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div><label>Phone (optional)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
              <div className="ae-two">
                <div><label>Check-in</label><input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
                <div><label>Check-out</label><input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
              </div>
              <div className="ae-two">
                <div><label>Guests</label><input inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value.replace(/\D/g, ''))} /></div>
                <div><label>Nights</label><input readOnly value={nights ? String(nights) : '—'} tabIndex={-1} /></div>
              </div>

              <label style={{ marginTop: 16 }}>Pricing</label>
              <div className="pay-plan" style={{ marginBottom: 4 }}>
                <label className={priceMode === 'auto' ? 'on' : ''}><input type="radio" checked={priceMode === 'auto'} onChange={() => setPriceMode('auto')} /> Rate calendar (seasonal / custom prices)</label>
                <label className={priceMode === 'custom' ? 'on' : ''}><input type="radio" checked={priceMode === 'custom'} onChange={() => setPriceMode('custom')} /> Custom nightly rate</label>
              </div>
              <div className="ae-two">
                {priceMode === 'custom' ? (
                  <div><label>Nightly rate ({currency}/night)</label><input inputMode="decimal" value={nightly} onChange={(e) => setNightly(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0 for comp" /></div>
                ) : <div />}
                <div><label>Discount ({currency} off stay)</label><input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" /></div>
              </div>

              <label className="ae-check"><input type="checkbox" checked={noCleaning} onChange={(e) => setNoCleaning(e.target.checked)} /> Waive the cleaning fee</label>
              <label className="ae-check"><input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} /> Mark as paid now (comp or payment handled elsewhere) — locks the dates immediately</label>
              <label className="ae-check"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the guest ({markPaid ? 'booking confirmation' : 'a link to pay online'})</label>
            </div>

            {err ? <div className="op-note" style={{ color: 'var(--garnet)', marginTop: 10 }}>{err}</div> : null}
            <div className="bd-actions" style={{ marginTop: 16 }}>
              <button className="op-btn op-btn-primary" disabled={pending || !nights} onClick={submit}>{pending ? 'Creating…' : 'Create booking'}</button>
              <button className="op-btn op-btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
