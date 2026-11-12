// What the MCP Registry and bundle clients read must agree with the server.
//
// Three files describe this server to the outside: package.json, manifest.json
// (the .mcpb bundle) and server.json (the official MCP Registry). A version or
// a tool name that drifts in one of them is published as a false statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, VERSION } from '../src/index.js';

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const pkg = json('../package.json');
const manifest = json('../manifest.json');
const server = json('../server.json');

test('one version everywhere', () => {
  assert.equal(pkg.version, VERSION);
  assert.equal(manifest.version, VERSION);
  assert.equal(server.version, VERSION);
});

test('the bundle declares exactly the tools the server registers', () => {
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
});

test('the bundle starts the real entry point and asks for the API key', () => {
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'src/index.js');
  readFileSync(new URL(`../${manifest.server.entry_point}`, import.meta.url));
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/src/index.js']);
  assert.equal(manifest.server.mcp_config.env.MDISBETTER_API_KEY, '${user_config.api_key}');
  assert.equal(manifest.user_config.api_key.required, true);
  assert.equal(manifest.user_config.api_key.sensitive, true);
});

test('the registry entry points at the bundle of this version, in this repository', () => {
  assert.equal(server.name, 'io.github.dresseurmonster2-oss/mdisbetter-mcp');
  assert.ok(server.description.length <= 100, `description is ${server.description.length} characters, the registry allows 100`);
  const [bundle] = server.packages;
  assert.equal(server.packages.length, 1);
  assert.equal(bundle.registryType, 'mcpb');
  assert.equal(bundle.identifier,
    `https://github.com/dresseurmonster2-oss/mdisbetter-mcp/releases/download/v${VERSION}/mdisbetter-mcp.mcpb`);
  assert.match(bundle.fileSha256, /^[0-9a-f]{64}$/);
  assert.equal(bundle.transport.type, 'stdio');
  const key = bundle.environmentVariables.find((v) => v.name === 'MDISBETTER_API_KEY');
  assert.ok(key && key.isRequired && key.isSecret);
});

test('no description promises what the server does not do', () => {
  for (const text of [manifest.description, manifest.long_description, server.description]) {
    assert.doesNotMatch(text, /batch|webhook|no account|without an account|no sign-?up|free forever/i);
    assert.equal(text.includes('—'), false, 'em dash');
  }
});
