import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { RefObject } from 'react';

gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Page / panel enter — optional stagger via CSS selector */
export function usePageEnter(
  scopeRef: RefObject<HTMLElement | null>,
  selector?: string,
  deps: unknown[] = [],
) {
  useGSAP(
    () => {
      const root = scopeRef.current;
      if (!root || reducedMotion()) return;
      const targets = selector ? root.querySelectorAll(selector) : root;
      if (selector && targets instanceof NodeList && targets.length === 0) return;
      gsap.fromTo(
        targets,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out', stagger: selector ? 0.05 : 0 },
      );
    },
    { scope: scopeRef, dependencies: deps },
  );
}

export function useFadeIn(scopeRef: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const el = scopeRef.current;
      if (!el || reducedMotion()) return;
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: 'power2.out' });
    },
    { scope: scopeRef },
  );
}
