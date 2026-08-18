/* ============================================================
   horror - a ledger of the gothic
   ------------------------------------------------------------
   Section 1  Data layer      (swap for API + database later)
   Section 2  Poster service  (TMDB, through /api/tmdb)
   Section 3  View state and vocabulary
   Section 4  Rendering
   Section 5  Events
   ============================================================ */


/* ------------------------------------------------------------
   0. STORAGE
   ------------------------------------------------------------
   The only part of the app that knows where the collection is
   kept. Everything else goes through Store.get and Store.save.
   Swapping localStorage for Supabase means rewriting this block
   and nothing else.

   Writes are debounced, so typing a review does not hammer the
   disk. Anything unreadable is treated as absent - a corrupt
   value falls back to the seed rather than throwing.
   ------------------------------------------------------------ */

const STATUSES_ALLOWED = ['to_watch', 'watched', 'banished'];

const Store = (function () {
  const KEY = 'horror.collection.v1';
  const DELAY = 500;
  let timer = null;

  /* private browsing and disabled storage both throw on write */
  const usable = (function () {
    try {
      const probe = '__horror_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      console.warn('horror: local storage is unavailable, this session will not be saved');
      return false;
    }
  })();

  function level(value) {
    return value === 1 || value === 2 || value === 3 ? value : null;
  }

  /* One film, coerced into shape. Unknown fields are dropped and
     missing ones defaulted, so an older or hand-edited file cannot
     put a malformed record into the collection. */
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
      status: STATUSES_ALLOWED.indexOf(raw.status) > -1 ? raw.status : null,
      enjoyment: level(raw.enjoyment),
      fear: level(raw.fear),
      review: typeof raw.review === 'string' ? raw.review : '',
      yearWatched: typeof raw.yearWatched === 'string' ? raw.yearWatched : ''
    };
  }

  function collection(value) {
    if (!Array.isArray(value)) return null;
    const films = value.map(film).filter(Boolean);
    return films.length ? films : null;
  }

  function write(films) {
    if (!usable) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(films));
    } catch (error) {
      console.warn('horror: the collection could not be saved - ' + (error && error.message));
    }
  }

  return {
    normalise: collection,

    get: function () {
      if (!usable) return null;
      let raw = null;
      try {
        raw = window.localStorage.getItem(KEY);
      } catch (error) {
        return null;
      }
      if (!raw) return null;

      try {
        return collection(JSON.parse(raw));
      } catch (error) {
        console.warn('horror: the stored collection could not be read, falling back to the seed');
        return null;
      }
    },

    save: function (films) {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        timer = null;
        write(films);
      }, DELAY);
    },

    saveNow: function (films) {
      if (timer) { window.clearTimeout(timer); timer = null; }
      write(films);
    }
  };
})();


/* ------------------------------------------------------------
   1. DATA LAYER
   ------------------------------------------------------------
   Everything below this comment block is the only part that
   knows where films come from. The renderer never touches the
   array directly - it asks Archive for copies and posts changes
   back through Archive.update(). Replacing SEED_FILMS with a
   fetch and Archive.update() with a PATCH is the whole job.

   film = {
     id, title, year, director, posterUrl, tmdbId,
     status:    "to_watch" | "watched" | "banished" | null,
                (null means no opinion: in no tab, back in Discover)
     enjoyment: 1 | 2 | 3 | null,   // how much I liked it
     fear:      1 | 2 | 3 | null,   // how scary it was
     review:    string,
     yearWatched: string
   }

   posterUrl and tmdbId start empty and are filled in at runtime
   by the poster service below. Until then the tile draws its
   plate. Once tmdbId is known it is the canonical reference to
   the film on TMDB - no further searching is done.
   ------------------------------------------------------------ */

