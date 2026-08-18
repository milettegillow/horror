/* ------------------------------------------------------------
   /api/collection - the collection, kept in Upstash Redis
   ------------------------------------------------------------
   GET   public. Returns the stored collection. If the key is
         empty the seed is written and returned.
   POST  gated on the PIN in the x-edit-pin header, checked
         against EDIT_PIN. Replaces the whole collection.

   The Upstash URL and token, and the PIN, are read from the
   environment and never leave this function. The browser never
   sees any of them - it only ever talks to this route.
   ------------------------------------------------------------ */

const SEED = require('./seed.js');

const KEY = 'horror:collection';
const PIN_HEADER = 'x-edit-pin';
const STATUSES = ['to_watch', 'watched', 'banished'];

function level(value) {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

/* One film, coerced into shape. Keeps a bad POST from putting a
   malformed record into the collection. */
function film(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.title !== 'string' || !raw.title) return null;

  return {
    id: raw.id,
    title: raw.title,
    year: Number(raw.year) || null,
    director: typeof raw.director === 'string' ? raw.director : '',
    posterUrl: typeof raw.posterUrl === 'string' ? raw.posterUrl : '',
    tmdbId: Number(raw.tmdbId) || null,
    status: STATUSES.indexOf(raw.status) > -1 ? raw.status : null,
    enjoyment: level(raw.enjoyment),
    fear: level(raw.fear),
    review: typeof raw.review === 'string' ? raw.review : '',
    yearWatched: typeof raw.yearWatched === 'string' ? raw.yearWatched : ''
  };
}

function collection(value) {
  if (!Array.isArray(value)) return null;
  const films = value.map(film).filter(Boolean);
  return films.length || value.length === 0 ? films : null;
}

/* length-independent comparison, so a wrong PIN cannot be timed */
function pinMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (!given || !expected) return false;

  const length = Math.max(given.length, expected.length);
  let difference = given.length ^ expected.length;
  for (let i = 0; i < length; i += 1) {
    difference |= given.charCodeAt(i % given.length) ^ expected.charCodeAt(i % expected.length);
  }
  return difference === 0;
}

function redis(path, options) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  return fetch(base.replace(/\/$/, '') + path, Object.assign({
    headers: { Authorization: 'Bearer ' + token }
  }, options || {}));
}

async function readCollection() {
  const response = await redis('/get/' + KEY);
  if (!response.ok) throw new Error('Redis replied ' + response.status);

  const payload = await response.json();
  if (payload.result === null || payload.result === undefined) return null;

  try {
    return collection(JSON.parse(payload.result));
  } catch (error) {
    return null;   // unreadable value: treated as absent
  }
}

async function writeCollection(films) {
  const response = await redis('/set/' + KEY, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN,
      'Content-Type': 'text/plain'
    },
    body: JSON.stringify(films)
  });

  if (!response.ok) throw new Error('Redis replied ' + response.status);
  return films;
}

module.exports = async function handler(request, response) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    response.status(500).json({ error: 'Upstash is not configured on the server.' });
    return;
  }

  /* ---- read: open to anyone ---- */
  if (request.method === 'GET') {
    try {
      const stored = await readCollection();
      if (stored) {
        response.setHeader('Cache-Control', 'no-store');
        response.status(200).json(stored);
        return;
      }

      const seeded = await writeCollection(collection(SEED) || []);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json(seeded);
    } catch (error) {
      response.status(502).json({ error: 'The collection could not be read.' });
    }
    return;
  }

  /* ---- write: PIN only ---- */
  if (request.method === 'POST') {
    if (!process.env.EDIT_PIN) {
      response.status(500).json({ error: 'No edit PIN is configured on the server.' });
      return;
    }

    const given = request.headers[PIN_HEADER];
    if (!pinMatches(Array.isArray(given) ? given[0] : given, process.env.EDIT_PIN)) {
      response.status(401).json({ error: 'That PIN was not accepted.' });
      return;
    }

    let body = request.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (error) {
        response.status(400).json({ error: 'The body was not valid JSON.' });
        return;
      }
    }

    const films = collection(body && body.films !== undefined ? body.films : body);
    if (!films) {
      response.status(400).json({ error: 'The body did not hold a collection.' });
      return;
    }

    try {
      const saved = await writeCollection(films);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json(saved);
    } catch (error) {
      response.status(502).json({ error: 'The collection could not be saved.' });
    }
    return;
  }

  response.setHeader('Allow', 'GET, POST');
  response.status(405).json({ error: 'Only GET and POST are supported.' });
};
