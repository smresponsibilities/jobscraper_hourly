'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './ui-icon';
import { REPO_URL } from '@/lib/types';

export type WorkspaceView = 'jobs' | 'resume' | 'tracker' | 'journal' | 'audit' | 'outreach' | 'connect' | 'yc';

const views: Record<WorkspaceView, { section: string; title: string; description: string }> = {
  jobs: { section: 'Discover', title: 'Your next chapter\nstarts here.', description: 'Fresh opportunities. Direct from the companies you want to work with.' },
  tracker: { section: 'Your workspace', title: 'Small steps.\nMeaningful moves.', description: 'A clear view of every opportunity, from first save to the next conversation.' },
  resume: { section: 'Your workspace', title: 'Your story,\nbeautifully told.', description: 'Shape your experience into a résumé that feels unmistakably you.' },
  journal: { section: 'Your workspace', title: 'Good work deserves\nto be remembered.', description: 'A home for the wins, lessons, and little things that become your story.' },
  audit: { section: 'Your workspace', title: 'Make every\nword count.', description: 'Explore résumé feedback and see how your experience aligns with a role.' },
  outreach: { section: 'Make a connection', title: 'Great careers start\nwith a conversation.', description: 'Thoughtful outreach, useful context, and the right next introduction.' },
  connect: { section: 'Make a connection', title: 'Build your circle.\nOpen new doors.', description: 'Find people worth getting to know, one meaningful connection at a time.' },
  yc: { section: 'Discover', title: 'Small teams.\nBig possibilities.', description: 'Explore YC-backed companies in India and their roles in our catalogue.' },
};

interface Props {
  children: ReactNode;
  view: WorkspaceView;
  display: 'list' | 'map';
  onNavigate: (view: WorkspaceView, display?: 'list' | 'map') => void;
  onBackup: () => void;
  onRestore: () => void;
  counts: { open: number | null; matching: number; saved: number; applications: number; resumes: number; journal: number };
}

