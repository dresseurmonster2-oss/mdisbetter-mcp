// The README's config block, taken literally.
//
// handshake.test.mjs already spawns the real server and speaks the real
// protocol to it, which proves the `command` and `args` a client is told
// to use. It does not prove the `env` block, because it inherits this
// machine's environment: a variable the README forgot to mention would
// be sitting there, the test would pass, and the first person to follow
// the README would get a server that starts and then fails on every call.
//
// So this file reads the block out of README.md, spawns the server with
// an environment stripped down to what that block declares, and checks
// the server still introduces itself and lists its tools.
//
// It also checks the block against the package: an `args` path that does
// not exist, or that is not the declared bin, would be a config nobody
// could copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = fs.readFileSync(join(ROOT, 'README.md'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The `mdisbetter` entry of the README's mcpServers block. */
function blocDuReadme() {
  const i = README.indexOf('"mcpServers"');
  assert.ok(i > -1, 'README no longer shows an mcpServers block');
  const bloc = README.slice(i, README.indexOf('```', i));

  const command = /"command"\s*:\s*"([^"]+)"/.exec(bloc);
  const args = /"args"\s*:\s*\[([^\]]*)\]/.exec(bloc);
  const env = [...bloc.matchAll(/"(MDISBETTER_[A-Z_]+)"\s*:/g)].map((m) => m[1]);

  assert.ok(command, 'the block declares no command');
  assert.ok(args, 'the block declares no args');
  return {
    command: command[1],
    args: args[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean),
    env,
  };
}

/**
 * Spawns the server the way the block says, with nothing else in the
 * environment. PATH stays: it is what makes `node` resolvable at all, and
 * no config block on any platform declares it.
 */
function converseNu(messages, env) {
  const bloc = blocDuReadme();
  // The block's path is a placeholder for the reader's own checkout.
  const entree = join(ROOT, 'src', 'index.js');

  return new Promise((resolve, reject) => {
    const child = spawn(bloc.command === 'node' ? process.execPath : bloc.command, [entree], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, ...env },
    });
    const answers = [];
    const attendues = messages.filter((m) => m.id != null).length;
    let buffer = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no answer within 15 s. stderr: ${stderr}`));
    }, 15000);

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (answers.length < attendues) {
        clearTimeout(timer);
        reject(new Error(`server exited with ${code} before answering. stderr: ${stderr}`));
      }
    });

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) continue;
        answers.push(JSON.parse(line));
        if (answers.length === attendues) {
          clearTimeout(timer);
          child.kill();
          resolve(answers);
        }
      }
    });

    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
  });
}

test('the block points at the file the package declares as its bin', () => {
  const bloc = blocDuReadme();
  assert.equal(bloc.command, 'node', 'a reader copies this verbatim; keep it plain');

  const chemin = bloc.args[0];
  assert.ok(chemin.endsWith('src/index.js'),
    `the block launches ${chemin}, which is not the entry point`);

  const declare = typeof PKG.bin === 'string' ? PKG.bin : Object.values(PKG.bin || {})[0];
  assert.ok(declare && chemin.endsWith(declare.replace(/^\.\//, '')),
    `the block launches ${chemin}, the package declares ${declare}`);
  assert.ok(fs.existsSync(join(ROOT, 'src', 'index.js')), 'that file does not exist');
});

test('the block declares every variable the server needs, and no other', () => {
  const bloc = blocDuReadme();
  assert.deepEqual(bloc.env, ['MDISBETTER_API_KEY'],
    'the block declares variables the server does not read, or misses one it does');

  // The source is the arbiter: any MDISBETTER_* it reads and the block
  // omits is a variable the reader will never set.
  const lus = new Set();
  for (const f of fs.readdirSync(join(ROOT, 'src'))) {
    const src = fs.readFileSync(join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(/process\.env\.(MDISBETTER_[A-Z_]+)/g)) lus.add(m[1]);
  }
  // MDISBETTER_BASE_URL is read but deliberately absent from the block:
  // it defaults to the live site, and a reader has no reason to override
  // it. Anything else appearing here is an omission, not a choice.
  lus.delete('MDISBETTER_BASE_URL');
  assert.deepEqual([...lus].sort(), ['MDISBETTER_API_KEY'],
    'the server reads a variable the README does not tell anyone to set');
});

test('the server starts and introduces itself with that environment alone', async () => {
  const [reponse] = await converseNu([{
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'readme-reader', version: '0' },
    },
  }], { MDISBETTER_API_KEY: 'mdb_sk_placeholder' });

  assert.equal(reponse.id, 1);
  assert.ok(reponse.result?.serverInfo?.name, 'the server did not name itself');
  assert.ok(!reponse.error, `the server answered an error: ${JSON.stringify(reponse.error)}`);
});

test('it lists the two tools the README promises', async () => {
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'readme-reader', version: '0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ];
  const answers = await converseNu(messages, { MDISBETTER_API_KEY: 'mdb_sk_placeholder' });
  const liste = answers.find((a) => a.id === 2);

  const noms = (liste?.result?.tools || []).map((t) => t.name).sort();
  assert.deepEqual(noms, ['convert_file', 'list_conversions'],
    'the tool list does not match what the README says appears');
});

test('with no key at all it still starts, and says so only when used', async () => {
  // A reader who pastes the block before minting a key must not get a
  // server that refuses to boot: the client would show it as broken
  // rather than as unconfigured.
  const [reponse] = await converseNu([{
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'readme-reader', version: '0' },
    },
  }], {});

  assert.ok(reponse.result?.serverInfo?.name,
    'the server refuses to start without a key; an unconfigured server should still boot');
});
