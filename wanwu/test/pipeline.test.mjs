import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wanwu-test-'));
process.env.WANWU_WORKSPACE = path.join(tmp, 'ws');
process.env.WANWU_CONTENT = path.join(tmp, 'content');
const store = await import('../lib/store.mjs');
const { build } = await import('../site/build.mjs');

const src = path.join(tmp, 'upload'); fs.mkdirSync(src);
fs.writeFileSync(path.join(src, 'meeting_notes_0312.md'), '# Meeting\nDecided to add wet-bulb weather.');
fs.writeFileSync(path.join(src, 'analysis.py'), 'print("hi")\n');
fs.writeFileSync(path.join(src, 'raw_data.csv'), 'a,b\n1,2\n');
fs.writeFileSync(path.join(src, 'fig1_result.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(src, 'interview.mp4'), Buffer.from('00'));

test('handles and slugs are validated', () => {
  assert.throws(() => store.upsertAuthor({ name: 'X', handle: 'explore' }), /reserved/);
  assert.throws(() => store.upsertAuthor({ name: 'X', handle: 'Bad Handle' }), /valid handle/);
});

test('full pipeline keeps private files off the site', async () => {
  store.upsertAuthor({ name: 'Ada Lovelace', handle: 'ada', affiliation: 'Uni A' });
  store.upsertAuthor({ name: 'Bo Li', handle: 'boli', affiliation: 'Uni B' });
  const st = store.upsertStudy('ada', { title: 'Test Study', authors: [{ name: 'Ada Lovelace', handle: 'ada', affiliation: 'Uni A' }, { name: 'Bo Li', handle: 'boli', affiliation: 'Uni B' }, { name: 'Cy Outside' }] });
  assert.equal(st.slug, 'test-study');
  assert.deepEqual(st.authors.map(a => a.name), ['Ada Lovelace', 'Bo Li', 'Cy Outside']);

  const r = await store.ingest('ada', 'test-study', [src]);
  const by = Object.fromEntries(r.map(x => [x.file, x]));
  assert.equal(by['meeting_notes_0312.md'].section, 'log');
  assert.equal(by['analysis.py'].section, 'code');
  assert.equal(by['raw_data.csv'].section, 'data');
  assert.equal(by['raw_data.csv'].suggestedVisibility, 'private');
  assert.equal(by['fig1_result.png'].section, 'outcome');
  assert.equal(by['interview.mp4'].extract, 'needs_transcription');
  // duplicates are skipped
  assert.ok((await store.ingest('ada', 'test-study', [path.join(src, 'analysis.py')]))[0].skipped);

  // nothing is public before the author decides
  let s = store.getStudy('ada', 'test-study');
  assert.ok(s.materials.every(m => m.visibility === 'private'));
  assert.match(store.checkStudy('ada', 'test-study').issues.join('\n'), /private until the author decides/);

  store.acceptSuggestedVisibility('ada', 'test-study');
  store.writeSection('ada', 'test-study', 'overview', 'Hello <script>alert(1)</script> [x](javascript:alert(1))');
  store.exportPublic();
  const out = path.join(tmp, 'dist');
  build({ content: process.env.WANWU_CONTENT, out });

  const studyDir = path.join(out, 'ada', 'test-study');
  const files = fs.readdirSync(path.join(studyDir, 'files'));
  assert.ok(files.some(f => f.endsWith('analysis.py')));
  assert.ok(!files.some(f => f.endsWith('raw_data.csv')), 'private data must not be copied');
  assert.ok(!files.some(f => f.endsWith('.mp4')), 'recordings must not be copied');
  const exported = fs.readFileSync(path.join(process.env.WANWU_CONTENT, 'ada', 'test-study', 'study.json'), 'utf8');
  assert.ok(!exported.includes('raw_data'), 'private material metadata must not be exported');

  const html = fs.readFileSync(path.join(studyDir, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>alert'), 'raw HTML must be escaped');
  assert.ok(!html.includes('javascript:alert'), 'unsafe links must be dropped');
  assert.ok(html.indexOf('Ada Lovelace') < html.indexOf('Bo Li') && html.indexOf('Bo Li') < html.indexOf('Cy Outside'), 'author order kept');
  assert.ok(html.includes('href="/boli/"'), 'co-author on the platform is linked');
  assert.ok(fs.existsSync(path.join(studyDir, 'code', 'index.html')));
  assert.ok(fs.existsSync(path.join(studyDir, 'log', 'index.html')) === false, 'empty sections are not built (log has only private files)');
  const bo = fs.readFileSync(path.join(out, 'boli', 'index.html'), 'utf8');
  assert.ok(bo.includes('Co-authored') && bo.includes('Test Study'), 'co-author page lists the study');
});
