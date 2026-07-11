'use client';
import { useEffect, useState } from 'react';

export default function NavBar() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 60);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav${solid ? ' solid' : ''}`}>
      <div className="wrap">
        <a className="wordmark" href="#top"><span className="vs sm">VS</span> Villa Siesta</a>
        <div className="links">
          <a href="#gallery">Photos</a>
          <a href="#stay">The stay</a>
          <a href="#book">Availability</a>
          <a href="#location">Location</a>
        </div>
      </div>
    </nav>
  );
}
