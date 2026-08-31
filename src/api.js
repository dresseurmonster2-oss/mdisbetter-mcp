// The HTTP side: two transports, and an honest reading of what comes back.
//
// Small files go straight through in one multipart POST. Large ones go to
// storage first, because the platform hosting the API caps a request body
// AND a response body at 4.5 MB. See SEUIL_DIRECT below.

import { routePour } from './formats.js';

//
// The API key is read from the environment and nowhere else. It is never a
// tool argument, so a model cannot be talked into leaking it, and it is
// never written to a file.

/** Largest body the four conversion endpoints accept, in bytes. */
// Le plafond du MOTEUR, celui des routes de conversion. C'est le vrai
// maximum, et il est desormais atteignable : au-dela de SEUIL_DIRECT le
// fichier passe par le stockage au lieu du corps de la requete.
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

// Le plafond du TRANSPORT, impose par la plateforme qui heberge l'API :
// 4,5 Mo pour un corps de requete comme pour un corps de reponse. On se
// cale a 4 Mo, parce qu'une requete multipart porte des entetes et des
// frontieres en plus du fichier.
const SEUIL_DIRECT = 4 * 1024 * 1024;

// La famille de conversion, deduite de la route. `/api/convert-url` la
// demande par son nom.
function familleDeLaRoute(route) {
  const m = /\/api\/convert-([a-z]+)$/.exec(String(route || ''));
  return m ? m[1] : null;
}

/**
 * Envoi par le stockage : le fichier ne traverse pas l'API.
 *
 * navigateur ou agent -> stockage -> l'API recoit une adresse -> le
 * moteur tire le fichier, convertit, et rend une adresse de resultat que
 * l'on telecharge en direct. Rien de plus gros que quelques centaines
 * d'octets ne passe par une fonction.
 */
async function envoyerParStockage({ bytes, filename, target, key, fetchImpl, timeoutMs, source }) {
  const route = routePour(source, target);
  const famille = familleDeLaRoute(route);
  if (!famille) {
    return { ok: false, failure: { kind: 'unsupported', message: 'This conversion has no storage route.' } };
  }

  let upload;
  try {
    ({ upload } = await import('@vercel/blob/client'));
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: 'Large files need the @vercel/blob package. Run npm install in the server folder.',
      },
    };
  }

  let depose;
  try {
    depose = await upload(`${famille}/${Date.now()}-${filename}`, Buffer.from(bytes), {
      access: 'public',
      handleUploadUrl: `${baseUrl()}/api/convert-token`,
      clientPayload: key,
      multipart: true,
    });
  } catch (e) {
    return {
      ok: false,
      failure: { kind: 'network', message: `Upload failed: ${e?.message || 'no answer'}.` },
    };
  }

  let reponse;
  try {
    reponse = await fetchImpl(`${baseUrl()}/api/convert-url`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ famille, blobUrl: depose.url, target, nom: filename }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, failure: { kind: 'network', message: `Could not reach ${baseUrl()}: ${e?.message || 'no answer'}.` } };
  }
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => null);
    return { ok: false, status: reponse.status, failure: describeFailure(reponse.status, corps, { source, target }) };
  }

  const resultat = await reponse.json().catch(() => null);
  if (!resultat?.fileUrl) {
    return { ok: false, failure: { kind: 'empty', message: 'The service answered without a file address.' } };
  }
  const fichier = await fetchImpl(resultat.fileUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!fichier.ok) {
    return { ok: false, failure: { kind: 'network', message: 'The converted file could not be downloaded.' } };
  }
  const out = Buffer.from(await fichier.arrayBuffer());
  if (out.length === 0) {
    return { ok: false, failure: { kind: 'empty', message: 'The service answered with an empty file. Nothing was written.' } };
  }
  return { ok: true, bytes: out, contentType: resultat.contentType || 'application/octet-stream' };
}

/** Where to top up. Shown whenever the credit wall answers. */
export const TOPUP_URL = 'https://mdisbetter.com/pricing';

export function baseUrl() {
  return (process.env.MDISBETTER_BASE_URL || 'https://mdisbetter.com').replace(/\/+$/, '');
}

export function apiKey() {
  return (process.env.MDISBETTER_API_KEY || '').trim();
}

const megabytes = (n) => (n / (1024 * 1024)).toFixed(1);

/**
 * Turn an HTTP status into something an agent can act on.
 *
 * Pure on purpose: every branch below is testable without a network and
 * without a key.
 *
 * 402 is the one that matters. It is not a fault and must never be worded
 * as one: the account is out of credits, the wall did its job, and the
 * answer is to top up. Saying "failed" there would send an agent hunting
 * for a bug that does not exist.
 */