const SEED_FILMS = [
  {
    id: 'nosferatu-1922',
    title: 'Nosferatu',
    year: 1922,
    director: 'F. W. Murnau',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 3,
    fear: 2,
    review: 'The frightening thing is the rhythm - Orlok never gives chase, he simply arrives. A century on and the shadow climbing the staircase still needs no sound to work.',
    yearWatched: '2023'
  },
  {
    id: 'vampyr-1932',
    title: 'Vampyr',
    year: 1932,
    director: 'Carl Theodor Dreyer',
    posterUrl: '',
    tmdbId: null,
    status: 'to_watch',
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  },
  {
    id: 'black-sunday-1960',
    title: 'Black Sunday',
    year: 1960,
    director: 'Mario Bava',
    posterUrl: '',
    tmdbId: null,
    status: 'to_watch',
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  },
  {
    id: 'the-innocents-1961',
    title: 'The Innocents',
    year: 1961,
    director: 'Jack Clayton',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 3,
    fear: 3,
    review: 'Ambiguity held for a hundred minutes without once wobbling. Deborah Kerr plays it as devotion rather than hysteria, which is precisely what makes the last shot unbearable.',
    yearWatched: '2024'
  },
  {
    id: 'dont-look-now-1973',
    title: "Don't Look Now",
    year: 1973,
    director: 'Nicolas Roeg',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 3,
    fear: 2,
    review: 'The editing is the horror. Venice as a cold labyrinth of scaffolding and canal water, and grief filed down until it has an edge.',
    yearWatched: '2024'
  },
  {
    id: 'suspiria-1977',
    title: 'Suspiria',
    year: 1977,
    director: 'Dario Argento',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 1,
    fear: 3,
    review: '',
    yearWatched: '2022'
  },
  {
    id: 'the-shining-1980',
    title: 'The Shining',
    year: 1980,
    director: 'Stanley Kubrick',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 3,
    fear: 2,
    review: 'Colder than it is frightening, and far better for it. The Overlook is a floor plan that refuses to add up and the film trusts you to notice on your own.',
    yearWatched: '2021'
  },
  {
    id: 'the-company-of-wolves-1984',
    title: 'The Company of Wolves',
    year: 1984,
    director: 'Neil Jordan',
    posterUrl: '',
    tmdbId: null,
    status: 'to_watch',
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  },
  {
    id: 'bram-stokers-dracula-1992',
    title: "Bram Stoker's Dracula",
    year: 1992,
    director: 'Francis Ford Coppola',
    posterUrl: '',
    tmdbId: null,
    status: 'banished',
    enjoyment: 1,
    fear: 1,
    review: 'All that money and not one still moment in it. Sent away for being exhausting rather than for being bad.',
    yearWatched: '2019'
  },
  {
    id: 'the-others-2001',
    title: 'The Others',
    year: 2001,
    director: 'Alejandro Amenábar',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 2,
    fear: 3,
    review: '',
    yearWatched: '2020'
  },
  {
    id: 'crimson-peak-2015',
    title: 'Crimson Peak',
    year: 2015,
    director: 'Guillermo del Toro',
    posterUrl: '',
    tmdbId: null,
    status: 'watched',
    enjoyment: 3,
    fear: 1,
    review: 'Less a ghost story than a gothic romance that lets the damp show. The house gives the finest performance in it, and the clay does the rest.',
    yearWatched: '2023'
  },
  {
    id: 'the-witch-2015',
    title: 'The Witch',
    year: 2015,
    director: 'Robert Eggers',
    posterUrl: '',
    tmdbId: null,
    status: 'to_watch',
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  },
  {
    id: 'hereditary-2018',
    title: 'Hereditary',
    year: 2018,
    director: 'Ari Aster',
    posterUrl: '',
    tmdbId: null,
    status: 'banished',
    enjoyment: 1,
    fear: 3,
    review: '',
    yearWatched: '2019'
  },
  {
    id: 'saint-maud-2020',
    title: 'Saint Maud',
    year: 2020,
    director: 'Rose Glass',
    posterUrl: '',
    tmdbId: null,
    status: 'to_watch',
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  }
];

const Archive = (function () {
  const stored = Store.get();
  const films = stored || SEED_FILMS.map(function (film) { return Object.assign({}, film); });

  /* first visit: lay the seed down straight away */
  if (!stored) Store.saveNow(films);

  function copy(film) { return Object.assign({}, film); }
  function persist() { Store.save(films); }

  return {
    all: function () { return films.map(copy); },
    byStatus: function (status) {
      return films
        .filter(function (film) { return film.status === status; })
        .sort(function (a, b) { return (a.year || 0) - (b.year || 0); })
        .map(copy);
    },
    get: function (id) {
      const film = films.find(function (f) { return f.id === id; });
      return film ? copy(film) : null;
    },
    count: function (status) {
      return films.filter(function (film) { return film.status === status; }).length;
    },
    add: function (film) {
      if (films.some(function (existing) { return existing.id === film.id; })) return null;
      films.push(Object.assign({}, film));
      persist();
      return copy(film);
    },
    update: function (id, patch) {
      const film = films.find(function (f) { return f.id === id; });
      if (!film) return null;
      Object.assign(film, patch);
      persist();
      return copy(film);
    },
    /* wholesale replacement, used by import */
    replace: function (incoming) {
      films.length = 0;
      incoming.forEach(function (film) { films.push(Object.assign({}, film)); });
      Store.saveNow(films);
    }
  };
})();


/* ------------------------------------------------------------
   2. POSTER SERVICE
   ------------------------------------------------------------
   Posters come from TMDB by way of /api/tmdb, which holds the
   API key server-side. Results are cached in memory by film id,
   including misses, so switching tabs never refetches.

   Nothing here can produce a broken image: the URL is loaded
   into a detached Image first, and only a poster that decodes
   cleanly is ever put into the grid. Everything else - no
   network, no result, no key, a dead path - simply leaves the
   ornamental plate in place.
   ------------------------------------------------------------ */

const TMDB_ENDPOINT = '/api/tmdb';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

/* ---- choosing the right film out of a search ----------------
   Title dominates: the tiers are far enough apart that no amount
   of year or popularity can promote a film with the wrong name.
   Year only nudges, and never disqualifies - a release date that
   disagrees with the seed data by a decade still leaves the film
   eligible, it just stops being the obvious answer. Votes settle
   ties, so a real film always beats an obscure namesake.
   ------------------------------------------------------------ */

const TITLE_EXACT = 1000;
const TITLE_PREFIX = 600;
const TITLE_PARTIAL = 300;
const YEAR_CLOSE = 120;   // within 1 year
const YEAR_NEAR = 60;     // within 3 years
const YEAR_FAR = 5;       // anything else: near zero, still eligible
const VOTE_WEIGHT = 40;   // less than one year tier, so it only breaks ties
const VOTE_CEILING = 4000;

/* fold case, accents and punctuation, so "Bram Stoker's Dracula"
   and "Bram Stokers Dracula" are the same string */
