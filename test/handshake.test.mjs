// The server is spawned as a real process and spoken to over stdio, the
// same way an MCP client would. Nothing is stubbed here except the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

/** Spawns the server, plays a conversation, hands back the answers. */
function converse(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], { stdio: ['pipe', 'pipe', 'pipe'] });
    const answers = [];
    const expected = messages.filter((m) => m.id != null).length;
    let buffer = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no answer within 15 s. stderr: ${stderr}`));
    }, 15000);

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) continue;
        answers.push(JSON.parse(line));
        if (answers.length === expected) {
          clearTimeout(timer);
          child.kill();
          resolve(answers);
        }
      }
    });

    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
  });
}

test('initialize then tools/list, over stdio, on a real process', async () => {
  const [hello, listed] = await converse([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'node-test', version: '0.0.0' },
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]);

  assert.equal(hello.id, 1);
  assert.equal(hello.error, undefined);
  assert.equal(hello.result.serverInfo.name, 'mdisbetter');
  assert.ok(hello.result.capabilities.tools);

  assert.equal(listed.id, 2);
  const names = listed.result.tools.map((t) => t.name).sort();
  // Two tools, and exactly two. Anything else here is a capability we
  // would be claiming without having built it.
  assert.deepEqual(names, ['convert_file', 'list_conversions']);

  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 0);
  }
});

test('a tools/call answers over the same transport', async () => {
  const answers = await converse([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'node-test', version: '0.0.0' },
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
      name: 'list_conversions', arguments: { extension: 'epub' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'convert_file', arguments: { path: 'C:/nowhere/photo.png', target: 'docx' } } },
  ]);

  const byId = new Map(answers.map((a) => [a.id, a]));
  assert.match(byId.get(2).result.content[0].text, /\.epub converts to \d+ formats/);
  assert.match(byId.get(2).result.content[0].text, /\bmobi\b/);

  const refused = byId.get(3).result;
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /not a proven conversion/);
});

test('an unknown tool is refused rather than ignored', async () => {
  const answers = await converse([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'node-test', version: '0.0.0' },
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'convert_batch', arguments: {} } },
  ]);
  const answer = answers.find((a) => a.id === 2);
  // Either shape is honest; what matters is that it is not silently accepted.
  const refused = answer.error != null
    || (answer.result?.isError === true && /Unknown tool/.test(answer.result.content[0].text));
  assert.ok(refused, JSON.stringify(answer));
});
