# Company-office map

**Map · 5 cities** uses our existing catalogue and its search, experience,
employer, work-mode and date filters. The city selector covers Bengaluru,
Hyderabad, Pune, Mumbai and Chennai. Inside a city, company offices are
individual pins, nearby employers cluster, and selecting an employer opens
its location details and our own matching jobs with original application URLs.
Office and city selections can be bookmarked in the URL hash.

The rejected city-centre prototype has been replaced. See
`blrstartuparena-research.md` for the reference behavior and REA evidence.

## Office data is separate from jobs

`web/public/data/offices.json` contains sourced office locations, not external
job listings. Bengaluru records come from the reference's public company map;
other-city records come from named OpenStreetMap office features. Employer
matching normalizes punctuation and trailing legal suffixes, never prefixes or
fuzzy company names. One office per employer/city is shown, not a claim that
every role is based in that building.

Each pin retains its office name, available address/locality, coordinates,
source URL and approximation flag. Polygon centres and reference area-level
locations are marked approximate. Source-listed offices are not independent
verification of a company's current address or of a role's precise worksite.
Location details link directly to their source.

The bulk office registry is independent of today's job catalogue. Sources can
contain employers with no matching jobs yet; only employers with matching jobs
under current filters appear on the map. Coverage remains incomplete. Roles
without a sourced office stay in the unmapped section and List view.

## Refresh

From the repository root, run `npm run office-directory`. It fetches the full
public reference directory and bounded OpenStreetMap office queries generated
from the five city definitions. Each city uses a POST request, with a second
public Overpass endpoint on failure. No per-employer requests or job-catalogue
whitelist are required. Explicit office buildings and named office tenants are
accepted; source URLs and accuracy flags are retained. The complete result is
validated and written atomically. HTTP failures, malformed responses, query
timeouts and missing city coverage preserve the previous directory.
If either bulk source fails, the other in-flight acquisition is cancelled.
An empty reference company payload or an empty city response is a failure,
not evidence that the existing office inventory should be removed.

`.github/workflows/office-directory.yml` refreshes the directory weekly and can
also be run manually. It validates map tests before committing, then fetches and
merges current `main` before pushing. This workflow must be published to GitHub
before its schedule can run.

For a reproducible refresh, the command accepts `--reference <saved-map.html>`
and `--osm <saved-overpass.json>`. The office registry and its attribution file
are intentionally included in the web deployment. Job refreshes continue to
use the existing hourly ingestion without geocoding on each run.

## Rendering and verification

Leaflet and Leaflet.markercluster supply office pins, keyboard support and
clustering. The map uses OpenStreetMap tiles with attribution; office data
attribution is recorded in `web/public/data/offices-LICENSE.txt`. Tile failures
leave employer selection and original job links usable. Office-directory
failures report an error and retain access to List view.

Run `npm run test:map`, then `npm run build` from `web`. Unit checks cover city
matching, employer/office joins, source validation, invalid coordinates,
duplicate records, unmapped and remote-only roles, streamed source extraction,
accuracy preservation and incomplete-response rejection. Browser verification
must cover multiple office pins within a city, clusters, all five city
selectors, employer jobs, neighbourhood filtering, bookmarks, mobile layout
and failure states. Five aggregate city pins are not a valid completion test.

Verified 2026-10-29: browser checks passed for company-office pins, clustering, all five cities, neighbourhood filters, original catalogue URLs, sourced details, bookmark reload, keyboard access and desktop/mobile width. Blocked tiles retained employer details and job links; malformed directory data reported an error and preserved List view. Initial bounds use no animation so they cannot override bookmarked office selection.


## Shared map behavior

All cities use the same map component and bulk office/job join. Browsing area
anchors are city data, not separate implementations. Source locality strings
remain visible, while coordinate grouping provides stable multi-select areas.
Global search in map mode includes office names, addresses and grouped areas as
well as job titles, company and job location. Role-family filters reuse the
shared ingestion classifier in `shared/role-family.ts`; unknown experience is
not treated as a confirmed 0–1-year role.

The Leaflet map remains mounted while filters change. Its cluster layer updates
in place, preserving the viewport except for city/area changes, explicit office
selection, and reset. Company and unmapped-job browsing use pages of 20.
Company, city, area and map role selections are reflected in the URL; history
listeners restore map state. Logo pins use source-provided HTTPS URLs with
initials on image failure. Desktop uses a large map with an optional floating
employer panel; mobile stacks that panel below the map.

Follow-up verification on 2026-10-29 passed the eight map tests, full ingestion
regression suite, root type check and production web build. Production browser
checks covered all five cities, role classification, multiple areas and reload,
office-metadata search, pagination, retained Leaflet map pane, Back navigation,
mobile width, unavailable tiles and malformed-directory errors. Desktop and
mobile captures were visually inspected. The expanded saved-source bulk import
passed validation; a live Overpass 502 preserved the existing directory.
The acquisition tests also cover mirror fallback and cancellation. A CLI
regression runs failed and successful imports in an isolated directory and
proves that a failed refresh leaves the published bytes unchanged.