function normalise(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleScore(result, target) {
  const candidates = [normalise(result.title), normalise(result.original_title)];
  let best = 0;

  candidates.forEach(function (candidate) {
    if (!candidate) return;
    let score = 0;
    if (candidate === target) score = TITLE_EXACT;
    else if (candidate.indexOf(target) === 0) score = TITLE_PREFIX;
    else if (candidate.indexOf(target) > -1 || target.indexOf(candidate) > -1) score = TITLE_PARTIAL;
    if (score > best) best = score;
  });

  return best;
}

function yearScore(result, year) {
  const released = Number(String(result.release_date || '').slice(0, 4));
  if (!released) return YEAR_FAR;
  const distance = Math.abs(released - year);
  if (distance <= 1) return YEAR_CLOSE;
  if (distance <= 3) return YEAR_NEAR;
  return YEAR_FAR;
}

function voteScore(result) {
  const votes = Math.max(0, Number(result.vote_count) || 0);
  return (Math.min(votes, VOTE_CEILING) / VOTE_CEILING) * VOTE_WEIGHT;
}

function scoreResult(result, film) {
  const title = titleScore(result, normalise(film.title));
  if (!title) return 0;   // the name has to appear at all
  return title + yearScore(result, film.year) + voteScore(result);
}

function pickResult(results, film) {
  let best = null;
  let bestScore = 0;

  results.forEach(function (result) {
    /* a match with no artwork is no use to a poster grid */
    if (!result || !result.poster_path) return;
    const score = scoreResult(result, film);
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  });

  return best;
}

const Posters = (function () {
  const cache = new Map();     // film id -> poster URL, or '' for "none found"
  const pending = new Set();

  function settle(film, url, reason) {
    pending.delete(film.id);
    cache.set(film.id, url);
    if (!url) {
      console.warn('horror: no poster for ' + film.title + ' (' + film.year + ') - ' +
        (reason || 'unknown reason'));
      return;
    }
    Archive.update(film.id, { posterUrl: url });
    paintPoster(film.id, url);
  }

  /* Decode before display, so a tile never flickers through a
     half-drawn or dead image. */
  function preload(film, url) {
    const probe = new Image();
    probe.onload = function () { settle(film, url); };
    probe.onerror = function () { settle(film, '', 'the poster image would not load'); };
    probe.src = url;
  }

  /* Search by title, then take the best result rather than the
     first. TMDB orders by popularity, so the 2024 Nosferatu and
     the 2018 Suspiria both outrank the films we actually want. */
  function search(film) {
    fetch(TMDB_ENDPOINT + '?query=' + encodeURIComponent(film.title))
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        const results = data && Array.isArray(data.results) ? data.results : [];
        const match = pickResult(results, film);
        if (!match) {
          settle(film, '', 'no result matched the title');
          return;
        }
        Archive.update(film.id, { tmdbId: match.id });
        preload(film, POSTER_BASE + match.poster_path);
      })
      .catch(function () { settle(film, '', 'the search request failed'); });
  }

  /* Already resolved once: go straight to the film by id. */
  function lookup(film) {
    fetch(TMDB_ENDPOINT + '?id=' + encodeURIComponent(film.tmdbId))
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (movie) {
        if (movie && movie.poster_path) {
          preload(film, POSTER_BASE + movie.poster_path);
        } else {
          settle(film, '', 'lookup by id returned no poster');
        }
      })
      .catch(function () { settle(film, '', 'the lookup request failed'); });
  }

  return {
    urlFor: function (id) { return cache.get(id) || ''; },
    load: function (film) {
      if (cache.has(film.id) || pending.has(film.id)) return;
      pending.add(film.id);
      if (film.tmdbId) { lookup(film); } else { search(film); }
    },
    loadAll: function (films) {
      films.forEach(function (film) { Posters.load(film); });
    }
  };
})();


/* ------------------------------------------------------------
   3. VIEW STATE AND VOCABULARY
   ------------------------------------------------------------ */

const TABS = [
  { id: 'to_watch', label: 'To Watch', counted: true },
  { id: 'watched',  label: 'Watched',  counted: true },
  { id: 'discover', label: 'Discover', counted: false },
  { id: 'banished', label: 'Banished', counted: true }
];

const STATUSES = [
  { value: 'to_watch', label: 'To Watch' },
  { value: 'watched',  label: 'Watched' },
  { value: 'banished', label: 'Banished' }
];

/* Two independent scales. Both optional, both deselectable. */
const RATINGS = {
  enjoyment: {
    key: 'enjoyment',
    legend: 'how much I liked it',
    icon: 'ico-heart',
    labels: { 1: 'meh', 2: 'liked it', 3: 'loved it' }
  },
  fear: {
    key: 'fear',
    legend: 'how scary it was',
    icon: 'ico-ghost',
    labels: { 1: 'mild', 2: 'unsettling', 3: 'terrifying' }
  }
};

/* Discover: decade windows and the client-side rating floor */
const DECADES = [
  { value: 'all', label: 'All' },
  { value: '1920', label: '1920s' }, { value: '1930', label: '1930s' },
  { value: '1940', label: '1940s' }, { value: '1950', label: '1950s' },
  { value: '1960', label: '1960s' }, { value: '1970', label: '1970s' },
  { value: '1980', label: '1980s' }, { value: '1990', label: '1990s' },
  { value: '2000', label: '2000s' }, { value: '2010', label: '2010s' },
  { value: '2020', label: '2020s' }
];

const RATING_FLOORS = [
  { value: 'all', label: 'All' },
  { value: '6', label: '6+' },
  { value: '7', label: '7+' },
  { value: '8', label: '8+' }
];

