// The README's numbers, checked against the table they describe.
//
// The README is what an agent reads before it calls anything. Every claim
// in it is a promise, and the numbers in it have already gone stale once:
// on 30 August the endpoint table still listed four routes and 1392 pairs
// while the server actually carried five routes and 2106. An agent
// reading that would have believed a third of the catalogue did not
// exist, and would never have asked for it.
//
// So the numbers are not maintained by hand here. This file recomputes
// them from `src/formats.js` and fails when the prose has fallen behind.
//
// It does not touch the wording. Prose is written by people; only the
// figures inside it are checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import PAIRS, { NOMBRE_DE_PAIRES, NOMBRE_DE_SOURCES, routePour }
  from '../src/formats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

/**
 * Pairs per ROUTE, counted from the table rather than remembered.
 *
 * It used to count families and then translate them to routes through a
 * map written out by hand, three times, in this file. That map is what
 * went stale: a family opened on 31 August was absent from all three
 * copies, and the test could not see the route it was meant to check.
 * `routePour` is the module's own answer, and there is now one.
 */
function parRoute() {
  const n = {};
  for (const source of Object.keys(PAIRS)) {
    for (const target of Object.keys(PAIRS[source])) {
      const route = routePour(source, target);
      if (!route) continue;
      n[route] = (n[route] || 0) + 1;
    }
  }
  return n;
}

/** The endpoint table's rows: route, announced count. */
function lignesDuTableau() {
  const lignes = [];
  for (const m of README.matchAll(/^\| `(\/api\/[a-z-]+)` \| (\d+) \| /gm)) {
    lignes.push({ route: m[1], compte: Number(m[2]) });
  }
  return lignes;
}

test('the endpoint table lists every route the table uses, and no other', () => {
  const servies = new Set(Object.keys(parRoute()));
  const listees = new Set(lignesDuTableau().map((l) => l.route));

  const manquantes = [...servies].filter((r) => r && !listees.has(r));
  const enTrop = [...listees].filter((r) => !servies.has(r));

  assert.deepEqual(manquantes, [],
    'the README hides routes the table serves: an agent will never ask for them');
  assert.deepEqual(enTrop, [],
    'the README promises routes the table does not serve');
});

test('each announced count matches the table', () => {
  const reels = parRoute();
  for (const { route, compte } of lignesDuTableau()) {
    assert.equal(compte, reels[route],
      `the README says ${compte} pairs for ${route}, the table has ${reels[route]}`);
  }
});

test('the announced counts add up to the whole table', () => {
  // A row can be right individually while the set still leaves pairs
  // unaccounted for: a family with no row at all would pass every check
  // above except this one.
  const somme = lignesDuTableau().reduce((t, l) => t + l.compte, 0);
  assert.equal(somme, NOMBRE_DE_PAIRES,
    `the rows total ${somme}, the table holds ${NOMBRE_DE_PAIRES}: a family has no row`);
});

test('every figure quoted in the prose is the current one', () => {
  // The two headline numbers appear in sentences, not in the table. They
  // are the ones an agent is most likely to repeat back to a user.
  const chiffres = [...README.matchAll(/([\d,]{3,})\s+(?:proven\s+)?(?:conversions|pairs|input formats)/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')));
  assert.ok(chiffres.length > 0, 'the README no longer quotes any figure');

  const permis = new Set([NOMBRE_DE_PAIRES, NOMBRE_DE_SOURCES]);
  const perimes = chiffres.filter((n) => !permis.has(n));
  assert.deepEqual(perimes, [],
    `the README quotes figures that are no longer true: ${perimes.join(', ')}. `
    + `The table holds ${NOMBRE_DE_PAIRES} pairs across ${NOMBRE_DE_SOURCES} sources.`);
});
