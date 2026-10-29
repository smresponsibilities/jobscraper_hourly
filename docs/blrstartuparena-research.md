# How BLR Startup Arena's office map works

See [the current gap audit](office-map-gap-audit.md) for measured five-city
coverage, remaining behavior differences, and fresh REA comparison evidence.

Inspected with the local REA 6.7.0 CLI at `D:\REA`, using both static analysis
of publicly served JavaScript and owned Chromium scenarios. This corrects the
earlier interpretation: the reference maps employers' offices within a city,
not one aggregate marker at each city's centre.

## Observed data flow

1. The Next.js map response includes a company directory. Each record has
   `slug`, `name`, `latitude`, `longitude`, `officeName`, `locality`, `address`,
   `approximate`, `jobCount`, `fresherCount`, `facets` and `logoUrl`.
2. Leaflet creates a marker at each company's supplied coordinates. The
   `leaflet.markercluster` integration groups nearby companies with
   `maxClusterRadius: 36` and stops clustering at zoom 14. Cluster numbers count
   companies. Individual pins use logos or company initials.
3. Selecting a pin stores the company slug in the URL hash, moves the map to
   at least zoom 15 and opens that company's popup. The popup names the office
   and locality and shows role/fresher counts.
4. Area selection and search filter the company set. Area membership is
   calculated from proximity to predefined neighbourhood anchor coordinates,
   not fetched from an administrative-boundary service. Role-family, level,
   work-mode and fresher filters use the supplied company facets.
5. Opening PhonePe's roles issued
   `GET https://www.blrstartuparena.com/api/companies/phonepe/jobs`.
   The signed-out UI then showed a sign-in gate for role details and apply
   links. No authentication boundary was bypassed.
6. The captured map used Esri light-gray base/reference tiles, styled for its
   dark theme. A CARTO tile-proxy configuration also exists in the bundle;
   its presence does not prove it was used in this session.

## Location accuracy

The observed directory contained 746 companies, including 132 records marked
`approximate`. For these, the UI explicitly says the pin marks an area rather
than a building. For example, PhonePe's supplied point is associated with
Salarpuria Softzone, Wing A, Block A, Bellandur / Outer Ring Road.

The frontend consumes precomputed office coordinates. It contains no observed
client geocoding step that derives an office from a job's city string. The
backend's coordinate acquisition, verification, refresh process and complete
job-ingestion implementation are not established by this investigation.
An office pin also does not establish the exact worksite of every job there.

## Required correction in Job Radar

Keep our existing job ingestion and application URLs. Join our jobs to a
separate, sourced company-office directory for Bengaluru, Hyderabad, Pune,
Mumbai and Chennai. Use one city selector with company-office markers,
clustering, locality filters and a linked employer/job panel. Preserve source
and accuracy information. Missing office locations must remain unmapped,
rather than being replaced with city-centre coordinates.

The original five-city-centre prototype does not meet that office-map behavior.

## REA evidence

- Selected-office capture:
  `ev_a255e5def31700fae4e1a626630048c5ea1ad4d4b957cb3682dbf3f2ba7b6d5a`.
  Navigated to `/map#phonepe`; DOM, accessibility and screenshot were captured.
- Open-company-jobs capture:
  `ev_9d4b57622342e71b27f3d80d553551641c01dce98ca6125756366c4e191da488`.
  All four declared steps completed; the company-jobs request was observed.
- Focused JavaScript analysis:
  `ev_42ac5f264a9578fca0ef3de6537af0b39e07f3cc4c18d2e3fbc5f20de53b98ca`.
  Both selected files parsed, with zero parse failures or integrity
  contradictions. Static analysis alone does not prove runtime execution;
  the browser captures provide the complementary runtime evidence.

Both browser scenarios reported `terminated-owned-process` cleanup.

Public bundle identities:

- `1gcjtgamnmx7d.js`, map-screen logic, SHA-256
  `1ef88e54eb508ff369db788891aba8e0db02f699c24c528fb5e9463989570fe6`.
- `1h74og-1p51h5.js`, map runtime, SHA-256
  `14688f2fe712cd07f70107c19774bf73478e930845c8467a7c62d7f3bc92a2c7`.

The files were served beneath
`https://www.blrstartuparena.com/_next/static/immutable/chunks/`.
