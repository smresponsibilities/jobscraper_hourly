# Office-map comparison, 2026-10-29

## Implementation follow-up

The audit below records the initial baseline. Since that baseline, the shared
implementation gained multi-area coordinate grouping, office-aware search,
shared role-family filters, an explicit internships/0–1-years filter, company
and unmapped-role pagination, map history synchronization, persistent cluster
layers, source logo pins, a larger map and optional floating employer panel,
and a weekly refresh workflow. The importer no longer depends on the current
job catalogue and no longer carries special-case employer aliases. It reads
bulk source directories; new employers can join automatically when jobs arrive.

The validated saved-source import retained 746 Bengaluru, 905 Hyderabad,
571 Pune, 656 Mumbai and 503 Chennai office records. These are source records,
not counts of mapped eligible employers. A generic office record may never
match our job catalogue. Live Overpass refresh returned HTTP 502 during a later
attempt; the last valid directory was preserved. Saved source inputs supplied
the reproducible bulk-import check.

The reference's confirmed framework is Next.js/React, Leaflet and
leaflet.markercluster, with a server-prepared company directory and lazy
company-job API. Its coordinate-acquisition backend remains unknown. No
frontend framework can supply missing verified office coordinates by itself.

Compared Job Radar against https://www.blrstartuparena.com/map using the local
REA CLI at `D:\REA`. This is an audit, not an implementation change.

## Findings in priority order

| Priority | Remaining gap | How the reference does it | Smallest fitting change here |
| --- | --- | --- | --- |
| 1 | Office coverage is sparse, especially outside Bengaluru. | Its server-rendered payload supplies 746 companies with precomputed office coordinates, names, localities, accuracy flags, logos and job facets. The backend sourcing process is unknown. | Extend the separate sourced office directory, prioritizing employers with the most unmapped roles. Keep source URLs and accuracy flags. Add explicit reviewed employer aliases only where identity is established. Never infer an office from a city name. |
| 1 | Neighbourhood selection contains duplicate spellings and compound locality strings; only one can be selected. | Ten predefined area anchors. Each company is assigned to the closest anchor using squared latitude distance plus squared longitude distance scaled by 0.97. The area control accepts multiple selections. | Add a small per-city area-anchor table and calculate area membership from office coordinates. Keep the original source locality for display. Use stable area IDs and multi-selection. These are browsing groups, not verified administrative boundaries. |
| 1 | Searching an area does not search office metadata. | Search matches company name, locality and office name, then intersects area and role filters. | Add office-aware search in the map's grouping/filter layer. The existing global search only checks job title, company and job location, so applying it first would discard office-only matches. Preserve title search deliberately. |
| 2 | No role-family or seniority multi-select in the map. | A filter sheet exposes level, work mode and role family. OR within each group, AND across groups. Company facets select eligible employers; fetched job fields filter displayed roles. A separate Freshers toggle uses `fresherCount` and `fresherFriendly`. | Reuse existing work-mode, experience and internship filters. Reuse the existing role classification logic where suitable; the web package currently has no role-family field. Do not equate industry with role family or claim exact equivalence to their fresher classifier. |
| 2 | Company browsing can render every employer and every expanded unmapped role at once. | Separate company List view uses responsive cards and pagination: five rows, one to four columns. Selecting a company opens its roles. Jobs load on demand from `/api/companies/{slug}/jobs`. | Bound company and unmapped-role lists with pagination. Keep the current downloaded catalogue; a new API is unnecessary for this architecture. Our existing main List view lists jobs rather than companies. |
| 2 | Back/forward navigation and area bookmarks are incomplete. | Company selection reads the hash, subscribes to `hashchange`, and updates the hash on selection. | Our map reads the hash only on mount and writes with `replaceState`; it does not subscribe to history changes. Add history synchronization if company navigation should support Back. Persist city/area selections deliberately. The reference's area filters are local state, so area bookmarks would improve on it. |
| 2 | Map rebuilding loses viewport continuity when filters change. | The reference separates the dynamically loaded Leaflet renderer from filter state and selected-company state. | Our map creation effect depends on the filtered office groups, removes the map, and recreates it. Update its existing cluster layer instead of recreating the map. Preserve viewport unless the user selects a city, area, office, or reset action. |
| 2 | Office refresh is manual and deployed directory can become stale. | Current office coordinates are delivered with its map payload. Refresh cadence and source validation are not visible. | Connect the existing atomic office-directory command to an appropriate refresh workflow with failure reporting. Job refreshes currently do not refresh office data. Retain the last valid directory on failure. |
| 3 | Visual presentation differs substantially. | Full-screen dark map, floating compact toolbar, Esri gray base/reference tiles, company logos with initials fallback, and a selected-company overlay. The captured map also exposes a location control. | Give map mode more screen space, consolidate controls and use sourced logos with initials fallback. Choose tile styling and attribution deliberately. Our current split panel and OpenStreetMap tiles are functional but do not reproduce the reference layout. |

