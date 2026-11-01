'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui-icon';

export function OutreachFrame({ accessKey, kind, title }: { accessKey: string; kind: 'page' | 'connects'; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  function updateTheme() {
    try {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'light';
      if (!doc.querySelector('link[href="/outreach-theme.css"]')) {
        const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = '/outreach-theme.css'; doc.head.appendChild(link);
      }
    } catch { /* External compose pages own their own styling. */ }
  }
  useEffect(() => {
    window.addEventListener('jobradar-theme-change', updateTheme);
    return () => window.removeEventListener('jobradar-theme-change', updateTheme);
  }, []);
  useEffect(() => { setError(''); setLoading(true); }, [accessKey, attempt, kind]);
  function onLoad() {
    updateTheme(); setLoading(false);
    try {
      const doc = frame.current?.contentDocument;
      const text = doc?.body?.innerText.trim() ?? '';
      if (doc?.querySelector('h1')) return;
      if (/^forbidden/i.test(text)) setError('That access key was not accepted. Use Key above to try another.');
      else if (/not configured/i.test(text)) setError('This private workspace has not been connected yet. Your job search and career tools are still ready to use.');
      else if (/unauthorized|expired/i.test(text)) setError('The connection to your private workspace has expired. Its owner needs to reconnect it.');
      else if (/no batch published/i.test(text)) setError('There is no batch here yet. Build your first batch, then try again.');
      else if (/error|failed|unavailable/i.test(text.slice(0, 180))) setError('Your private workspace could not load. Please try again in a moment.');
    } catch { /* Navigation to a different origin is handled by the browser. */ }
  }
  return <>
    {loading && <div className="loading-state" role="status"><span className="loading-orbit" />Opening your private workspace…</div>}
    {error && <div className="private-empty" role="alert"><span className="private-empty-icon"><Icon name="lock" size={27} /></span><h2>A little connection needed.</h2><p>{error}</p><button type="button" className="chip" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
    <iframe ref={frame} src={'/api/outreach/' + kind + '?k=' + encodeURIComponent(accessKey) + '&attempt=' + attempt} title={title} className="outreach-frame" onLoad={onLoad} hidden={Boolean(error) || loading} />
  </>;
}