export function describeFailure(status, body, { source, target } = {}) {
  const serverSaid = typeof body?.error === 'string' ? body.error : '';

  if (status === 402) {
    const needed = body?.credits_needed;
    const remaining = body?.credits_remaining;
    const lines = [];

    if (typeof needed === 'number' && typeof remaining === 'number') {
      const missing = Math.max(0, needed - remaining);
      lines.push(
        `Out of credits. This conversion costs ${needed} credit${needed === 1 ? '' : 's'}, `
        + `${remaining} remain, so ${missing} more ${missing === 1 ? 'is' : 'are'} needed.`
      );
    } else {
      lines.push(`Out of credits.${serverSaid ? ` ${serverSaid}` : ''}`);
    }

    const packs = Array.isArray(body?.offer?.packs) ? body.offer.packs : [];
    for (const p of packs) {
      if (p?.credits && p?.price) lines.push(`Top-up pack: ${p.credits} credits for ${p.price}.`);
    }
    const subscribe = body?.offer?.subscribe;
    if (subscribe?.plan && subscribe?.credits) {
      lines.push(`Plan ${subscribe.plan} includes ${subscribe.credits} credits per month.`);
    }

    lines.push(`Top up at ${TOPUP_URL} and call this tool again. The file was not converted.`);
    return { kind: 'credits', message: lines.join(' ') };
  }

  if (status === 401) {
    return {
      kind: 'auth',
      message: 'The API key was rejected: missing, invalid, or revoked. Set MDISBETTER_API_KEY '
        + 'in this server\'s environment to a key starting with mdb_sk_. It is read from the '
        + 'environment only, never from a tool argument.',
    };
  }

  if (status === 415) {
    const pair = source && target ? `${source} to ${target}` : 'this conversion';
    return {
      kind: 'unsupported',
      message: `The converter did not accept the file for ${pair}. The pair itself is proven, `
        + 'so the file is the problem: its contents may not match its extension, or the engine '
        + 'could not read it.',
    };
  }

  if (status === 413) {
    return {
      kind: 'too-large',
      message: `File too large. These endpoints accept at most ${megabytes(MAX_UPLOAD_BYTES)} MB per file.`,
    };
  }

  if (status === 429) {
    return {
      kind: 'busy',
      message: 'The converter is at capacity and shed this request on purpose rather than '
        + 'degrading for everyone. Nothing is broken and nothing was charged. Wait a few '
        + 'seconds and call convert_file again.',
    };
  }

  if (status === 503) {
    return { kind: 'unavailable', message: 'The conversion service is unavailable right now. Retry later.' };
  }

  if (status === 504) {
    return { kind: 'timeout', message: 'The conversion timed out before the file came back.' };
  }

  return {
    kind: 'upstream',
    message: `The conversion service returned HTTP ${status}${serverSaid ? `: ${serverSaid}` : '.'}`,
  };
}

/**
 * Send one file and get the converted bytes back.
 *
 * Every endpoint takes the target as a form field. `/api/convert-to-pdf`
 * was the one exception, its output being always PDF, and it is no longer
 * reachable from the table: since 30 August the office family goes through
 * `/api/convert-office`, which serves eleven targets and REFUSES a request
 * that names none. Sending the file alone there would have failed every
 * office conversion an agent asked for, with a message about a missing
 * target that the agent had in fact supplied.
 *
 * The exception is kept for the one route that still has it, so a caller
 * reaching convert-to-pdf directly keeps working.
 */
export async function postConversion({ route, bytes, filename, source, target, timeoutMs = 120000, fetchImpl = fetch }) {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      failure: {
        kind: 'auth',
        message: 'No API key. Set MDISBETTER_API_KEY in this server\'s environment to a key '
          + 'starting with mdb_sk_, then start the server again.',
      },
    };
  }

  // DEUX VOIES, ET LE SEUIL N'EST PAS UN REGLAGE.
  // La plateforme qui heberge l'API plafonne a 4,5 Mo le corps d'une
  // requete comme celui d'une reponse. Mesure du 31/08/2026 par paliers
  // de 100 Ko : 4,2 Mo passent, 4,3 Mo rendent un 413 emis avant meme que
  // la fonction s'execute. Ce serveur annoncait 25 Mo, chiffre exact du
  // cote du moteur et inatteignable du cote du transport.
  //
  // Au-dela du seuil, le fichier va d'abord au stockage et seule son
  // adresse traverse l'API. C'est le meme chemin que le site utilise
  // depuis son navigateur, et il porte les plafonds reels des routes.
  if (bytes.length > SEUIL_DIRECT) {
    return await envoyerParStockage({ bytes, filename, target, key, fetchImpl, timeoutMs, source });
  }

  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  if (route !== '/api/convert-to-pdf') form.append('target', target);

  let response;
  try {
    response = await fetchImpl(baseUrl() + route, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: `Could not reach ${baseUrl()}: ${e?.message || 'no answer'}.`,
      },
    };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, status: response.status, failure: describeFailure(response.status, body, { source, target }) };
  }

  const out = Buffer.from(await response.arrayBuffer());
  if (out.length === 0) {
    return {
      ok: false,
      failure: { kind: 'empty', message: 'The service answered with an empty file. Nothing was written.' },
    };
  }
  return { ok: true, bytes: out, contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
