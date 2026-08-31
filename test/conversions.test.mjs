// The table decides. These tests never touch the network.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extensionOf, isKnownSource, knownSources, pairCount, planConversion, targetsFor,
} from '../src/conversions.js';
import { NOMBRE_DE_PAIRES, NOMBRE_DE_SOURCES , ROUTES } from '../src/formats.js';

test('the copied table holds what it claims', () => {
  // Compares avec la table, jamais epingles : ces deux chiffres ont
  // deja vieilli une fois. Le 30/08 la copie annoncait 1392 paires
  // quand le site en servait 2082, et un agent branche dessus se
  // serait vu refuser des conversions que le produit sait faire.
  assert.equal(knownSources().length, NOMBRE_DE_SOURCES);
  assert.equal(pairCount(), NOMBRE_DE_PAIRES);
  assert.ok(pairCount() > 2000, `attendu plus de 2000 paires, vu ${pairCount()}`);
});

test('an extension is read the same with or without a dot, in any case', () => {
  assert.deepEqual(targetsFor('PNG'), targetsFor('.png'));
  assert.equal(extensionOf('C:/a/b/report.DOCX'), 'docx');
  assert.equal(extensionOf('/home/u/notes.md'), 'md');
  assert.equal(extensionOf('/home/u/Makefile'), '');
});

test('each pair goes to the endpoint that actually serves it', () => {
  assert.equal(planConversion('docx', 'pdf').route, '/api/convert-office');
  assert.equal(planConversion('docx', 'html').route, '/api/convert-document');
  assert.equal(planConversion('png', 'jpg').route, '/api/convert-image');
  assert.equal(planConversion('epub', 'mobi').route, '/api/convert-ebook');
});

test('an office file to PDF beats the other families that could claim it', () => {
  // docx is read by both pandoc and calibre, and all three families could
  // answer for PDF. LibreOffice keeps the layout, so it wins.
  for (const ext of ['doc', 'docx', 'xlsx', 'pptx', 'odt', 'rtf', 'csv']) {
    assert.equal(planConversion(ext, 'pdf').route, '/api/convert-office', ext);
  }
  // Ebook sources have no LibreOffice path, so their PDF stays with calibre.
  assert.equal(planConversion('epub', 'pdf').route, '/api/convert-ebook');
});

test('an unproven pair is refused, and the refusal says what would work', () => {
  const plan = planConversion('png', 'docx');
  assert.equal(plan.ok, false);
  assert.match(plan.message, /not a proven conversion/);
  assert.match(plan.message, /Proven targets for \.png/);
  assert.match(plan.message, /\bjpg\b/);
  assert.equal(plan.route, undefined);
});

test('an extension the converter cannot read at all is refused', () => {
  // The example used to be `zip`, and it stopped being true on 30 August
  // when the archive family opened. `rar` replaces it, and it is a better
  // example because it documents a decision rather than an absence:
  // reading RAR needs a non-free binary, and installing one is not a call
  // this repository makes on its own.
  assert.equal(isKnownSource('rar'), false);
  const plan = planConversion('rar', 'md');
  assert.equal(plan.ok, false);
  assert.match(plan.message,
    new RegExp(`not one of the ${NOMBRE_DE_SOURCES} input formats`));
});

test('no format is offered as a conversion of itself', () => {
  for (const source of knownSources()) {
    assert.ok(!targetsFor(source).includes(source), source);
  }
});

test('every pair in the table resolves to an endpoint the module declares', () => {
  // La cinquieme, convert-media, est arrivee le 30/08 avec les 615
  // paires audio et video. Le serveur n'a rien eu a changer : la route
  // vient de la table copiee, et son interface est la meme, un fichier
  // et une cible.
  //
  // Le meme jour, la bureautique est passee de convert-to-pdf, qui ne
  // servait que le PDF, a convert-office, qui sert ses onze cibles. La
  // encore le serveur n'a rien eu a changer.
  //
  // La sixieme, convert-font, est arrivee le 30/08 au soir avec les 18
  // paires de polices. Le serveur n'a toujours rien eu a changer : la
  // route vient de la table copiee, et l'interface est la meme.
  // La liste etait ecrite ici a la main, et une famille de plus l'a
  // laissee en arriere le 31/08 : c'est la quatrieme copie de la meme
  // table a se peremer dans ce depot. Elle vient desormais du module,
  // qui est la seule chose que le serveur consulte pour de bon.
  const endpoints = new Set(Object.values(ROUTES));
  let seen = 0;
  for (const source of knownSources()) {
    for (const target of targetsFor(source)) {
      const plan = planConversion(source, target);
      assert.ok(plan.ok, `${source} to ${target}`);
      assert.ok(endpoints.has(plan.route), `${source} to ${target} -> ${plan.route}`);
      seen++;
    }
  }
  assert.equal(seen, NOMBRE_DE_PAIRES);
});
