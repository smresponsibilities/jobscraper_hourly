# Audit follow-up, 2026-10-31

The latest audit's sections 14 and 15 supersede the earlier model-fallback and
test-suite plan. This follow-up records local changes, not production acceptance.

## Changes applied

- AI-OFF: the worker does not construct a model by default, even if API keys are
  present. Only the explicit `AUTOAPPLY_NO_MODEL=0` opt-in enables it. Worker state
  records `model: disabled` or `enabled`. Secrets were not changed or printed.
- FUN-05: preflight uses the scraper's existing `MAX_YEARS` target ceiling, 3,
  rather than the candidate's actual experience. Candidate facts remain unchanged.
  Already-skipped queue rows are not silently requeued.
- OBS-01: queue failures retain the runner's reason, with the existing generic
  message only as a fallback. Review pauses also retain their reason.

## Existing company grouping

Local changes group by canonical ATS tenant, reuse a tenant's browser owner,
and retain separate role claims and receipts. Role-specific answers override
company answers. Company-wide answer reuse requires explicit scope. Native
previous-application prefill is enabled only after another role at that employer
has an applied receipt. Pending form requests block sibling company applications.

Earlier focused fixture results are recorded in the existing regression logs.
The company-session integration rerun remains unverified after the latest
strong-label correction. Do not present grouping as verified live.

## Verification and limits

TypeScript typecheck passed after these follow-up changes. No suite was run,
following the owner's decision recorded in section 14.5. A small direct preflight
replay could not start because tsx failed in `uv_os_get_passwd` with ENOMEM.
Consequently, no runtime result is claimed for the changed target gate.

No live worker was started and no application was submitted in this follow-up.
The audit's 0/50 acceptance observation is not replaced by a new live audit.
The existing exact approved-URL boundary remains in force. Proposed rolling
approval, fit limits and daily caps have not been installed or inferred.

## Remaining priority work

Worker heartbeat and liveness reader, structured reason codes, status/explain,
and durable event history remain open. No claim that OBS-02 or OBS-04 is done.
Next operational step is a sequential, approved-role canary on current code,
with receipt reconciliation before retrying any ambiguous submission. The ABB
unfinished POST must not be retried blindly. Revalidate stale parked reviews
before treating their historical errors as current failures.

Research is retained in `autoapply-open-source-research.md` and
`autoapply-rea-findings.md`. Simplify inspection is partial static evidence,
not runtime reliability or production submission proof.
