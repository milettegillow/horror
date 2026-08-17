/* ------------------------------------------------------------
   /api/tmdb - serverless proxy for TMDB search
   ------------------------------------------------------------
   The API key lives in process.env.TMDB_KEY and never leaves the
   server. Two paths:

     /api/tmdb?query=Suspiria   search, returns TMDB's payload
     /api/tmdb?id=11324         lookup, returns one movie

   A film is searched for once. After that the client holds its
   TMDB id and comes back through the lookup path, which is exact
   and cannot drift onto a remake.
   ------------------------------------------------------------ */

const TMDB_SEARCH = 'https://api.themoviedb.org/3/search/movie';
const TMDB_MOVIE = 'https://api.themoviedb.org/3/movie/';

module.exports = async function handler(request, response) {
  const key = process.env.TMDB_KEY;

  if (!key) {
    response.status(500).json({ error: 'TMDB_KEY is not configured on the server.' });
    return;
  }

  const params = request.query || {};
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const id = typeof params.id === 'string' ? params.id.trim() : '';

  if (!query && !id) {
    response.status(400).json({ error: 'A query or id parameter is required.' });
    return;
  }

  let url;

  if (id) {
    if (!/^\d+$/.test(id)) {
      response.status(400).json({ error: 'id must be a TMDB movie id.' });
      return;
    }
    url = new URL(TMDB_MOVIE + id);
  } else {
    url = new URL(TMDB_SEARCH);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', 'false');
    /* No year filter. Release dates drift between sources, and a
       strict year drops the right film instead of ranking it. The
       client scores the results and decides. */
  }

  url.searchParams.set('api_key', key);
  url.searchParams.set('language', 'en-GB');

  try {
    const result = await fetch(url, { headers: { Accept: 'application/json' } });

    if (!result.ok) {
      response.status(result.status).json({ error: 'TMDB rejected the request.' });
      return;
    }

    const data = await result.json();

    /* Posters do not change - let the edge hold onto them for a day. */
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    response.status(200).json(data);
  } catch (error) {
    response.status(502).json({ error: 'Could not reach TMDB.' });
  }
};
