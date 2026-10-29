'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { Job } from '@/lib/types';
import { JOB_CITIES, jobsByCity } from '@/lib/job-cities';
import { ROLE_FAMILIES, roleFamily } from '../../shared/role-family';
import { OFFICE_AREAS, officeArea } from '@/lib/office-areas';
import { officeGroups, parseOfficeDirectory, type OfficeCity, type OfficeDirectory, type OfficeGroup } from '@/lib/office-data';

export function JobMap({ jobs, query = '', onOpen }: { jobs: Job[]; query?: string; onOpen: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const [directory, setDirectory] = useState<OfficeDirectory | null>(null);
  const [directoryError, setDirectoryError] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [city, setCity] = useState<OfficeCity>('Bengaluru');
  const [areas, setAreas] = useState<string[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [entryOnly, setEntryOnly] = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [unmappedPage, setUnmappedPage] = useState(0);
  const engine = useRef<typeof Leaflet | null>(null);
  const clusters = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const [ready, setReady] = useState(false);
  const boundsKey = useRef('');
  const [selected, setSelected] = useState<string | null>(null);
  const selection = useRef(selected);
  selection.current = selected;
  const [unmappedOpen, setUnmappedOpen] = useState(false);
  const cities = useMemo(() => jobsByCity(jobs), [jobs]);
  const roleJobs = useMemo(() => jobs.filter(job => (!families.length || families.includes(roleFamily(job.title, job.industry) ?? 'other')) && (!entryOnly || job.isIntern || (job.minYears !== null && job.minYears <= 1))), [jobs, families, entryOnly]);
  const grouped = useMemo(() => officeGroups(roleJobs, directory?.offices ?? [], city), [roleJobs, directory, city]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => grouped.groups.map(group => ({ ...group, jobs: group.jobs.filter(job => !needle || `${job.title} ${job.company} ${job.location} ${group.office.officeName} ${group.office.locality} ${group.office.address} ${officeArea(group.office).name}`.toLowerCase().includes(needle)) }))
    .filter(group => group.jobs.length && (!areas.length || areas.includes(officeArea(group.office).id))), [grouped, areas, needle]);
  const unmapped = useMemo(() => grouped.unmapped.filter(job => !needle || `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(needle)), [grouped, needle]);
  const pageCount = Math.max(1, Math.ceil(visible.length / 20));
  const currentPage = Math.min(page, pageCount - 1);
  const active = visible.find(g => g.office.id === selected);
  const cityDefinition = JOB_CITIES.find(c => c.name === city)!;
  const cityJobs = cities.find(c => c.name === city)!.jobs;

  useEffect(() => {
    const abort = new AbortController();
    fetch('/data/offices.json', { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error('Office directory unavailable');
      return response.json();
    }).then(value => {
      const parsed = parseOfficeDirectory(value);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const savedAreas = hash.getAll('area');
      const office = parsed.offices.find(o => o.id === hash.get('office'));
      const savedCity = JOB_CITIES.find(c => c.name === hash.get('map-city'));
      if (office) { setCity(office.city); setSelected(office.id); }
      else if (savedCity) setCity(savedCity.name);
      const targetCity = office?.city ?? savedCity?.name ?? 'Bengaluru';
      setAreas(savedAreas.filter(id => OFFICE_AREAS[targetCity].some(a => a.id === id)));
      setFamilies(hash.getAll('map-role').filter(family => family === 'other' || Object.hasOwn(ROLE_FAMILIES, family)));
      setEntryOnly(hash.get('entry') === '1');
      setDirectory(parsed);
    }).catch(error => {
      if (error.name !== 'AbortError') setDirectoryError(true);
    });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let owned: Leaflet.Map | undefined;
    setMapError(false);
    if (!directory) return;
    import('leaflet').then(async module => {
      const L = module.default;
      await import('leaflet.markercluster');
      if (cancelled || !container.current) return;
      owned = L.map(container.current, { scrollWheelZoom: false, maxZoom: 18 }).setView([cityDefinition.lat, cityDefinition.lng], 11);
      map.current = owned;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18,
      }).on('tileerror', () => { if (!cancelled) setMapError(true); }).addTo(owned);
      engine.current = L;
      clusters.current = L.markerClusterGroup({ maxClusterRadius: 36, disableClusteringAtZoom: 14, showCoverageOnHover: false, animate: false }).addTo(owned);
      setReady(true);
    }).catch(error => { if (!cancelled) { console.error('Office map failed', error); setMapError(true); } });
    return () => { cancelled = true; owned?.remove(); markers.current.clear(); clusters.current = null; engine.current = null; setReady(false); if (map.current === owned) map.current = null; };
  }, [directory]);

  useEffect(() => {
    const L = engine.current, owned = map.current, layer = clusters.current;
    if (!ready || !L || !owned || !layer) return;
    layer.clearLayers();
    markers.current.clear();
      for (const group of visible) {
        const badge = document.createElement('span');
        badge.className = 'office-pin-label';
        badge.textContent = group.company.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
        if (group.office.logoUrl) {
          const logo = document.createElement('img');
          logo.alt = '';
          logo.src = group.office.logoUrl;
          logo.addEventListener('error', () => logo.remove(), { once: true });
          badge.append(logo);
        }
        const marker = L.marker([group.office.latitude, group.office.longitude], {
          title: `${group.company}: ${group.jobs.length} roles. ${group.office.officeName || group.office.locality}`,
          keyboard: true, riseOnHover: true,
          icon: L.divIcon({ className: 'job-office-pin', html: badge, iconSize: [38, 38], iconAnchor: [19, 19] }),
        });
        const popup = document.createElement('div');
        const heading = document.createElement('strong'); heading.textContent = group.company;
        const location = document.createElement('p'); location.textContent = group.office.officeName || group.office.address || group.office.locality;
        const button = document.createElement('button'); button.className = 'chip'; button.textContent = `View ${group.jobs.length} roles`;
        button.addEventListener('click', () => chooseOffice(group));
        popup.append(heading, location, button);
        marker.bindPopup(popup).on('click', () => chooseOffice(group));
        markers.current.set(group.office.id, marker);
        layer.addLayer(marker);
      }
      const key = `${city}:${[...areas].sort().join(',')}`;
      if (boundsKey.current !== key) {
        boundsKey.current = key;
        if (visible.length) owned.fitBounds(L.latLngBounds(visible.map(g => [g.office.latitude, g.office.longitude])), { padding: [30, 30], maxZoom: 13, animate: false });
        else owned.setView([cityDefinition.lat, cityDefinition.lng], 11, { animate: false });
      }
      if (selection.current) focusOffice(selection.current);
  }, [visible, ready, city, areas, cityDefinition]);

  useEffect(() => {
    if (selected) focusOffice(selected);
    else {
      map.current?.closePopup();
      for (const marker of markers.current.values()) marker.getElement()?.classList.remove('is-selected');
    }
  }, [selected]);

  useEffect(() => {
    if (!directory) return;
    const hash = new URLSearchParams({ 'map-city': city });
    if (selected) hash.set('office', selected);
    for (const area of areas) hash.append('area', area);
    for (const family of families) hash.append('map-role', family);
    if (entryOnly) hash.set('entry', '1');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${hash}`);
  }, [selected, city, areas, families, entryOnly, directory]);

  useEffect(() => {
    if (!directory) return;
    const restore = () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const office = directory.offices.find(o => o.id === hash.get('office'));
      const target = office?.city ?? JOB_CITIES.find(c => c.name === hash.get('map-city'))?.name ?? 'Bengaluru';
      setCity(target);
      setSelected(office?.id ?? null);
      setAreas(hash.getAll('area').filter(id => OFFICE_AREAS[target].some(a => a.id === id)));
      setFamilies(hash.getAll('map-role').filter(family => family === 'other' || Object.hasOwn(ROLE_FAMILIES, family)));
      setEntryOnly(hash.get('entry') === '1');
    };
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    return () => { window.removeEventListener('hashchange', restore); window.removeEventListener('popstate', restore); };
  }, [directory]);

  useEffect(() => { setPage(0); setUnmappedPage(0); }, [city, areas, needle, families, entryOnly]);

  useEffect(() => {
    if (selected && directory && !visible.some(group => group.office.id === selected)) setSelected(null);
  }, [selected, directory, visible]);

  function focusOffice(id: string) {
    const marker = markers.current.get(id);
    if (!marker || !map.current) return;
    map.current.setView(marker.getLatLng(), Math.max(map.current.getZoom(), 15), { animate: false });
    for (const [key, point] of markers.current) point.getElement()?.classList.toggle('is-selected', key === id);
    marker.openPopup();
  }

  function changeCity(name: OfficeCity) { remember(); setCity(name); setAreas([]); setSelected(null); setCompaniesOpen(true); setUnmappedOpen(false); }
  function remember() { window.history.pushState(null, '', window.location.href); }
  function chooseOffice(group: OfficeGroup) { remember(); setSelected(group.office.id); setUnmappedOpen(false); }
  function jobList(list: Job[]) {
    return <ul className="office-jobs">{list.map(job => <li key={job.id}>
      <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(job.id)}>{job.title}</a>
      <p>{job.company} · {job.location}</p>
      <small>{job.closedAt ? 'Closed' : job.isIntern ? 'Internship' : job.minYears === null ? 'Experience not stated' : `${job.minYears}+ years`}{job.salary ? ` · ${job.salary}` : ''}</small>
    </li>)}</ul>;
  }

  return <section className="job-map-section" aria-label="Company offices and jobs">
    <div className="job-map-heading"><h2>Explore company offices</h2><p>Our fetched jobs, mapped to sourced employer locations. Select a company to see its roles.</p></div>
    <div className="row job-map-cities" aria-label="Choose a city">
      {cities.map(c => <button key={c.name} className="chip" aria-pressed={city === c.name} data-on={city === c.name} onClick={() => changeCity(c.name)}>{c.name} <span>{c.jobs.length}</span></button>)}
    </div>
    <div className="row office-map-toolbar">
      <details className="office-area-picker"><summary>Areas · {areas.length || 'All'}</summary><fieldset><legend>Office neighbourhoods</legend>{OFFICE_AREAS[city].map(area => <label key={area.id}><input type="checkbox" checked={areas.includes(area.id)} onChange={() => { remember(); setAreas(current => current.includes(area.id) ? current.filter(id => id !== area.id) : [...current, area.id]); setSelected(null); }} />{area.name}</label>)}<button className="chip" onClick={() => { remember(); setAreas([]); }}>All areas</button></fieldset></details>
      <details className="office-area-picker"><summary>Role filters · {families.length + Number(entryOnly)}</summary><fieldset><legend>Role families</legend>{[...Object.keys(ROLE_FAMILIES), 'other'].map(family => <label key={family}><input type="checkbox" checked={families.includes(family)} onChange={() => { setFamilies(current => current.includes(family) ? current.filter(value => value !== family) : [...current, family]); setSelected(null); }} />{({ swe: 'Software and engineering', data: 'Data, ML and AI', finance: 'Finance and consulting', product: 'Product and programs', design: 'Design', security: 'Security', other: 'Other' } as Record<string, string>)[family]}</label>)}<label><input type="checkbox" checked={entryOnly} onChange={event => { setEntryOnly(event.target.checked); setSelected(null); }} />Internships and 0–1 years</label><button className="chip" onClick={() => { setFamilies([]); setEntryOnly(false); }}>Clear role filters</button></fieldset></details>
      <button className="chip" onClick={() => { if (visible.length && map.current) map.current.fitBounds(visible.map(g => [g.office.latitude, g.office.longitude]), { padding: [30, 30], maxZoom: 13 }); }}>Show city offices</button>
      <span className="office-map-summary" role="status">{visible.length} employers · {visible.reduce((sum, g) => sum + g.jobs.length, 0)} mapped roles</span>
      <button className="chip" aria-expanded={companiesOpen} aria-controls="office-company-panel" onClick={() => setCompaniesOpen(open => !open)}>{companiesOpen ? 'Hide employers' : 'Browse employers'}</button>
    </div>
    {directoryError && <p role="alert">Office locations could not load. Jobs remain available in List view.</p>}
    {!directory && !directoryError && <p role="status">Loading sourced office locations…</p>}
    <div className="job-map-layout">
      <div className="job-map-canvas" ref={container} role="region" aria-label={`Company offices in ${city}. Use the employer list as an alternative to map pins.`} />
      <div className="job-map-results" id="office-company-panel" data-open={!!active || companiesOpen}>
        <h3 aria-live="polite">{active?.company ?? `${city} offices`}<span>{active ? `${active.jobs.length} matching roles` : 'Select an employer pin or a company below'}</span></h3>
        {active ? <>
          <div className="office-details">
            <button className="chip" onClick={() => { remember(); setSelected(null); setCompaniesOpen(true); }}>All employers</button>
            <p><strong>{active.office.officeName || active.company}</strong><br />{active.office.address || active.office.locality}</p>
            <p>{active.office.approximate ? 'Approximate area / mapped feature centre.' : 'Source-listed company office.'} Confirm the worksite in the job posting.</p>
            <a href={active.office.source} target="_blank" rel="noopener noreferrer">Location source</a>
          </div>
          {jobList(active.jobs)}
        </> : <>
          <ul className="office-employers">{visible.slice(currentPage * 20, (currentPage + 1) * 20).map(group => <li key={group.office.id}><button onClick={() => chooseOffice(group)}>
            <strong>{group.company}</strong><span>{group.office.locality || group.office.officeName || 'Source-listed office'}</span><small>{group.jobs.length} roles{group.office.approximate ? ' · Approximate location' : ''}</small>
          </button></li>)}</ul>
          {pageCount > 1 && <nav className="row" aria-label="Company pages"><button className="chip" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pageCount}</span><button className="chip" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
          {directory && !visible.length && <p className="empty">No sourced employer locations match this city and these filters.</p>}
        </>}
        {!!unmapped.length && <details className="office-unmapped" open={unmappedOpen} onToggle={event => setUnmappedOpen(event.currentTarget.open)}><summary>{unmapped.length} roles without a sourced office</summary>{jobList(unmapped.slice(unmappedPage * 20, (unmappedPage + 1) * 20))}{unmapped.length > 20 && <nav className="row" aria-label="Unmapped job pages"><button className="chip" disabled={!unmappedPage} onClick={() => setUnmappedPage(unmappedPage - 1)}>Previous</button><span>{unmappedPage + 1} / {Math.ceil(unmapped.length / 20)}</span><button className="chip" disabled={(unmappedPage + 1) * 20 >= unmapped.length} onClick={() => setUnmappedPage(unmappedPage + 1)}>Next</button></nav>}</details>}
      </div>
    </div>
    {mapError && <p role="status">Map unavailable. Employer selection and original job links still work.</p>}
    <p className="job-map-note">{cityJobs.length} matching roles in {city}. Company offices are not confirmation of a role’s exact worksite. Locations: BLR Startup Arena and OpenStreetMap contributors. Remote-only and unknown-city roles remain in List view.</p>
  </section>;
}
