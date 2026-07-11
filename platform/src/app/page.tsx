import NavBar from '@/components/NavBar';
import Gallery from '@/components/Gallery';
import BookingWidget from '@/components/BookingWidget';
import photos from '../../prisma/photos.json';

const ABOUT_IMG = photos[17]?.file || photos[0].file;

const AMENITIES = [
  ['Private pool', 'Heated, screened lanai'],
  ['Sleeps 6', '3 bedrooms · 2.5 baths'],
  ['Full kitchen', 'Everything to cook in'],
  ['Downtown Sarasota', 'Walk to dining & bay'],
  ['Fast Wi-Fi', 'Work-from-anywhere ready'],
  ['Pets welcome', 'With a small pet fee'],
];

export default function Home() {
  return (
    <main id="top">
      <NavBar />

      <header className="hero">
        <div className="wrap">
          <div className="place">Downtown Sarasota, Florida</div>
          <h1>Villa Siesta</h1>
          <p className="sub">A brand-new private-pool home in downtown Sarasota. Book direct — skip the fees.</p>
          <div className="cta">
            <a href="#book" className="btn btn-navy">Check availability</a>
          </div>
        </div>
      </header>

      <div className="savings">
        Book direct and <b>save the booking fees</b> — same home, better rate, straight from the owner.
      </div>

      <section className="wrap">
        <div className="section-head"><div className="eyebrow">The home</div><div className="divider" /><h2 className="lead">What&apos;s inside</h2></div>
        <div className="amen" style={{ marginTop: 28 }}>
          {AMENITIES.map(([t, s]) => (
            <div className="cell" key={t}><b>{t}</b><span>{s}</span></div>
          ))}
        </div>
      </section>

      <section className="wrap" id="gallery" style={{ paddingTop: 0 }}>
        <div className="section-head"><div className="eyebrow">Photo tour</div><div className="divider" /><h2 className="lead">Every room, in order</h2></div>
        <div style={{ marginTop: 24 }}>
          <Gallery photos={photos} />
        </div>
      </section>

      <section className="about" id="stay">
        <div className="wrap grid">
          <div>
            <div className="eyebrow" style={{ color: '#fff', opacity: .8 }}>The stay</div>
            <div className="divider" style={{ background: '#fff' }} />
            <h2 className="lead">Room to breathe, steps from downtown</h2>
            <p style={{ color: 'rgba(255,255,255,.85)', maxWidth: '46ch', marginTop: 12 }}>
              A brand-new three-bedroom home built for a relaxed Sarasota stay — a private heated pool,
              a full kitchen, and space for six, minutes from downtown dining, St. Armands, and the beaches.
            </p>
          </div>
          <div>
            <img src={ABOUT_IMG} alt="Villa Siesta" />
            <div className="facts" style={{ marginTop: 18 }}>
              <div className="row"><span>Nightly rate</span><b>$275–$380 · seasonal</b></div>
              <div className="row"><span>Cleaning fee</span><b>$300</b></div>
              <div className="row"><span>Minimum stay</span><b>7 nights</b></div>
              <div className="row"><span>Sleeps</span><b>6 guests</b></div>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" id="book">
        <div className="section-head"><div className="eyebrow">Availability</div><div className="divider" /><h2 className="lead">Find your dates</h2>
          <p style={{ color: 'var(--muted)', maxWidth: '52ch', marginTop: 8 }}>Pick a check-in, then a check-out. Crossed-out days are taken and rates shift by season — your total updates as you choose. Send a request and you&apos;ll get your total and payment details to lock it in.</p>
        </div>
        <BookingWidget />
      </section>

      <section className="wrap" id="location">
        <div className="section-head"><div className="eyebrow">Where you&apos;ll be</div><div className="divider" /><h2 className="lead">Downtown Sarasota</h2></div>
        <div className="mapbox" style={{ position: 'relative', borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', minHeight: 360, marginTop: 24 }}>
          <iframe title="Approximate location — Sarasota" src="https://maps.google.com/maps?q=27.328640,-82.521981&z=14&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" style={{ width: '100%', height: 380, border: 0, display: 'block' }} />
          <div aria-hidden style={{ position: 'absolute', top: '50%', left: '50%', width: '42%', paddingTop: '42%', transform: 'translate(-50%,-58%)', borderRadius: '50%', background: 'rgba(33,54,119,.14)', border: '2px solid rgba(33,54,119,.5)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, background: 'rgba(255,255,255,.94)', color: 'var(--ink)', fontSize: '.78rem', padding: '9px 12px', borderRadius: 'var(--r)', pointerEvents: 'none' }}>
            📍 <b style={{ color: 'var(--navy)' }}>Approximate area.</b> The exact address is shared privately once your booking is confirmed.
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap">
          <div className="wordmark" style={{ fontFamily: 'var(--font-display)', letterSpacing: '.3em', textTransform: 'uppercase' }}>Villa Siesta</div>
          <div className="fine">
            Book direct · Downtown Sarasota, Florida.<br />
            Rates and availability shown here are confirmed by the owner at booking. © {new Date().getFullYear()} Villa Siesta · Sarasota, FL.
          </div>
        </div>
      </footer>
    </main>
  );
}
