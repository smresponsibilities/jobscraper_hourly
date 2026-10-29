import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOffices, fetchOsmOffices, officeQuery, referenceCompanies } from '../../src/office-directory';
import { JOB_CITIES } from './job-cities';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { employerKey, officeGroups, parseOfficeDirectory, type Office } from './office-data';
import type { Job } from './types';
import { OFFICE_AREAS, officeArea } from './office-areas';

const office: Office = { id: 'office:1', company: 'Example Ltd', city: 'Bengaluru', latitude: 12.93, longitude: 77.67, officeName: 'Example campus', locality: 'Bellandur', address: 'Campus Road', approximate: false, source: 'https://www.openstreetmap.org/node/1' };
const job = (id: string, company: string, location: string) => ({ id, company, location } as Job);

test('area grouping uses coordinates despite inconsistent locality names in every city', () => {
  for (const city of Object.keys(OFFICE_AREAS) as Office['city'][]) {
    for (const area of OFFICE_AREAS[city]) {
      const point = { ...office, city, latitude: area.lat, longitude: area.lng };
      assert.equal(officeArea(point).id, area.id);
      assert.equal(officeArea({ ...point, locality: 'Different spelling / compound neighbourhood' }).id, area.id);
    }
  }
  assert.equal(officeArea({ ...office, latitude: 12.975, longitude: 77.745, locality: 'Whitefield / EPIP' }).id, 'whitefield');
});

test('jobs join employer offices within the advertised city, never a guessed city centre', () => {
  const jobs = [job('one', 'Example', 'Bangalore'), job('two', 'Example', 'Bengaluru / Pune'), job('remote', 'Example', 'Remote'), job('other', 'Other', 'Bengaluru'), job('prefix', 'Example Systems', 'Bengaluru')];
  const result = officeGroups(jobs, [office, { ...office, id: 'duplicate' }], 'Bengaluru');
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0]?.jobs.map(j => j.id), ['one', 'two']);
  assert.deepEqual(result.unmapped.map(j => j.id), ['other', 'prefix']);
  assert.equal(officeGroups(jobs, [office], 'Pune').groups.length, 0);
  assert.equal(employerKey('Example Ltd.'), employerKey('Example'));
  assert.notEqual(employerKey('INC Research'), employerKey('Research'));
  assert.notEqual(employerKey('Example Inc Systems'), employerKey('Example Systems'));
  assert.ok(employerKey('பிரம்ம ஞான சபை'));
  assert.notEqual(employerKey('प्रविण'), employerKey('प्रवीण'));
  assert.notEqual(employerKey('Hitachi Solutions'), employerKey('Hitachi'));
});

test('office directory rejects malformed, duplicate, remote and unsafe source records', () => {
  const directory = { version: 1, generatedAt: '2026-10-29T00:00:00Z', offices: [office] };
  assert.equal(parseOfficeDirectory(directory).offices[0]?.latitude, 12.93);
  for (const bad of [{ latitude: NaN }, { latitude: 0 }, { source: 'javascript:alert(1)' }, { city: 'Remote' }]) {
    assert.throws(() => parseOfficeDirectory({ ...directory, offices: [{ ...office, ...bad }] }), /Invalid office/);
  }
  assert.throws(() => parseOfficeDirectory({ ...directory, offices: [office, office] }), /Invalid office/);
  assert.throws(() => parseOfficeDirectory({ offices: [] }), /Invalid office/);
});

test('refresh parses streamed source data and preserves location accuracy and provenance', () => {
  const source = { slug: 'example', name: 'Example', latitude: 12.93, longitude: 77.67, approximate: true, officeName: 'Area office', locality: 'Bellandur', logoUrl: 'https://example.com/logo.png' };
  const payload = `6:${JSON.stringify(['$', '$L1', null, { companies: [source] }])}\n`;
  const html = [payload.slice(0, 30), payload.slice(30)].map(part => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join('');
  const offices = buildOffices(referenceCompanies(html), { elements: [{ type: 'node', id: 2, lat: 18.52, lon: 73.85, tags: { name: 'Example', office: 'company' } }] });
  assert.equal(offices.length, 2);
  assert.equal(offices[0]?.approximate, true);
  assert.equal(offices[0]?.logoUrl, source.logoUrl);
  assert.match(offices[0]!.source, /blrstartuparena/);
  assert.equal(offices[1]?.city, 'Pune');
  assert.equal(offices[1]?.source, 'https://www.openstreetmap.org/node/2');
  assert.throws(() => buildOffices([source], { elements: [], remark: 'timeout' }), /Incomplete/);
  assert.throws(() => referenceCompanies('<html>Blocked</html>'), /payload missing/);
});


test('bulk office import is independent of employers currently in the job catalogue', () => {
  const company = { slug: 'future-employer', name: 'Future Employer', latitude: 12.93, longitude: 77.67, approximate: false };
  const result = buildOffices([company], { elements: [{ type: 'node', id: 20, lat: 18.52, lon: 73.85, tags: { name: 'Another Employer', office: 'company' } }] });
  assert.deepEqual(result.map(office => office.company), ['Future Employer', 'Another Employer']);
  assert.equal(officeGroups([job('new-role', 'Future Employer', 'Bengaluru')], result, 'Bengaluru').groups.length, 1);
});

test('fresh place offices merge by employer and city while reference office accuracy wins', () => {
  const reference = { slug: 'example', name: 'Example', latitude: 12.93, longitude: 77.67, approximate: false };
  const places = [{ ...office, id: 'overture:duplicate', approximate: true }, { ...office, id: 'overture:another', company: 'Another Employer' }];
  const result = buildOffices([reference], { elements: [] }, places);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.id, 'blr:example');
  assert.equal(result[0]?.approximate, false);
  assert.equal(result[1]?.id, 'overture:another');
});

