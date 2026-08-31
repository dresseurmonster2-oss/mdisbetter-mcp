// What can be converted into what, and which endpoint serves each pair.
//
// Everything here is pure: no network, no filesystem. A pair that is not
// in the table is refused here, before a single byte leaves the machine.

import { PAIRES, ciblesPour, routePour, sourcesConnues } from './formats.js';

/** Lowercase, no leading dot: `.PNG` and `png` are the same extension. */
export function normalise(extension) {
  return String(extension || '').toLowerCase().replace(/^\./, '').trim();
}

/** The extension of a path, without the dot. Empty string if it has none. */
export function extensionOf(filePath) {
  const base = String(filePath || '').split(/[\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? normalise(base.slice(dot + 1)) : '';
}

/** Every input extension the converter accepts, sorted. */
export function knownSources() {
  return sourcesConnues();
}

/** Proven output formats for this input extension, sorted. [] if unknown. */
export function targetsFor(extension) {
  return ciblesPour(normalise(extension));
}

/** True when the converter can read files with this extension at all. */
export function isKnownSource(extension) {
  return Object.prototype.hasOwnProperty.call(PAIRES, normalise(extension));
}

/**
 * Decide what to do with a pair.
 *
 * Returns `{ ok: true, route }` for a proven pair, and `{ ok: false,
 * message }` otherwise. The refusal carries the list of targets that do
 * work, so the caller can correct itself in one step instead of probing.
 */
export function planConversion(sourceExtension, targetExtension) {
  const source = normalise(sourceExtension);
  const target = normalise(targetExtension);

  if (!source) {
    return {
      ok: false,
      message: 'The file has no extension, so its format cannot be told. '
        + 'Rename it with the extension that matches its contents.',
    };
  }
  if (!target) {
    return {
      ok: false,
      message: `No output format given. Proven targets for .${source}: `
        + `${targetsFor(source).join(', ') || 'none'}.`,
    };
  }
  if (!isKnownSource(source)) {
    return {
      ok: false,
      message: `.${source} is not one of the ${knownSources().length} input formats this `
        + `converter accepts. Call list_conversions with no argument for the full list.`,
    };
  }

  const route = routePour(source, target);
  if (!route) {
    const possibles = targetsFor(source);
    return {
      ok: false,
      message: `.${source} to .${target} is not a proven conversion. `
        + `Proven targets for .${source} (${possibles.length}): ${possibles.join(', ')}.`,
    };
  }

  return { ok: true, route, source, target };
}

/** How many proven pairs each endpoint serves. Used by the README and tests. */
export function pairCount() {
  let total = 0;
  for (const cibles of Object.values(PAIRES)) total += Object.keys(cibles).length;
  return total;
}
