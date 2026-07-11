'use client';
import { useEffect, useRef, useState } from 'react';

export type GalleryPhoto = { file: string; label: string; sublabel?: string };

export default function Gallery({ photos }: { photos: GalleryPhoto[] }) {
  const [i, setI] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);

  const n = photos.length;
  const go = (next: number) => setI(((next % n) + n) % n);

  // Center the active thumbnail within the strip only — never scroll the page.
  useEffect(() => {
    const strip = thumbsRef.current;
    const el = strip?.children[i] as HTMLElement | undefined;
    if (strip && el && !firstPaint.current) {
      const target = strip.scrollLeft + el.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - el.clientWidth) / 2;
      strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
    firstPaint.current = false;
  }, [i]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(false);
      if (e.key === 'ArrowLeft') go(i - 1);
      if (e.key === 'ArrowRight') go(i + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = photos[i];
  const cap = `${g.label}${g.sublabel ? ' · ' + g.sublabel : ''}  (${i + 1} / ${n})`;

  return (
    <div>
      <div className="stage">
        <button className="arrow left" aria-label="Previous photo" onClick={() => go(i - 1)}>‹</button>
        <img src={g.file} alt={g.label} onClick={() => setLightbox(true)} style={{ cursor: 'zoom-in' }} />
        <button className="arrow right" aria-label="Next photo" onClick={() => go(i + 1)}>›</button>
        <span className="counter tnum">{i + 1} / {n}</span>
      </div>
      <div className="capbar">
        <span className="cap-label">{g.label}</span>
        <span className="cap-sub">{g.sublabel || ''}</span>
      </div>
      <div className="thumbs" ref={thumbsRef}>
        {photos.map((p, k) => (
          <img key={p.file} src={p.file} alt={p.label} loading="lazy"
            className={k === i ? 'active' : ''} onClick={() => go(k)} />
        ))}
      </div>

      <div className={`lightbox${lightbox ? ' open' : ''}`} onClick={(e) => { if ((e.target as HTMLElement).classList.contains('lightbox')) setLightbox(false); }}>
        <button className="lb-close" aria-label="Close" onClick={() => setLightbox(false)}>×</button>
        <button className="lb-arrow left" aria-label="Previous" onClick={() => go(i - 1)}>‹</button>
        <img src={g.file} alt={g.label} />
        <button className="lb-arrow right" aria-label="Next" onClick={() => go(i + 1)}>›</button>
        <span className="counter tnum" style={{ bottom: 24 }}>{cap}</span>
      </div>
    </div>
  );
}
