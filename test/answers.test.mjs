// How the server words what comes back, and what it refuses to word wrongly.
import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_UPLOAD_BYTES } from '../src/api.js';
import { describeFailure, TOPUP_URL } from '../src/api.js';
import { convertFile, listConversions } from '../src/index.js';
import { targetsFor } from '../src/conversions.js';
import { NOMBRE_DE_PAIRES, NOMBRE_DE_SOURCES } from '../src/formats.js';

const said = (result) => result.content.map((c) => c.text).join('\n');

// A key-shaped string that is not a key. Nothing here reaches the network.
const FAKE_KEY = 'mdb_sk_' + '0'.repeat(32);

test('list_conversions with no argument names every input format', async () => {
  const out = said(await listConversions({}));
  // Construits depuis la table : epingler les chiffres a fait
  // vieillir ce test en silence une premiere fois.
  assert.match(out, new RegExp(`${NOMBRE_DE_SOURCES} input formats accepted`));
  assert.match(out, new RegExp(`${NOMBRE_DE_PAIRES} proven conversions`));
  assert.match(out, /\bdocx\b/);
  assert.match(out, /\bepub\b/);
});

test('list_conversions on one extension lists its proven targets', async () => {
  const out = said(await listConversions({ extension: '.docx' }));
  // The count is read from the table, not remembered here. It was 33
  // until 31 August and is larger since ten write-only document targets
  // opened; a number typed into a test only forces someone to retype it.
  const attendus = targetsFor('docx').length;
  assert.match(out, new RegExp(`\.docx converts to ${attendus} formats`));
  assert.ok(attendus >= 33, `${attendus} targets, fewer than before 31 August`);
  assert.match(out, /\bpdf\b/);
  // A target that is not proven for docx must not appear in the list.
  assert.ok(!out.split('\n\n')[1].split(', ').includes('png'));
});

test('list_conversions refuses an extension the converter cannot read', async () => {
  // `zip` jusqu'au 30/08, ou la famille archive l'a rendu lisible. `rar`
  // le remplace : lire un RAR demande un binaire non libre, et l'installer
  // n'est pas une decision que ce depot prend seul.
  const result = await listConversions({ extension: 'rar' });
  assert.equal(result.isError, true);
  assert.match(said(result), /not an accepted input format/);
});

test('the credit wall is worded as a wall, never as a fault', () => {
  const { kind, message } = describeFailure(402, {
    error: 'Not enough credits.',
    credits_remaining: 2,
    credits_needed: 5,
    feature: 'image_convert',
    offer: { missing: 3, packs: [{ pack: 'small', credits: 200, price: '$5.00' }], subscribe: null },
  });

  assert.equal(kind, 'credits');
  assert.match(message, /Out of credits/);
  assert.match(message, /costs 5 credits/);
  assert.match(message, /2 remain/);
  assert.match(message, /3 more are needed/);
  assert.match(message, /200 credits for \$5\.00/);
  assert.ok(message.includes(TOPUP_URL));
  // The words that would send an agent hunting for a bug that is not there.
  assert.doesNotMatch(message, /\berror\b|\bfailed\b|\bfailure\b|\bserver error\b/i);
});

test('a 402 without figures still points at the top-up page', () => {
  const { message } = describeFailure(402, { error: 'Credits were consumed by a concurrent conversion.' });
  assert.match(message, /Out of credits/);
  assert.ok(message.includes(TOPUP_URL));
  assert.doesNotMatch(message, /\berror\b|\bfailed\b/i);
});

test('the other statuses say what they mean', () => {
  assert.equal(describeFailure(401, {}).kind, 'auth');
  assert.match(describeFailure(401, {}).message, /missing, invalid, or revoked/);

  assert.equal(describeFailure(415, {}, { source: 'png', target: 'jpg' }).kind, 'unsupported');
  assert.match(describeFailure(415, {}, { source: 'png', target: 'jpg' }).message, /png to jpg/);

  assert.equal(describeFailure(413, {}).kind, 'too-large');
  // Le chiffre se LIT dans la constante au lieu d'etre epingle ici. Il a
  // valu 25 Mo jusqu'au 31/08/2026, ou il est passe a 150 : le plafond
  // annonce etait celui du moteur, et le transport, lui, s'arretait a
  // 4,2 Mo. Un nombre recopie dans un test ne mesure que lui-meme.
  assert.match(describeFailure(413, {}).message,
    new RegExp(String(MAX_UPLOAD_BYTES / (1024 * 1024)).replace('.', '\.') + '(\.0)? MB'));

  assert.equal(describeFailure(429, {}).kind, 'busy');
  assert.match(describeFailure(429, {}).message, /Wait a few seconds/);
  assert.match(describeFailure(429, {}).message, /Nothing is broken/);

  assert.equal(describeFailure(500, { error: 'boom' }).kind, 'upstream');
});

test('an unproven pair never reaches the network', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the network was touched'); };
  try {
    const result = await convertFile({ path: 'C:/nowhere/photo.png', target: 'docx' });
    assert.equal(result.isError, true);
    assert.match(said(result), /not a proven conversion/);
    assert.match(said(result), /Proven targets for \.png/);
  } finally {
    globalThis.fetch = real;
  }
});

test('a proven pair whose file is missing stops before the network too', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the network was touched'); };
  try {
    const result = await convertFile({ path: 'C:/nowhere/photo.png', target: 'jpg' });
    assert.equal(result.isError, true);
    assert.match(said(result), /Cannot read/);
  } finally {
    globalThis.fetch = real;
  }
});

test('a 402 from a proven conversion reaches the caller as the credit wall', async (t) => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = await mkdtemp(join(tmpdir(), 'mdb-mcp-'));
  const file = join(dir, 'photo.png');
  await writeFile(file, Buffer.from('not a real png, and it never leaves this test'));

  const realFetch = globalThis.fetch;
  const realKey = process.env.MDISBETTER_API_KEY;
  process.env.MDISBETTER_API_KEY = FAKE_KEY;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      error: 'Not enough credits.',
      credits_remaining: 0.5, credits_needed: 0.5,
      offer: { missing: 0.5, packs: [], subscribe: { plan: 'starter', credits: 2000 } },
    }),
    { status: 402, headers: { 'content-type': 'application/json' } }
  );

  try {
    const result = await convertFile({ path: file, target: 'jpg' });
    assert.equal(result.isError, true);
    const out = said(result);
    assert.match(out, /Out of credits/);
    assert.match(out, /Plan starter includes 2000 credits/);
    assert.ok(out.includes(TOPUP_URL));
    assert.doesNotMatch(out, /\berror\b|\bfailed\b/i);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.MDISBETTER_API_KEY;
    else process.env.MDISBETTER_API_KEY = realKey;
  }
});

test('with no key set, convert_file says so instead of calling out', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.MDISBETTER_API_KEY;
  delete process.env.MDISBETTER_API_KEY;
  globalThis.fetch = () => { throw new Error('the network was touched'); };

  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'mdb-mcp-'));
  const file = join(dir, 'photo.png');
  await writeFile(file, Buffer.from('bytes'));

  try {
    const result = await convertFile({ path: file, target: 'jpg' });
    assert.equal(result.isError, true);
    assert.match(said(result), /MDISBETTER_API_KEY/);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey !== undefined) process.env.MDISBETTER_API_KEY = realKey;
  }
});
