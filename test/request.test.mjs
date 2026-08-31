// What convert_file actually puts on the wire, and where it puts the result.
// The wire is a stub: no key is used and no request leaves the machine.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertFile } from '../src/index.js';

const FAKE_KEY = 'mdb_sk_' + '0'.repeat(32);

/** Answers every call with the same bytes, and records what it was asked. */
function stubConverter(bytes = Buffer.from('converted bytes')) {
  const seen = [];
  return {
    seen,
    fetch: async (url, options) => {
      const form = options.body;
      seen.push({
        url: String(url),
        authorization: options.headers?.authorization,
        target: form.get('target'),
        filename: form.get('file')?.name,
      });
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    },
  };
}

async function withStub(stub, run) {
  const realFetch = globalThis.fetch;
  const realKey = process.env.MDISBETTER_API_KEY;
  globalThis.fetch = stub.fetch;
  process.env.MDISBETTER_API_KEY = FAKE_KEY;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.MDISBETTER_API_KEY;
    else process.env.MDISBETTER_API_KEY = realKey;
  }
}

async function scratch(name, contents = 'some bytes') {
  const dir = await mkdtemp(join(tmpdir(), 'mdb-mcp-'));
  const path = join(dir, name);
  await writeFile(path, Buffer.from(contents));
  return { dir, path };
}

test('each pair is sent to the endpoint the table names', async () => {
  const cases = [
    ['report.docx', 'pdf', '/api/convert-office'],
    ['report.docx', 'html', '/api/convert-document'],
    ['photo.png', 'jpg', '/api/convert-image'],
    ['book.epub', 'mobi', '/api/convert-ebook'],
  ];

  for (const [name, target, endpoint] of cases) {
    const stub = stubConverter();
    const { path } = await scratch(name);
    await withStub(stub, () => convertFile({ path, target }));
    assert.equal(stub.seen.length, 1, name);
    assert.equal(stub.seen[0].url, `https://mdisbetter.com${endpoint}`, `${name} to ${target}`);
  }
});

test('the key travels in the header, and the file keeps its name', async () => {
  const stub = stubConverter();
  const { path } = await scratch('photo.png');
  await withStub(stub, () => convertFile({ path, target: 'jpg' }));
  assert.equal(stub.seen[0].authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(stub.seen[0].filename, 'photo.png');
  assert.equal(stub.seen[0].target, 'jpg');
});

// This test used to assert the opposite, and it was right at the time:
// office conversions went to `/api/convert-to-pdf`, whose output is always
// PDF and which takes the file alone.
//
// On 30 August the office family moved to `/api/convert-office`, which
// serves eleven targets and refuses a request that names none. Had the
// exception followed the family, every office conversion an agent asked
// for would have failed, with a message about a missing target that the
// agent had in fact supplied. The exception belongs to one route, not to
// a family.
test('the office endpoint is sent its target, it no longer has only one', async () => {
  const stub = stubConverter();
  const { path } = await scratch('slides.pptx');
  await withStub(stub, () => convertFile({ path, target: 'pdf' }));
  assert.equal(stub.seen[0].url, 'https://mdisbetter.com/api/convert-office');
  assert.equal(stub.seen[0].target, 'pdf');
});

test('a non-PDF office target is sent too', async () => {
  const stub = stubConverter();
  const { path } = await scratch('sheet.xlsx');
  await withStub(stub, () => convertFile({ path, target: 'csv' }));
  assert.equal(stub.seen[0].url, 'https://mdisbetter.com/api/convert-office');
  assert.equal(stub.seen[0].target, 'csv');
});

test('convert-to-pdf keeps its exception, for whoever still calls it', () => {
  // No pair in the table routes there any more, so this cannot be proven
  // by a conversion. It is read from the source instead, and said so.
  const src = fs.readFileSync(
    new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(src, /route !== '\/api\/convert-to-pdf'/,
    'the one route that takes no target would now be sent one');
});

test('the base URL follows the environment, so a preview can be tested', async () => {
  const stub = stubConverter();
  const { path } = await scratch('photo.png');
  const realBase = process.env.MDISBETTER_BASE_URL;
  process.env.MDISBETTER_BASE_URL = 'https://preview.example.test/';
  try {
    await withStub(stub, () => convertFile({ path, target: 'jpg' }));
    assert.equal(stub.seen[0].url, 'https://preview.example.test/api/convert-image');
  } finally {
    if (realBase === undefined) delete process.env.MDISBETTER_BASE_URL;
    else process.env.MDISBETTER_BASE_URL = realBase;
  }
});

test('the result lands beside the input, and the input survives', async () => {
  const stub = stubConverter(Buffer.from('PDF-ish bytes'));
  const { dir, path } = await scratch('report.docx', 'original');
  const result = await withStub(stub, () => convertFile({ path, target: 'pdf' }));

  assert.notEqual(result.isError, true);
  const written = join(dir, 'report.pdf');
  assert.match(result.content[0].text, /report\.pdf/);
  assert.equal((await readFile(written)).toString(), 'PDF-ish bytes');
  assert.equal((await readFile(path)).toString(), 'original');
});

test('an existing neighbour is not overwritten', async () => {
  const stub = stubConverter(Buffer.from('new'));
  const { dir, path } = await scratch('report.docx');
  await writeFile(join(dir, 'report.pdf'), Buffer.from('do not touch me'));

  await withStub(stub, () => convertFile({ path, target: 'pdf' }));
  assert.equal((await readFile(join(dir, 'report.pdf'))).toString(), 'do not touch me');
  assert.equal((await readFile(join(dir, 'report-1.pdf'))).toString(), 'new');
});

test('output_path is obeyed exactly', async () => {
  const stub = stubConverter(Buffer.from('here'));
  const { dir, path } = await scratch('photo.png');
  const chosen = join(dir, 'somewhere-else.jpg');
  const result = await withStub(stub, () => convertFile({ path, target: 'jpg', output_path: chosen }));
  assert.match(result.content[0].text, /somewhere-else\.jpg/);
  assert.equal((await readFile(chosen)).toString(), 'here');
});

test('an empty answer writes nothing', async () => {
  const stub = { seen: [], fetch: async () => new Response(new Uint8Array(0), { status: 200 }) };
  const { dir, path } = await scratch('photo.png');
  const result = await withStub(stub, () => convertFile({ path, target: 'jpg' }));
  assert.equal(result.isError, true);
  await assert.rejects(() => stat(join(dir, 'photo.jpg')));
});
