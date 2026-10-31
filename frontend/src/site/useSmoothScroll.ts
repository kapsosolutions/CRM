import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

/**
 * High-performance Lenis smooth scrolling hook for Landing, Login, and Register pages.
 * Delivers buttery smooth 60/120fps scrolling with zero lag and automatic cleanup.
 */
export function useSmoothScroll(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
      autoRaf: false,
    });

    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;

    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    // Smoothly scroll to in-page anchors (e.g. #pricing) without page jumping
    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;
      const href = target.getAttribute('href');
      // Only handle section anchors like #pricing, not client routes like #/login
      if (href && href.startsWith('#') && href.length > 2 && !href.startsWith('#/')) {
        const id = href.replace('#', '');
        const elem = document.getElementById(id);
        if (elem) {
          e.preventDefault();
          lenis.scrollTo(elem, { offset: -24, duration: 1.2 });
        }
      }
    };

    document.addEventListener('click', handleAnchorClick);

    // Smoothly scroll to initial anchor if loaded with #contact, #pricing, etc.
    const handleInitialHash = () => {
      const hash = window.location.hash;
      if (hash && hash.startsWith('#') && hash.length > 2 && !hash.startsWith('#/')) {
        const id = hash.replace('#', '');
        const elem = document.getElementById(id);
        if (elem) {
          lenis.scrollTo(elem, { offset: -24, duration: 1.2 });
        }
      }
    };
    const initialHashTimer = setTimeout(handleInitialHash, 150);

    return () => {
      clearTimeout(initialHashTimer);
      document.removeEventListener('click', handleAnchorClick);
      cancelAnimationFrame(rafId);
      lenis.destroy();
      delete (window as unknown as { __lenis?: Lenis }).__lenis;
    };
  }, [enabled]);
}