const DISCOVER_STATES = {
  loading: {
    kicker: 'Consulting the archive',
    title: 'Turning the pages',
    body: 'Sorting the highly regarded from the merely notorious. This takes a moment - the archive is large and its cataloguing is eccentric.'
  },
  empty: {
    kicker: 'Nothing further',
    title: 'The well is dry',
    body: 'Everything the archive will admit to at this rating is already on your shelves, or was never worth admitting to. Loosen the decade, lower the rating, or take the hint and go to bed.'
  },
  error: {
    kicker: 'No reply',
    title: 'The archive stays shut',
    body: 'The request went out and nothing came back. This is usually a missing key or a lost connection rather than anything sinister, though one can never be certain.'
  }
};

const EMPTY_STATES = {
  to_watch: {
    kicker: 'The shelf is bare',
    title: 'Nothing waiting',
    body: 'Every film has been seen or sent away, and the shelf stands empty for the first time in years. Something will turn up - it always does, usually at an unsociable hour.'
  },
  watched: {
    kicker: 'No records',
    title: 'Nothing watched yet',
    body: 'The ledger begins the moment you finish the first one. Until then these pages stay blank, which is either restraint or cowardice, depending on the evening.'
  },
  banished: {
    kicker: 'Mercifully quiet',
    title: 'Nothing banished',
    body: 'No film has yet earned its way out of the collection. Banishment is reserved for the truly unforgivable, and the truly unforgivable has not been screened here yet.'
  }
};

let activeTab = 'to_watch';
let openFilmId = null;
let lastFocused = null;

