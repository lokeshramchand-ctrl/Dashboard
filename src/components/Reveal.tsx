import { Fragment, useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/** Flags `data-in-view` once on viewport entry; `.cc-reveal` descendants then play (see styles.css). */
export function InView({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { node.setAttribute('data-in-view', ''); io.disconnect(); }
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`cc-reveal-group ${className}`}>{children}</div>;
}

/** Per-word clip-and-rise entrance, the site's headline treatment. */
export function RevealWords({ text, step = 0 }: { text: string; step?: number }) {
  const words = text.split(' ');
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="cc-reveal cc-reveal-rise cc-reveal-fine" style={{ '--cc-stagger': i + step } as CSSProperties}>{w}</span>
          {i < words.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </>
  );
}

/** Fade-up block; `stagger` offsets it inside a shared group. */
export function Reveal({ children, stagger = 0, className = '' }: { children: ReactNode; stagger?: number; className?: string }) {
  return <div className={`cc-reveal cc-reveal-fade-up ${className}`} style={{ '--cc-stagger': stagger } as CSSProperties}>{children}</div>;
}