## Measured coverage

Counts below use the local preview catalogue's open jobs, before optional user
filters. Multi-city postings can appear in more than one row. These are not
live production counts or a direct comparison with the reference's different
job eligibility rules. Directory timestamp: `2026-10-29T04:27:59.604Z`.

| City | Directory offices | Employers with jobs | Mapped employers | Mapped roles | Unmapped roles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bengaluru | 242 | 523 | 192 | 964 | 1,668 |
| Hyderabad | 11 | 173 | 7 | 28 | 719 |
| Pune | 10 | 215 | 7 | 32 | 857 |
| Mumbai | 6 | 154 | 2 | 29 | 654 |
| Chennai | 4 | 125 | 1 | 1 | 601 |

Useful candidates for sourced location research include ExxonMobil and HPE in
Bengaluru, Amgen and Qualcomm in Hyderabad, Citi and Eaton in Pune, Citi and
Deutsche Bank in Mumbai, and Citi in Chennai. Employer eligibility must still
follow this project's existing exclusions. Unmapped counts do not establish
that every listed employer belongs in the catalogue.

## Already implemented

Company-office coordinates, Leaflet clustering with radius 36 and disabling
clustering at zoom 14, selection zoom to at least 15, linked employer jobs,
original application URLs, accuracy/source labels, city selection, basic
locality filtering, office bookmarks, keyboard alternatives, mobile layout,
tile-failure fallback and malformed-directory handling are present. Previous
production browser checks passed these behaviors.

Our five-city scope extends beyond the observed Bengaluru reference. Missing
office coverage in the other cities needs separate sources; it cannot be
recovered from a Bengaluru-only map.

## Evidence and limits

- Fresh reference map capture:
  `ev_41a893899673a9c78a71afe7a086a9f24fe597bdf9411fddd4369255ef4c50f1`.
  DOM, accessibility, screenshot and network captured. Visible status:
  746 companies and 9,452 open roles.
- REA filter interaction:
  `ev_c0202f8850d8752020533cbdbc80ea8dc35828a4b7d9fcd07f74556225102f6b`.
  Declared click opened Filters; accessibility captured Level, Work mode,
  Role type, Clear all and Show 746 companies. All declared steps completed.
- Both owned browser captures reported `terminated-owned-process` cleanup.
- Re-fetched public bundles `1gcjtgamnmx7d.js` and `1h74og-1p51h5.js`
  exactly match the hashes in `blrstartuparena-research.md`. The previously
  recorded REA static analysis therefore applies to the same shipped bytes.
- Static code establishes the area assignment formula, filter predicates,
  pagination, logo fallback and history listener. It does not prove that every
  branch executed in this capture.
- The signed-out company-jobs flow and its sign-in boundary were captured in
  the earlier research. No authenticated matching or paid workflow was tested.
- Coordinate acquisition, backend verification, refresh cadence and complete
  ingestion code remain unknown. Public frontend evidence cannot establish them.

Recommended build order: office coverage and normalized areas, office-aware
search, role filters, bounded company browsing, history/viewport continuity,
then visual parity. Authentication and payment gates are not required to
complete our office-map behavior.
