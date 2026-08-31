#!/usr/bin/env node
// MCP server for the mdisbetter.com file converter, stdio transport.
//
// Two tools and nothing else: convert one local file, and ask what can be
// converted into what. There is no batch mode, no webhook, no polling, no
// audio and no video here, because the server does not do those things.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { extensionOf, knownSources, planConversion, targetsFor, pairCount } from './conversions.js';
import { MAX_UPLOAD_BYTES, postConversion } from './api.js';

export const NAME = 'mdisbetter';
export const VERSION = '0.1.0';

export const TOOLS = [
  {
    name: 'convert_file',
    description:
      'Convert one local file to another format and write the result next to it. '
      + `Covers ${pairCount()} proven conversions across ${knownSources().length} input formats `
      + '(images, documents, ebooks, and office files to PDF). '
      + 'Call list_conversions first if you are unsure a pair is supported. '
      + 'One file per call: there is no batch mode.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to convert, on the machine running this server.',
        },
        target: {
          type: 'string',
          description: 'Output format, as a bare extension such as "pdf", "png" or "md".',
        },
        output_path: {
          type: 'string',
          description:
            'Optional. Where to write the result. Overwrites if it exists. '
            + 'Omitted, the result goes beside the input with the new extension, '
            + 'and an existing file is never overwritten.',
        },
      },
      required: ['path', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_conversions',
    description:
      'Ask what this converter can do. With an extension, returns the output formats proven '
      + 'for it. With no argument, returns every input extension accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        extension: {
          type: 'string',
          description: 'Optional input extension, with or without the dot, such as "docx" or ".png".',
        },
      },
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const refusal = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

/** Where the result goes when the caller did not say. */
async function freePath(inputPath, target) {
  const dir = dirname(inputPath);
  const stem = basename(inputPath).replace(/\.[^.\/]+$/, '');
  const candidate = join(dir, `${stem}.${target}`);
  // Writing over a file nobody asked us to touch is not ours to decide.
  for (let n = 0; n < 100; n++) {
    const path = n === 0 ? candidate : join(dir, `${stem}-${n}.${target}`);
    try {
      await stat(path);
    } catch {
      return path;
    }
  }
  throw new Error(`No free filename beside ${inputPath}.`);
}

export async function listConversions({ extension } = {}) {
  if (!extension) {
    const sources = knownSources();
    return text(
      `${sources.length} input formats accepted, ${pairCount()} proven conversions in total.\n\n`
      + `${sources.join(', ')}\n\n`
      + 'Call list_conversions with one of these to see its output formats.'
    );
  }

  const targets = targetsFor(extension);
  const clean = String(extension).toLowerCase().replace(/^\./, '');
  if (targets.length === 0) {
    return refusal(
      `.${clean} is not an accepted input format. `
      + 'Call list_conversions with no argument for the full list.'
    );
  }
  return text(
    `.${clean} converts to ${targets.length} formats:\n\n${targets.join(', ')}`
  );
}

export async function convertFile({ path, target, output_path: outputPath } = {}) {
  if (!path) return refusal('No path given.');

  const inputPath = resolve(String(path));
  const plan = planConversion(extensionOf(inputPath), target);
  // The table decides before the network does: an unproven pair never
  // leaves this machine and never costs a credit.
  if (!plan.ok) return refusal(plan.message);

  let bytes;
  try {
    bytes = await readFile(inputPath);
  } catch (e) {
    return refusal(`Cannot read ${inputPath}: ${e?.message || 'no such file'}.`);
  }
  if (bytes.length === 0) return refusal(`${inputPath} is empty.`);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return refusal(
      `${inputPath} is ${(bytes.length / 1048576).toFixed(1)} MB. `
      + `These endpoints accept at most ${MAX_UPLOAD_BYTES / 1048576} MB per file.`
    );
  }

  const answer = await postConversion({
    route: plan.route,
    bytes,
    filename: basename(inputPath),
    source: plan.source,
    target: plan.target,
  });
  if (!answer.ok) return refusal(answer.failure.message);

  let destination;
  try {
    destination = outputPath ? resolve(String(outputPath)) : await freePath(inputPath, plan.target);
    await writeFile(destination, answer.bytes);
  } catch (e) {
    return refusal(`Converted, but could not write the result: ${e?.message}.`);
  }

  return text(
    `Converted ${plan.source} to ${plan.target}.\n`
    + `Written to ${destination} (${answer.bytes.length} bytes).`
  );
}

const HANDLERS = { convert_file: convertFile, list_conversions: listConversions };

export function createServer() {
  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = HANDLERS[request.params.name];
    if (!handler) return refusal(`Unknown tool: ${request.params.name}.`);
    try {
      return await handler(request.params.arguments || {});
    } catch (e) {
      return refusal(`${request.params.name} could not run: ${e?.message || e}.`);
    }
  });

  return server;
}

// Only when run directly, so the tests can import this file without
// taking over stdin and stdout. `pathToFileURL` rather than string
// concatenation: on Windows a path becomes `file:///C:/...`, with three
// slashes, and a naive comparison silently fails.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createServer().connect(new StdioServerTransport());
}
