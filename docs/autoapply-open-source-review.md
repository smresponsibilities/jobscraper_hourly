# Open-source auto-apply review

Reviewed 30 October 2026. Source inspection did not execute third-party code or
send candidate data to either project. No code was copied.

## Latest follow-up, 30 October 2026

Repository metadata was checked again. `workday-autofill` last pushed at
2026-10-30T03:41:31Z, matching the implementation reviewed below.
[`tmwclaxton/autoapplycv`](https://github.com/tmwclaxton/autoapplycv) last pushed
at 2026-10-21T19:16:36Z. Inspected:

- [`form-validation-errors.js`](https://github.com/tmwclaxton/autoapplycv/blob/main/extension/src/content/form-validation-errors.js),
  blob `0c92c8b1b54a12508ce77dc92d4c78c324db1bd6`: native validity, field labels,
  visible validation surfaces and filters for unrelated promotional alerts.
- [`linkedin-page-health.js`](https://github.com/tmwclaxton/autoapplycv/blob/main/extension/src/content/linkedin-page-health.js),
  blob `398fb3bc9eae3b8fac309a5cc965085062dba574`: security-checkpoint URLs,
  visible alert surfaces, login loops and blocking page-health conditions.
- [`field-inventory.js`](https://github.com/tmwclaxton/autoapplycv/blob/main/extension/src/content/field-inventory.js),
  blob `98774554f9ce6aa63fb33b3952957559ef2ccf9b`: target registry, grouped
  choice controls, listboxes, comboboxes and field metadata.

These are implementation examples, not proof that every advertised portal works
or that browser bot detection can be reliably evaded.

## Sources

### workday-autofill

[Repository](https://github.com/HarshadLambate/workday-autofill), MIT license.
Inspected `forms.py` blob `1799be34fbb776d775ea6f0473c9b2f973849e8a`
and `workday.py` blob `9408eed5d1901e29ad3634addbf72a731acdccad`.

- [Generic forms](https://github.com/HarshadLambate/workday-autofill/blob/main/src/wdautofill/forms.py)
  mark question blocks with stable attributes before resolving answers. Labels
  come from explicit labels, legends, ARIA references and Lever question groups.
- [Workday](https://github.com/HarshadLambate/workday-autofill/blob/main/src/wdautofill/workday.py)
  uses `data-automation-id` for Apply, authentication, navigation, errors,
  searchable options and selected pills. Education and work-history rows are
  reconciled against the supplied profile.
- The project deliberately stops before Submit and leaves CAPTCHA to the owner.
  Its README calls generic Greenhouse support best effort and Oracle unsupported.
  Its screenshots use demo pages, so they do not prove live portal compatibility.

### ApplyAI

[Repository](https://github.com/muhammad-saadd/applyai), MIT license.
Inspected Workday blob `97479a99a3005f4526eb8cd152efbcf0349a1f6b`
and Greenhouse blob `6e58333cec5d4e7ea074a99eb9ee2c1fd30816fd`.

- [Workday adapter](https://github.com/muhammad-saadd/applyai/blob/main/content_scripts/workday.js)
  discovers standard inputs, textareas and selects under application or
  automation-ID containers. That collector excludes file controls and does not
  establish support for Workday's named listbox buttons.
- [Greenhouse adapter](https://github.com/muhammad-saadd/applyai/blob/main/content_scripts/greenhouse.js)
  scopes discovery to known application forms and derives unique selectors and
  labels. Source discovery is evidence of implementation, not successful live
  submissions on every advertised portal.

## Changes supported by our own live evidence

Our runner now binds controls before dynamic widgets alter input order. Ashby
field groups supply their actual title and required marker; instructional text
is kept separate from classification. Custom Yes/No controls use their explicit
buttons. Saved answers accept booleans, including explicit consent choices on
resume. Country options with calling codes and full city/state/country options
are matched against supplied geography without arbitrary fuzzy selection.

An invisible reCAPTCHA badge is distinguished from an actionable challenge.
Challenges remain owner handoffs. Submission clicks are checkpointed before
sending, and applications count as applied only after an observed receipt.