export function WorkspaceShell({ children, view, display, onNavigate, onBackup, onRestore, counts }: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [menuOpen, setMenuOpen] = useState(false);
  const [date, setDate] = useState('');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    setDate(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.querySelector<HTMLButtonElement>('.sidebar .nav-item[aria-current="page"]')?.focus();
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('keydown', close); document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus(); };
  }, [menuOpen]);

  function navigate(next: WorkspaceView, nextDisplay?: 'list' | 'map') {
    onNavigate(next, nextDisplay);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function changeTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event('jobradar-theme-change'));
    try { localStorage.setItem('jobradar-theme', next); } catch { /* The theme still works without browser storage. */ }
    setTheme(next);
  }
  function item(label: string, target: WorkspaceView, icon: IconName, badge?: number, targetDisplay?: 'list' | 'map') {
    const active = view === target && (target !== 'jobs' || display === (targetDisplay ?? 'list'));
    return <button type="button" className="nav-item" data-active={active} aria-current={active ? 'page' : undefined} onClick={() => navigate(target, targetDisplay)}>
      <Icon name={icon} size={19} /><span>{label}</span>{badge !== undefined && badge > 0 && <span className="nav-badge">{badge.toLocaleString('en-IN')}</span>}
    </button>;
  }
  const isMap = view === 'jobs' && display === 'map';
  const current = views[view];
  return <div className={`app-shell${menuOpen ? ' nav-open' : ''}`}>
    <a href="#workspace" className="skip-link">Skip to workspace</a>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className="sidebar" id="workspace-navigation" aria-label="Workspace navigation">
      <button type="button" className="brand" onClick={() => navigate('jobs', 'list')} aria-label="Job Radar home">
        <span className="brand-symbol"><Icon name="radar" size={26} /></span><span>jobradar<span className="brand-period">.</span></span>
      </button>
      <span className="brand-caption">A little direction. A lot of possibility.</span>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="nav-label">Discover</p>
          {item('Jobs', 'jobs', 'jobs', undefined, 'list')}
          {item('Office map', 'jobs', 'map', undefined, 'map')}
          {item('YC India', 'yc', 'compass')}
        </div>
        <div className="nav-group"><p className="nav-label">Your workspace</p>
          {item('Tracker', 'tracker', 'tracker', counts.applications)}
          {item('Resume Builder', 'resume', 'resume', counts.resumes)}
          {item('Journal', 'journal', 'journal')}
          {item('Fit Score', 'audit', 'score')}
        </div>
        <div className="nav-group"><p className="nav-label">Make a connection</p>
          {item('Outreach', 'outreach', 'send')}
          {item('LinkedIn', 'connect', 'people')}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="note-orbit" aria-hidden="true">✳</span><p>Your next move<br /><strong>is out there.</strong></p><span className="note-line" /></div>
        <div className="backup-actions"><button type="button" onClick={onBackup} title="Export résumés, applications, and journal"><Icon name="download" size={16} />Backup JSON</button><button type="button" onClick={onRestore} title="Restore a JSON backup"><Icon name="upload" size={16} />Restore</button></div>
        <p className="storage-note"><span />Career notes stay on this device.</p>
      </div>
    </aside>
    <div className="workspace" inert={menuOpen ? true : undefined}>
      <div className="workspace-topbar">
        <div className="topbar-location"><button type="button" className="icon-button mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} /></button><span>Personal workspace</span><span className="breadcrumb-divider">/</span><strong>{isMap ? 'Office map' : current.section}</strong></div>
        <div className="topbar-actions"><span className="workspace-date">{date}</span><button type="button" className="icon-button theme-toggle" onClick={changeTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} /></button><span className="workspace-avatar" aria-label="Personal career workspace">JR</span></div>
      </div>
      <main className="workspace-main" id="workspace" tabIndex={-1}>
        <header className="workspace-hero">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dash" />{isMap ? 'A new perspective' : view === 'jobs' ? 'Less searching. More possibility.' : current.section}</div><h1>{isMap ? 'Good places.\nGreat possibilities.' : current.title}</h1><p>{isMap ? 'Explore the companies behind the pins. Find a role, and a place, that feels right.' : current.description}</p></div>
          <div className="hero-art" aria-hidden="true"><div className="radar-art"><span className="radar-ring ring-one" /><span className="radar-ring ring-two" /><span className="radar-ring ring-three" /><span className="radar-cross cross-horizontal" /><span className="radar-cross cross-vertical" /><span className="radar-sweep" /><span className="radar-point point-one" /><span className="radar-point point-two" /><span className="radar-point point-three" /><span className="radar-centre"><Icon name={view === 'jobs' ? isMap ? 'pin' : 'arrow' : view === 'resume' ? 'resume' : view === 'tracker' ? 'tracker' : view === 'audit' ? 'score' : 'radar'} size={29} /></span></div><span className="art-caption">FIND YOUR KIND OF NEXT</span></div>
        </header>
        {view === 'jobs' && <section className="workspace-stats" aria-label="Your job search at a glance">
          <div className="stat-card"><span className="stat-label">Open opportunities<Icon name="jobs" size={17} /></span><strong>{counts.open === null ? '—' : counts.open.toLocaleString('en-IN')}</strong><span className="stat-detail"><span className="status-dot" />From company career boards</span></div>
          <div className="stat-card"><span className="stat-label">In your current search<Icon name="filter" size={17} /></span><strong>{counts.matching.toLocaleString('en-IN')}</strong><span className="stat-detail">Selected filters, your possibilities</span></div>
          <div className="stat-card"><span className="stat-label">Saved for later<Icon name="bookmark" size={17} /></span><strong>{counts.saved.toLocaleString('en-IN')}</strong><span className="stat-detail">Good finds worth coming back to</span></div>
          <div className="stat-card"><span className="stat-label">In your pipeline<Icon name="tracker" size={17} /></span><strong>{counts.applications.toLocaleString('en-IN')}</strong><span className="stat-detail">Your application tracker records</span></div>
        </section>}
        <div className={`career-workspace view-${view}`} key={view}>{children}</div>
        <footer className="workspace-footer"><span>Good things take a little curiosity.</span><a href={REPO_URL === '#' ? 'https://github.com/smresponsibilities/jobscraper_hourly' : REPO_URL} target="_blank" rel="noreferrer">Data & source<Icon name="arrow" size={14} /></a></footer>
      </main>
    </div>
  </div>;
}
