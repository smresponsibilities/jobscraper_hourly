'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const openDialogs: HTMLElement[] = [];
let previousOverflow = '';

/** Shared dialog behavior for the résumé, journal, and application tools. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const fieldPrefix = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !panel.current) return;
    const element = panel.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!openDialogs.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(element);
    element.querySelectorAll<HTMLLabelElement>('label').forEach((label, index) => {
      const input = label.nextElementSibling;
      if (label.control || !input || !input.matches('input,select,textarea')) return;
      if (!input.id) input.id = fieldPrefix + '-field-' + index;
      label.htmlFor = input.id;
    });
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')).filter(item => item.getClientRects().length);
    (focusable()[0] ?? element).focus();
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== element) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); element.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const index = openDialogs.indexOf(element);
      if (index !== -1) openDialogs.splice(index, 1);
      if (!openDialogs.length) document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mounted, fieldPrefix]);
  if (!mounted) return null;
  return createPortal(<div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}>
    <section className="dialog-card" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={panel}>{children}</section>
  </div>, document.body);
}