test('bulk acquisition uses bounded city POSTs and a mirror after a source failure', async () => {
  const calls: { url: string; query: string }[] = [];
  const result = await fetchOsmOffices(async (url, options) => {
    assert.equal(options?.method, 'POST');
    const query = (options?.body as URLSearchParams).get('data')!;
    calls.push({ url: String(url), query });
    if (calls.length === 1) return new Response('', { status: 502 });
    return Response.json({ elements: [{ id: calls.length }] });
  });
  assert.equal(result.elements.length, JOB_CITIES.length);
  assert.equal(calls.length, JOB_CITIES.length + 1);
  assert.notEqual(calls[0]?.url, calls[1]?.url);
  assert.equal(calls[0]?.query, calls[1]?.query);
  assert.deepEqual([...new Set(calls.map(call => call.query))], JOB_CITIES.map(officeQuery));
  await assert.rejects(fetchOsmOffices(async () => Response.json({ elements: [{ id: 1 }], remark: 'Query timed out' })), /Bengaluru office sources failed/);
  await assert.rejects(fetchOsmOffices(async () => Response.json({ elements: [] })), /Incomplete office response/);
  const controller = new AbortController();
  controller.abort(new Error('Reference source failed'));
  let attempts = 0;
  await assert.rejects(fetchOsmOffices(async () => { attempts++; return Response.json({ elements: [{ id: 1 }] }); }, controller.signal), /Reference source failed/);
  assert.equal(attempts, 0);
});

test('failed refresh preserves the prior published directory byte for byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'office-refresh-test-'));
  try {
    const target = join(directory, 'web/public/data/offices.json');
    await mkdir(join(directory, 'web/public/data'), { recursive: true });
    const prior = '{"previous":"published directory"}\n';
    await writeFile(target, prior);
    const reference = join(directory, 'reference.html');
    const osm = join(directory, 'osm.json');
    const payload = `6:${JSON.stringify(['$', '$L1', null, { companies: [{ slug: 'example', name: 'Example', latitude: 12.93, longitude: 77.67, approximate: false }] }])}\n`;
    await writeFile(reference, `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`);
    await writeFile(osm, JSON.stringify({ elements: [], remark: 'Query timed out' }));
    const run = (source = '--osm') => spawnSync(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
      resolve('src/office-directory.ts'), '--reference', reference, source, osm], { cwd: directory, encoding: 'utf8', timeout: 180_000 });
    const failed = run();
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /Incomplete OpenStreetMap/);
    assert.equal(await readFile(target, 'utf8'), prior);
    await writeFile(osm, JSON.stringify({ elements: JOB_CITIES.slice(1).map((city, index) => ({ type: 'node', id: index + 1, lat: city.lat, lon: city.lng, tags: { office: 'company', name: `${city.name} Employer` } })) }));
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(new Set(JSON.parse(await readFile(target, 'utf8')).offices.map((office: Office) => office.city)), new Set(JOB_CITIES.map(city => city.name)));
    const published = await readFile(target, 'utf8');
    await writeFile(osm, JSON.stringify({ offices: [{ ...office, id: 'overture:incomplete' }] }));
    assert.equal(run('--places').status, 1);
    assert.equal(await readFile(target, 'utf8'), published);
    await writeFile(osm, JSON.stringify({ offices: JOB_CITIES.map((city, index) => ({ ...office, id: `overture:${index}`, company: `${city.name} Employer`, city: city.name, latitude: city.lat, longitude: city.lng, approximate: true })) }));
    const places = run('--places');
    assert.equal(places.status, 0, places.stderr);
    assert.equal(JSON.parse(await readFile(target, 'utf8')).offices.filter((office: Office) => office.id.startsWith('overture:')).length, JOB_CITIES.length);
  } finally {
    assert.equal(resolve(directory, '..'), resolve(tmpdir()));
    assert.match(basename(directory), /^office-refresh-test-/);
    await rm(directory, { recursive: true, force: true });
  }
});
