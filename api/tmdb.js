/* ------------------------------------------------------------
   /api/tmdb - serverless proxy for TMDB search
   ------------------------------------------------------------
   The API key lives in process.env.TMDB_KEY and never leaves the
   server. Two paths:

     /api/tmdb?query=Suspiria   search, returns TMDB's payload
     /api/tmdb?query=It&year=1990   the same, narrowed by year
     /api/tmdb?id=11324         lookup, returns one movie
     /api/tmdb?id=11324&credits=1   the same, with its crew
     /api/tmdb?mode=discover    top-rated horror, paged

   A film is searched for once. After that the client holds its
   TMDB id and comes back through the lookup path, which is exact
   and cannot drift onto a remake.
   ------------------------------------------------------------ */

const TMDB_SEARCH = 'https://api.themoviedb.org/3/search/movie';
const TMDB_MOVIE = 'https://api.themoviedb.org/3/movie/';
const TMDB_DISCOVER = 'https://api.themoviedb.org/3/discover/movie';

const HORROR_GENRE = '27';
const DEFAULT_VOTE_FLOOR = '300';   // below this, obscure titles top a vote_average sort
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function handler(request, response) {
  const key = process.env.TMDB_KEY;

  if (!key) {
    response.status(500).json({ error: 'TMDB_KEY is not configured on the server.' });
    return;
  }

  const params = request.query || {};
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  const mode = typeof params.mode === 'string' ? params.mode.trim() : '';

  if (!query && !id && mode !== 'discover') {
    response.status(400).json({ error: 'A query, id or mode parameter is required.' });
    return;
  }

  let url;

  if (mode === 'discover') {
    const page = String(params.page || '1');
    const floor = String(params['vote_count.gte'] || DEFAULT_VOTE_FLOOR);
    const from = String(params['primary_release_date.gte'] || '');
    const to = String(params['primary_release_date.lte'] || '');

    if (!/^\d{1,3}$/.test(page) || Number(page) < 1 || Number(page) > 500) {
      response.status(400).json({ error: 'page must be between 1 and 500.' });
      return;
    }
    if (!/^\d{1,7}$/.test(floor)) {
      response.status(400).json({ error: 'vote_count.gte must be a number.' });
      return;
    }

    url = new URL(TMDB_DISCOVER);
    url.searchParams.set('with_genres', HORROR_GENRE);
    url.searchParams.set('sort_by', 'vote_average.desc');
    url.searchParams.set('vote_count.gte', floor);
    url.searchParams.set('page', page);
    url.searchParams.set('include_adult', 'false');
    if (ISO_DATE.test(from)) url.searchParams.set('primary_release_date.gte', from);
    if (ISO_DATE.test(to)) url.searchParams.set('primary_release_date.lte', to);
  } else if (id) {
    if (!/^\d+$/.test(id)) {
      response.status(400).json({ error: 'id must be a TMDB movie id.' });
      return;
    }
    url = new URL(TMDB_MOVIE + id);
    /* the detail panel wants a director, the poster service does not */
    if (params.credits === '1' || params.credits === 'true') {
      url.searchParams.set('append_to_response', 'credits');
    }
  } else {
    url = new URL(TMDB_SEARCH);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', 'false');

    /* A year is only sent when the reader typed one. The poster
       service never does: release dates drift between sources, and
       a strict year drops the right film instead of ranking it. */
    const year = typeof params.year === 'string' ? params.year.trim() : '';
    if (/^\d{4}$/.test(year)) url.searchParams.set('primary_release_year', year);
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
