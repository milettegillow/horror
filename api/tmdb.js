/* ------------------------------------------------------------
   /api/tmdb - serverless proxy for TMDB search
   ------------------------------------------------------------
   The API key lives in process.env.TMDB_KEY and never leaves the
   server. The browser calls /api/tmdb?query=Suspiria&year=1977
   and receives TMDB's search payload untouched.
   ------------------------------------------------------------ */

const TMDB_SEARCH = 'https://api.themoviedb.org/3/search/movie';

module.exports = async function handler(request, response) {
  const key = process.env.TMDB_KEY;

  if (!key) {
    response.status(500).json({ error: 'TMDB_KEY is not configured on the server.' });
    return;
  }

  const params = request.query || {};
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const year = typeof params.year === 'string' ? params.year.trim() : '';

  if (!query) {
    response.status(400).json({ error: 'A query parameter is required.' });
    return;
  }

  const url = new URL(TMDB_SEARCH);
  url.searchParams.set('api_key', key);
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'en-GB');
  if (/^\d{4}$/.test(year)) {
    url.searchParams.set('primary_release_year', year);
  }

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