const dom = {
  tabs: document.getElementById('tabs'),
  collection: document.getElementById('collection'),
  scrim: document.getElementById('scrim'),
  panel: document.getElementById('panel'),
  panelClose: document.getElementById('panelClose'),
  panelTitle: document.getElementById('panelTitle'),
  panelSub: document.getElementById('panelSub'),
  statusGroup: document.getElementById('statusGroup'),
  enjoymentGroup: document.getElementById('enjoymentGroup'),
  fearGroup: document.getElementById('fearGroup'),
  yearWatched: document.getElementById('yearWatched'),
  review: document.getElementById('review'),
  colophonCount: document.getElementById('colophonCount'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  confirmScrim: document.getElementById('confirmScrim'),
  confirmPanel: document.getElementById('confirmPanel'),
  confirmEyebrow: document.getElementById('confirmEyebrow'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmBody: document.getElementById('confirmBody'),
  confirmYes: document.getElementById('confirmYes'),
  confirmNo: document.getElementById('confirmNo')
};



/* ------------------------------------------------------------
   DISCOVER
   ------------------------------------------------------------
   Top-rated horror from TMDB, minus anything already on the
   shelves. Filtering shrinks each page, so a fill keeps pulling
   pages until the grid has enough or the cap is reached.
   ------------------------------------------------------------ */

const DISCOVER_TARGET = 20;      // results wanted per fill
const DISCOVER_MAX_PAGES = 6;    // pages crawled per fill, so a heavily
                                 // filtered decade cannot spin forever

const Discover = (function () {
  const state = {
    decade: 'all',
    minRating: 'all',
    page: 0,
    results: [],
    seen: new Set(),
    status: 'idle',      // idle | loading | more | ready | error
    reason: '',
    exhausted: false
  };

  function decadeWindow(decade) {
    if (decade === 'all') return null;
    const start = Number(decade);
    return { from: start + '-01-01', to: (start + 9) + '-12-31' };
  }

  function endpoint(page) {
    const parts = ['mode=discover', 'page=' + page];
    const window = decadeWindow(state.decade);
    if (window) {
      parts.push('primary_release_date.gte=' + window.from);
      parts.push('primary_release_date.lte=' + window.to);
    }
    return TMDB_ENDPOINT + '?' + parts.join('&');
  }

  /* Everything with a standing, by TMDB id where we have one.
     Title and year is a backstop for films whose poster lookup has
     not landed yet, so a seed film cannot briefly reappear here. */
  function collected() {
    const ids = new Set();
    const names = new Set();
    Archive.all().forEach(function (film) {
      /* no standing means no opinion, so it belongs back in Discover */
      if (film.status === null) return;
      if (film.tmdbId) ids.add(film.tmdbId);
      names.add(normalise(film.title) + '|' + film.year);
    });
    return { ids: ids, names: names };
  }

  function eligible(results) {
    const mine = collected();
    const floor = state.minRating === 'all' ? 0 : Number(state.minRating);

    return results.filter(function (result) {
      if (!result || !result.id) return false;
      if (state.seen.has(result.id)) return false;
      if (mine.ids.has(result.id)) return false;

      const year = Number(String(result.release_date || '').slice(0, 4)) || null;
      if (mine.names.has(normalise(result.title) + '|' + year)) return false;
      if ((Number(result.vote_average) || 0) < floor) return false;

      state.seen.add(result.id);
      return true;
    });
  }

  function fetchPage(page) {
    return fetch(endpoint(page))
      .then(function (response) {
        if (!response.ok) throw new Error('the archive replied ' + response.status);
        return response.json();
      })
      .then(function (data) {
        return {
          results: Array.isArray(data.results) ? data.results : [],
          totalPages: Number(data.total_pages) || 1
        };
      });
  }

  /* Pull pages until the grid is full enough or the cap is hit. */
  async function fill(fresh) {
    if (fresh) {
      state.results = [];
      state.seen = new Set();
      state.page = 0;
      state.exhausted = false;
    }

    state.status = fresh ? 'loading' : 'more';
    state.reason = '';
    renderCollection();

    const want = state.results.length + DISCOVER_TARGET;
    let pages = 0;

    try {
      while (state.results.length < want && pages < DISCOVER_MAX_PAGES && !state.exhausted) {
        const page = state.page + 1;
        const payload = await fetchPage(page);

        state.page = page;
        pages += 1;
        if (page >= payload.totalPages || payload.results.length === 0) state.exhausted = true;

        state.results = state.results.concat(eligible(payload.results));
      }
      state.status = 'ready';
    } catch (error) {
      state.status = 'error';
      state.reason = error && error.message ? error.message : 'the request failed';
    }

    renderCollection();
  }

  return {
    snapshot: function () { return state; },
    find: function (tmdbId) {
      return state.results.filter(function (result) { return result.id === tmdbId; })[0] || null;
    },
    kick: function () { if (state.status === 'idle') fill(true); },
    retry: function () { fill(true); },
    more: function () { if (state.status === 'ready' && !state.exhausted) fill(false); },
    setFilter: function (kind, value) {
      if (kind === 'decade' && state.decade === value) return;
      if (kind === 'rating' && state.minRating === value) return;
      if (kind === 'decade') state.decade = value;
      if (kind === 'rating') state.minRating = value;
      fill(true);
    },
    /* Fade the tile out, then drop it from state. */
    dismiss: function (tmdbId) {
      state.results = state.results.filter(function (result) { return result.id !== tmdbId; });
      const tile = dom.collection.querySelector('.tile--discover[data-tmdb="' + tmdbId + '"]');
      if (!tile) return;
      tile.classList.add('is-leaving');
      window.setTimeout(function () {
        if (tile.parentNode) tile.parentNode.removeChild(tile);
      }, 280);
    }
  };
})();

/* Take a Discover result onto the shelves at the given status. */
function adopt(tmdbId, status) {
  const result = Discover.find(tmdbId);
  if (!result) return;

  Archive.add({
    id: 'tmdb-' + tmdbId,
    title: result.title || 'Untitled',
    year: Number(String(result.release_date || '').slice(0, 4)) || null,
    director: '',
    posterUrl: result.poster_path ? POSTER_BASE + result.poster_path : '',
    tmdbId: tmdbId,
    status: status,
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  });

  renderTabs();
  Discover.dismiss(tmdbId);
}


/* ------------------------------------------------------------
   4. RENDERING
   ------------------------------------------------------------ */

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function iconHTML(symbol, filled, modifier) {
  return '<svg class="icon' + (modifier ? ' ' + modifier : '') + (filled ? ' is-on' : '') +
    '" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + symbol + '"></use></svg>';
}

/* the small icon rows that sit under a poster */
function miniRatingHTML(kind, value) {
  const meta = RATINGS[kind];
  const reading = meta.legend + ': ' + meta.labels[value] + ' (' + value + ' of 3)';
  let html = '<span class="rating-mini" data-rating="' + kind + '" title="' + esc(reading) + '">';
  for (let level = 1; level <= 3; level += 1) {
    html += iconHTML(meta.icon, level <= value, 'icon--mini');
  }
  return html + '<span class="visually-hidden">' + esc(reading) + '</span></span>';
}

function tileHTML(film) {
  const hasPoster = Boolean(film.posterUrl);
  const rows = [];

  if (film.enjoyment) rows.push(miniRatingHTML('enjoyment', film.enjoyment));
  if (film.enjoyment && film.fear) rows.push('<span class="bar" aria-hidden="true"></span>');
  if (film.fear) rows.push(miniRatingHTML('fear', film.fear));

  const readout = [];
  if (film.enjoyment) readout.push(RATINGS.enjoyment.labels[film.enjoyment]);
  if (film.fear) readout.push(RATINGS.fear.labels[film.fear]);

  return '' +
    '<article class="tile" role="button" tabindex="0" data-id="' + esc(film.id) + '"' +
    ' data-status="' + esc(film.status) + '"' +
    ' aria-label="' + esc(film.title + ', ' + film.year + (readout.length ? ' - ' + readout.join(', ') : '') + '. Open entry.') + '">' +
      '<div class="tile-art' + (hasPoster ? ' has-poster' : '') + '">' +
        (hasPoster
          ? '<img class="tile-img" src="' + esc(film.posterUrl) + '" alt="" loading="lazy" decoding="async">'
          : '') +
        '<div class="plate">' +
          '<span class="plate-mark" aria-hidden="true"></span>' +
          '<span class="plate-title">' + esc(film.title) + '</span>' +
          '<span class="plate-rule" aria-hidden="true"></span>' +
          '<span class="plate-year">' + esc(film.year) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="tile-meta">' +
        '<h3 class="tile-title">' + esc(film.title) + '</h3>' +
        '<p class="tile-year">' + esc(film.year) + '</p>' +
        (rows.length ? '<div class="tile-ratings">' + rows.join('') + '</div>' : '') +
      '</div>' +
    '</article>';
}

function emptyHTML(key) {
  const copy = EMPTY_STATES[key];
  return '' +
    '<div class="empty">' +
      '<div class="empty-mark" aria-hidden="true"></div>' +
      '<p class="empty-kicker">' + esc(copy.kicker) + '</p>' +
      '<h2 class="empty-title">' + esc(copy.title) + '</h2>' +
      '<p class="empty-body">' + esc(copy.body) + '</p>' +
    '</div>';
}

/* ---- Discover view ---- */

function discoverControlsHTML() {
  const state = Discover.snapshot();
  const rows = [
    { kind: 'decade', label: 'Decade', options: DECADES, active: state.decade },
    { kind: 'rating', label: 'Minimum rating', options: RATING_FLOORS, active: state.minRating }
  ];

  return '<div class="disc-controls">' + rows.map(function (row) {
    return '' +
      '<div class="control-row">' +
        '<span class="control-label" id="ctl-' + row.kind + '">' + esc(row.label) + '</span>' +
        '<div class="control-set" role="group" aria-labelledby="ctl-' + row.kind + '">' +
          row.options.map(function (option) {
            const on = row.active === option.value;
            return '<button class="control-opt" type="button"' +
              ' data-discover-filter="' + row.kind + '" data-value="' + esc(option.value) + '"' +
              ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(option.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }).join('') + '</div>';
}

function discoverTileHTML(result) {
  const year = Number(String(result.release_date || '').slice(0, 4)) || null;
  const poster = result.poster_path ? POSTER_BASE + result.poster_path : '';
  const score = (Number(result.vote_average) || 0).toFixed(1);
  const title = result.title || 'Untitled';

  return '' +
    '<article class="tile tile--discover" data-tmdb="' + esc(result.id) + '">' +
      '<div class="tile-art' + (poster ? ' has-poster' : '') + '">' +
        (poster ? '<img class="tile-img" src="' + esc(poster) + '" alt="" loading="lazy" decoding="async">' : '') +
        '<div class="plate">' +
          '<span class="plate-mark" aria-hidden="true"></span>' +
          '<span class="plate-title">' + esc(title) + '</span>' +
          '<span class="plate-rule" aria-hidden="true"></span>' +
          '<span class="plate-year">' + esc(year || '') + '</span>' +
        '</div>' +
        '<div class="tile-actions">' +
          '<button class="tile-action" type="button" data-discover-add="to_watch" data-tmdb="' + esc(result.id) + '">' +
            'add to watchlist</button>' +
          '<button class="tile-action tile-action--banish" type="button" data-discover-add="banished" data-tmdb="' + esc(result.id) + '">' +
            'banish</button>' +
        '</div>' +
      '</div>' +
      '<div class="tile-meta">' +
        '<h3 class="tile-title">' + esc(title) + '</h3>' +
        '<p class="tile-year">' + esc(year || 'undated') + '</p>' +
        '<p class="tmdb-score">' +
          '<span class="tmdb-label">TMDB score</span>' +
          '<span class="tmdb-value">' + esc(score) + '</span>' +
        '</p>' +
      '</div>' +
    '</article>';
}

function discoverNoteHTML(key, extra) {
  const copy = DISCOVER_STATES[key];
  return '' +
    '<div class="empty empty--' + key + '">' +
      '<div class="empty-mark" aria-hidden="true"></div>' +
      '<p class="empty-kicker">' + esc(copy.kicker) + '</p>' +
      '<h2 class="empty-title">' + esc(copy.title) + '</h2>' +
      '<p class="empty-body">' + esc(copy.body) + '</p>' +
      (extra || '') +
    '</div>';
}

function loadMoreHTML(busy) {
  return '' +
    '<div class="load-more">' +
      '<span class="rule-line"></span>' +
      '<span class="diamond" aria-hidden="true"></span>' +
      '<button class="load-more-btn" type="button" data-discover-more' + (busy ? ' disabled' : '') + '>' +
        (busy ? 'gathering' : 'load more') + '</button>' +
      '<span class="diamond" aria-hidden="true"></span>' +
      '<span class="rule-line"></span>' +
    '</div>';
}

function discoverHTML() {
  const state = Discover.snapshot();
  let body = '';

  if (state.status === 'loading') {
    body = discoverNoteHTML('loading');
  } else if (state.status === 'error') {
    body = discoverNoteHTML('error',
      '<p class="empty-reason">' + esc(state.reason) + '</p>' +
      '<button class="ghost-btn" type="button" data-discover-retry>try again</button>');
  } else if (!state.results.length) {
    body = discoverNoteHTML('empty');
  } else {
    body = '<div class="grid">' + state.results.map(discoverTileHTML).join('') + '</div>' +
      (state.exhausted ? '' : loadMoreHTML(state.status === 'more'));
  }

  return discoverControlsHTML() + body;
}

function renderTabs() {
  const parts = [];

  TABS.forEach(function (tab, index) {
    if (index > 0) {
      parts.push('<span class="tab-sep" aria-hidden="true">' +
        '<svg viewBox="0 0 24 34"><use href="#orn-fleur"></use></svg></span>');
    }
    const count = tab.counted ? Archive.count(tab.id) : 0;
    parts.push('' +
      '<button class="tab" type="button" role="tab" data-tab="' + tab.id + '"' +
      ' aria-selected="' + (activeTab === tab.id ? 'true' : 'false') + '">' +
        '<span class="tab-label">' + tab.label + '</span>' +
        '<span class="tab-count">' + String(count).padStart(2, '0') + '</span>' +
      '</button>');
  });

  dom.tabs.innerHTML = parts.join('');
}

function renderCollection() {
  if (activeTab === 'discover') {
    dom.collection.innerHTML = discoverHTML();
    guardPosters();
    Discover.kick();          // no-op unless nothing has been fetched yet
    return;
  }

  const films = Archive.byStatus(activeTab);
  if (!films.length) {
    dom.collection.innerHTML = emptyHTML(activeTab);
    return;
  }

  dom.collection.innerHTML = '<div class="grid">' + films.map(tileHTML).join('') + '</div>';
  guardPosters();
}

/* If a poster ever fails after it has been placed, fall back to
   the plate rather than leaving a gap in the shelf. */
function guardPosters() {
  const images = dom.collection.querySelectorAll('.tile-img');
  Array.prototype.forEach.call(images, function (img) {
    img.addEventListener('error', function () {
      const art = img.closest('.tile-art');
      if (art) art.classList.remove('has-poster');
      img.remove();
    });
  });
}

/* Drop a freshly loaded poster into a tile already on screen,
   without rebuilding the grid underneath the reader. */
function paintPoster(id, url) {
  const art = dom.collection.querySelector('.tile[data-id="' + id + '"] .tile-art');
  if (!art || art.classList.contains('has-poster')) return;

  const img = document.createElement('img');
  img.className = 'tile-img';
  img.alt = '';
  img.decoding = 'async';
  img.src = url;
  img.addEventListener('error', function () {
    art.classList.remove('has-poster');
    img.remove();
  });

  art.insertBefore(img, art.firstChild);
  art.classList.add('has-poster');
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
  'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];

function renderColophon() {
  const total = Archive.all().length;
  const word = total <= 20 ? NUMBER_WORDS[total] : String(total);
  dom.colophonCount.textContent = word + (total === 1 ? ' entry' : ' entries') + ', kept under glass.';
}

function render() {
  renderTabs();
  renderCollection();
  renderColophon();
}


/* ---- panel ---- */

function renderStatusGroup(film) {
  dom.statusGroup.innerHTML = STATUSES.map(function (status) {
    return '<button class="opt" type="button" data-status="' + esc(status.value) + '"' +
      ' aria-pressed="' + (film.status === status.value ? 'true' : 'false') + '">' +
      esc(status.label) + '</button>';
  }).join('');
}

function renderRatingGroup(kind, value) {
  const meta = RATINGS[kind];
  let html = '';

  for (let level = 1; level <= 3; level += 1) {
    html += '' +
      '<button class="rate-btn" type="button" data-level="' + level + '"' +
      ' aria-pressed="' + (value === level ? 'true' : 'false') + '"' +
      ' title="' + esc(meta.labels[level]) + '"' +
      ' aria-label="' + esc(meta.labels[level] + ' - ' + level + ' of 3, ' + meta.legend) + '">' +
        iconHTML(meta.icon, Boolean(value) && level <= value) +
      '</button>';
  }

  html += '<span class="rate-read' + (value ? ' is-set' : '') + '">' +
    esc(value ? meta.labels[value] : 'unrated') + '</span>';

  const group = kind === 'enjoyment' ? dom.enjoymentGroup : dom.fearGroup;
  group.innerHTML = html;
}

function renderPanelControls(film) {
  renderStatusGroup(film);
  renderRatingGroup('enjoyment', film.enjoyment);
  renderRatingGroup('fear', film.fear);
}

function openPanel(id) {
  const film = Archive.get(id);
  if (!film) return;

  openFilmId = id;
  lastFocused = document.activeElement;

  dom.panelTitle.textContent = film.title;
  dom.panelSub.textContent = film.director
    ? film.year + ' - directed by ' + film.director
    : String(film.year || 'year unknown');
  dom.yearWatched.value = film.yearWatched || '';
  dom.review.value = film.review || '';
  renderPanelControls(film);

  dom.scrim.hidden = false;
  document.body.classList.add('is-locked');
  dom.panel.focus();
}

function closePanel() {
  if (dom.scrim.hidden) return;

  /* The grid may have been rebuilt while the panel was open, so send focus
     back to the tile with the same id rather than to a detached node. */
  const returning = openFilmId
    ? dom.collection.querySelector('.tile[data-id="' + openFilmId + '"]')
    : null;

  dom.scrim.hidden = true;
  document.body.classList.remove('is-locked');
  openFilmId = null;

  if (returning) {
    returning.focus();
  } else if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus();
  }
  lastFocused = null;
}

/* Write a change, refresh the panel controls and the grid behind it.
   Field values are left alone so typing is never interrupted. */
function commit(patch, refreshControls) {
  if (!openFilmId) return;
  const film = Archive.update(openFilmId, patch);
  if (!film) return;
  if (refreshControls) renderPanelControls(film);
  render();
}


/* ------------------------------------------------------------
   CONFIRMATION, EXPORT AND IMPORT
   ------------------------------------------------------------ */

let confirmAction = null;

function openConfirm(options) {
  confirmAction = options.onConfirm || null;

  dom.confirmEyebrow.textContent = options.eyebrow || 'Confirm';
  dom.confirmTitle.textContent = options.title || '';
  dom.confirmBody.textContent = options.body || '';
  dom.confirmYes.textContent = options.confirmLabel || 'yes';
  dom.confirmNo.textContent = options.cancelLabel || 'cancel';
  dom.confirmYes.hidden = !options.onConfirm;   // a message only needs dismissing

  dom.confirmScrim.hidden = false;
  document.body.classList.add('is-locked');
  dom.confirmPanel.focus();
}

function closeConfirm() {
  if (dom.confirmScrim.hidden) return;
  dom.confirmScrim.hidden = true;
  confirmAction = null;
  if (dom.scrim.hidden) document.body.classList.remove('is-locked');
}

function entryCount(total) {
  return total + (total === 1 ? ' entry' : ' entries');
}

function exportCollection() {
  const payload = JSON.stringify(Archive.all(), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'horror-collection.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function importCollection(file) {
  const reader = new FileReader();

  reader.onerror = function () {
    openConfirm({
      eyebrow: 'Import',
      title: 'That file would not open',
      body: 'The file could not be read. Try exporting a fresh copy and importing that.',
      cancelLabel: 'close'
    });
  };

  reader.onload = function () {
    let incoming = null;
    try {
      incoming = Store.normalise(JSON.parse(reader.result));
    } catch (error) {
      incoming = null;
    }

    if (!incoming) {
      openConfirm({
        eyebrow: 'Import',
        title: 'Nothing usable in there',
        body: 'That file does not hold a collection this ledger recognises. An exported file is a list of films, each with an id and a title.',
        cancelLabel: 'close'
      });
      return;
    }

    openConfirm({
      eyebrow: 'Import',
      title: 'Replace the collection?',
      body: 'This puts ' + entryCount(incoming.length) + ' in place of the ' +
        entryCount(Archive.all().length) + ' you have now. There is no undo - export first if you want to keep them.',
      confirmLabel: 'replace',
      cancelLabel: 'keep what I have',
      onConfirm: function () {
        Archive.replace(incoming);
        activeTab = 'to_watch';
        render();
        Posters.loadAll(Archive.all());
      }
    });
  };

  reader.readAsText(file);
}


/* ------------------------------------------------------------
   5. EVENTS
   ------------------------------------------------------------ */

dom.tabs.addEventListener('click', function (event) {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  activeTab = tab.dataset.tab;
  render();
});

dom.collection.addEventListener('click', function (event) {
  const filter = event.target.closest('[data-discover-filter]');
  if (filter) {
    Discover.setFilter(filter.dataset.discoverFilter, filter.dataset.value);
    return;
  }

  if (event.target.closest('[data-discover-more]')) { Discover.more(); return; }
  if (event.target.closest('[data-discover-retry]')) { Discover.retry(); return; }

  const action = event.target.closest('[data-discover-add]');
  if (action) {
    adopt(Number(action.dataset.tmdb), action.dataset.discoverAdd);
    return;
  }

  const tile = event.target.closest('.tile');
  if (tile && tile.dataset.id) openPanel(tile.dataset.id);
});

dom.collection.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const tile = event.target.closest('.tile');
  if (!tile || !tile.dataset.id) return;
  event.preventDefault();
  openPanel(tile.dataset.id);
});

dom.panel.addEventListener('click', function (event) {
  const button = event.target.closest('button');
  if (!button) return;

  if (button === dom.panelClose) {
    closePanel();
    return;
  }

  const film = Archive.get(openFilmId);
  if (!film) return;

  if (button.dataset.status) {
    /* click the active standing again to set the film aside */
    const next = film.status === button.dataset.status ? null : button.dataset.status;
    commit({ status: next }, true);
    return;
  }

  const group = button.closest('[data-rating]');
  if (group && button.dataset.level) {
    const kind = group.dataset.rating;
    const level = Number(button.dataset.level);
    const patch = {};
    patch[kind] = film[kind] === level ? null : level;   // click the active value to clear
    commit(patch, true);
  }
});

/* Hovering a rating previews that rung's label in the readout. */
dom.panel.addEventListener('mouseover', function (event) {
  const button = event.target.closest('.rate-btn');
  if (!button) return;
  const group = button.closest('[data-rating]');
  const read = group && group.querySelector('.rate-read');
  if (!read) return;
  read.textContent = RATINGS[group.dataset.rating].labels[Number(button.dataset.level)];
  read.classList.add('is-set');
});

dom.panel.addEventListener('mouseout', function (event) {
  const group = event.target.closest('[data-rating]');
  if (!group || group.contains(event.relatedTarget)) return;
  const film = Archive.get(openFilmId);
  if (film) renderRatingGroup(group.dataset.rating, film[group.dataset.rating]);
});

dom.yearWatched.addEventListener('input', function () {
  commit({ yearWatched: dom.yearWatched.value }, false);
});

dom.review.addEventListener('input', function () {
  commit({ review: dom.review.value }, false);
});

dom.scrim.addEventListener('mousedown', function (event) {
  if (event.target === dom.scrim) closePanel();
});

dom.exportBtn.addEventListener('click', exportCollection);

dom.importBtn.addEventListener('click', function () { dom.importFile.click(); });

dom.importFile.addEventListener('change', function () {
  const file = dom.importFile.files && dom.importFile.files[0];
  dom.importFile.value = '';        // so the same file can be chosen twice
  if (file) importCollection(file);
});

dom.confirmYes.addEventListener('click', function () {
  const action = confirmAction;
  closeConfirm();
  if (action) action();
});

dom.confirmNo.addEventListener('click', closeConfirm);

dom.confirmScrim.addEventListener('mousedown', function (event) {
  if (event.target === dom.confirmScrim) closeConfirm();
});

document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  if (!dom.confirmScrim.hidden) { closeConfirm(); return; }
  closePanel();
});

render();
Posters.loadAll(Archive.all());
