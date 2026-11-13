import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbeddedAtsSlugsFromHtml } from './embedded-ats-extractor.js';
import { extractAtsLinksFromHtml } from './ats-board-resolver.js';

test('discovery finds embedded boards, deduplicates and excludes isolated tenants', () => {
  const html = `<script src="https://boards.greenhouse.io/embed/job_board/js?x=1&amp;for=acme_ai"></script>
    <iframe src="https://jobs.ashbyhq.com/linear"></iframe>
    <a href="https://apply.workable.com/acme/">workable</a>
    <a href="https://acme.recruitee.com/o/engineer">recruitee</a>
    <a href="https://acme.breezy.hr/p/engineer">breezy</a>
    <a href="https://stripe.recruitee.com/o/engineer">excluded</a>
    <a href="https://jobs.ashbyhq.com/linear">duplicate</a>
    <a href="https://evil.recruitee.com.attacker.test/o/job">spoof</a>`;
  const links = extractEmbeddedAtsSlugsFromHtml(html);
  assert.deepEqual(links.map(link => `${link.provider}:${link.slug}`), [
    'greenhouse:acme_ai', 'ashby:linear', 'workable:acme', 'recruitee:acme', 'breezy:acme',
  ]);
  assert.equal(extractAtsLinksFromHtml(html).length, links.length);
  assert.deepEqual(extractEmbeddedAtsSlugsFromHtml(''), []);
});
