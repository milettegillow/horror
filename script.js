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
   0. EDIT SESSION AND STORAGE
   ------------------------------------------------------------
   The only part of the app that knows where the collection lives.
   Everything else calls Store.load and Store.save.

   Reading is public. Writing carries a PIN, held for the tab in
   sessionStorage and sent as a header; the server compares it and
   the browser never learns whether it was right except by being
   told. No Redis credential is ever present on this side.
   ------------------------------------------------------------ */

const Auth = (function () {
  const KEY = 'horror.pin';
  let pin = '';

  try {
    pin = window.sessionStorage.getItem(KEY) || '';
  } catch (error) {
    pin = '';   // storage disabled: the session simply stays locked
  }

  return {
    pin: function () { return pin; },
    unlocked: function () { return Boolean(pin); },
    unlock: function (value) {
      pin = value;
      try { window.sessionStorage.setItem(KEY, value); } catch (error) { /* held in memory only */ }
    },
    lock: function () {
      pin = '';
      try { window.sessionStorage.removeItem(KEY); } catch (error) { /* nothing to clear */ }
    }
  };
})();

/* View preferences live in this browser, not in the archive - they
   are how one reader likes to look at the collection, not part of
   the collection itself. The only localStorage in the app, and it
   is confined here. */
const Prefs = (function () {
  const KEY = 'horror.prefs.v1';

  function read() {
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  return {
    get: function (name, fallback) {
      const value = read()[name];
      return value === undefined ? fallback : value;
    },
    set: function (name, value) {
      const all = read();
      all[name] = value;
      try {
        window.localStorage.setItem(KEY, JSON.stringify(all));
      } catch (error) {
        /* storage refused: the choice simply lasts this visit */
      }
    }
  };
})();

const Store = (function () {
  const ENDPOINT = '/api/collection';
  const PIN_HEADER = 'x-edit-pin';
  const DELAY = 600;

  let timer = null;
  let sending = false;
  let queued = null;
  let listeners = { saved: function () {}, failed: function () {} };

  function snapshot(films) {
    return films.map(function (film) { return Object.assign({}, film); });
  }

  function headers(pin) {
    const set = { 'Content-Type': 'application/json' };
    set[PIN_HEADER] = pin || Auth.pin();
    return set;
  }

  function push(films, pin) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: headers(pin),
      body: JSON.stringify(films)
    }).then(function (response) {
      if (response.status === 401) throw new Error('That PIN was refused.');
      if (!response.ok) throw new Error('The archive replied ' + response.status + '.');
      return response.json();
    });
  }

  /* One write at a time. Anything that arrives mid-flight waits and
     goes next, so a burst of edits cannot land out of order. */
  function send(films, generation) {
    sending = true;
    push(films)
      .then(function (saved) {
        sending = false;
        listeners.saved(saved, queued === null && timer === null, generation);
        if (queued) {
          const next = queued;
          queued = null;
          send(next.films, next.generation);
        }
      })
      .catch(function (error) {
        sending = false;
        queued = null;
        listeners.failed(error && error.message ? error.message : 'The change could not be saved.', films);
      });
  }

  return {
    listen: function (onSaved, onFailed) {
      listeners = { saved: onSaved, failed: onFailed };
    },

    load: function () {
      return fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
        .then(function (response) {
          if (!response.ok) throw new Error('The archive replied ' + response.status + '.');
          return response.json();
        })
        .then(function (films) {
          if (!Array.isArray(films)) throw new Error('The archive sent something unreadable.');
          return films;
        });
    },

    /* debounced, so typing a review is one write and not thirty */
    save: function (films, generation) {
      if (!Auth.unlocked()) return;
      const wanted = snapshot(films);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        timer = null;
        if (sending) { queued = { films: wanted, generation: generation }; return; }
        send(wanted, generation);
      }, DELAY);
    },

    /* immediate, for import and for checking a PIN. The PIN can be
       supplied rather than taken from the session, so one can be
       tried without unlocking anything first. */
    push: function (films, pin) {
      if (timer) { window.clearTimeout(timer); timer = null; }
      return push(snapshot(films), pin);
    }
  };
})();


/* ------------------------------------------------------------
   1. DATA LAYER
   ------------------------------------------------------------
   The renderer never touches the films array - it asks Archive
   for copies and posts changes back through Archive.update(),
   which hands them to Store.

   The collection arrives from /api/collection and is held here
   in memory while the tab is open, so rendering never waits on
   the network. The seed that fills an empty archive lives in
   api/seed.js, server-side.

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


const YEAR_WATCHED_FLOOR = 1994;

/* How the watched list may be ordered. Scariness leads, because
   that is the question most often asked of this shelf. */
const WATCHED_SORTS = [
  { value: 'fear', label: 'Scariness' },
  { value: 'enjoyment', label: 'How much I liked it' },
  { value: 'watched', label: 'Year watched' }
];

const WATCHED_SORT_DEFAULT = 'fear';

function isWatchedSort(value) {
  return WATCHED_SORTS.some(function (sort) { return sort.value === value; });
}

/* "The Innocents" files under I, "A Cold Room" under C. */
function sortableTitle(film) {
  return normalise(film && film.title).replace(/^(the|a) /, '');
}

/* The tie-break shared by every watched sort: most recently
   released first, undated at the very bottom, then alphabetical. */
function compareByRelease(a, b) {
  const yearA = Number(a.year) || null;
  const yearB = Number(b.year) || null;

  if (yearA !== yearB) {
    if (yearA === null) return 1;
    if (yearB === null) return -1;
    return yearB - yearA;
  }

  const titleA = sortableTitle(a);
  const titleB = sortableTitle(b);
  if (titleA < titleB) return -1;
  if (titleA > titleB) return 1;
  return 0;
}

/* Rated films first, highest first; unrated below the lot, ordered
   among themselves by the same tie-break. */
function compareByLevel(key) {
  return function (a, b) {
    const levelA = a[key] || null;
    const levelB = b[key] || null;

    if (levelA !== levelB) {
      if (levelA === null) return 1;
      if (levelB === null) return -1;
      return levelB - levelA;
    }
    return compareByRelease(a, b);
  };
}

function compareByWatchedYear(a, b) {
  const seenA = watchedYear(a);
  const seenB = watchedYear(b);

  if (seenA !== seenB) {
    if (seenA === null) return 1;
    if (seenB === null) return -1;
    return seenB - seenA;
  }
  return compareByRelease(a, b);
}

function watchedComparator(sort) {
  if (sort === 'enjoyment') return compareByLevel('enjoyment');
  if (sort === 'watched') return compareByWatchedYear;
  return compareByLevel('fear');
}

/* Years run from this one down to the floor, generated rather than
   written out, so the list is still right in ten years' time. An
   unexpected stored value is kept as its own option rather than
   being quietly dropped. */
function yearOptionsHTML(selected) {
  const now = new Date().getFullYear();
  const years = [];

  for (let year = now; year >= YEAR_WATCHED_FLOOR; year -= 1) years.push(String(year));
  if (selected && years.indexOf(selected) === -1) years.unshift(selected);

  return '<option value="">not recorded</option>' + years.map(function (year) {
    return '<option value="' + esc(year) + '">' + esc(year) + '</option>';
  }).join('');
}

/* A four-digit yearWatched as a number, or null for anything
   blank or unparseable. */
function watchedYear(film) {
  const raw = film && typeof film.yearWatched === 'string' ? film.yearWatched.trim() : '';
  return /^\d{4}$/.test(raw) ? Number(raw) : null;
}

const Archive = (function () {
  let films = [];

  /* Bumped whenever the whole collection is swapped out. A write
     that was queued against an older generation must not be allowed
     to reconcile over the newer one. */
  let generation = 0;

  function copy(film) { return Object.assign({}, film); }
  function persist() { Store.save(films, generation); }

  return {
    generation: function () { return generation; },

    /* the collection as it arrived from the archive */
    hydrate: function (incoming) {
      films = incoming.map(copy);
      generation += 1;
    },

    all: function () { return films.map(copy); },
    /* Watched is ordered by the year it was watched, most recent
       first, with anything unrecorded after the lot rather than
       treated as year nought. Everything else, and every tie, falls
       back on order added - most recent first. Release year is
       shown on the tiles but never sorts anything. */
    /* Watched is ordered by whichever sort the reader has chosen.
       To Watch runs by release year, newest first - a waiting list
       reads better as a shelf than as a pile. Banished stays on
       order added, most recent first. */
    byStatus: function (status, sort) {
      const held = films
        .map(function (film, index) { return { film: film, index: index }; })
        .filter(function (entry) { return entry.film.status === status; });

      let compare = null;
      if (status === 'watched') compare = watchedComparator(sort);
      else if (status === 'to_watch') compare = compareByRelease;

      held.sort(function (a, b) {
        if (compare) {
          const ordered = compare(a.film, b.film);
          if (ordered !== 0) return ordered;
          return b.index - a.index;          // a dead heat: newest addition first
        }
        return b.index - a.index;
      });

      return held.map(function (entry) { return copy(entry.film); });
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
    /* wholesale replacement, used by import - the caller pushes it */
    replace: function (incoming) {
      films = incoming.map(copy);
      generation += 1;
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

const COLLECTION_STATES = {
  loading: {
    kicker: 'One moment',
    title: 'Opening the ledger',
    body: 'The collection is being fetched from the archive. It is a short journey and the pages are thin, so this should not take long.'
  },
  error: {
    kicker: 'No reply',
    title: 'The ledger will not open',
    body: 'The collection could not be fetched. Nothing has been lost - the archive simply did not answer this time, and may well answer the next.'
  }
};

const SEARCH_STATES = {
  loading: {
    kicker: 'Looking',
    title: 'Turning out the drawers',
    body: 'The archive is being searched by name. It keeps everything, in no particular order, and takes a moment to find its footing.'
  },
  empty: {
    kicker: 'Nothing under that name',
    title: 'No such film',
    body: 'Nothing in the archive answers to it. Either the spelling has slipped, or you have invented a film - which happens more often than anyone admits, usually at three in the morning.'
  },
  error: {
    kicker: 'No reply',
    title: 'The search went unanswered',
    body: 'The request went out under that name and nothing came back. The archive is unreliable rather than unwilling, and is usually worth asking twice.'
  }
};

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
let watchedSort = isWatchedSort(Prefs.get('watchedSort', ''))
  ? Prefs.get('watchedSort', WATCHED_SORT_DEFAULT)
  : WATCHED_SORT_DEFAULT;
let collectionState = 'loading';   // loading | ready | error
let collectionError = '';
let openFilmId = null;    // set when the open entry is in the collection
let draftFilm = null;     // set when it is a Discover result that is not
let panelDetail = null;   // TMDB score, overview and director for the open entry
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
  yearField: document.getElementById('yearField'),
  review: document.getElementById('review'),
  panelTmdb: document.getElementById('panelTmdb'),
  panelScore: document.getElementById('panelScore'),
  panelOverview: document.getElementById('panelOverview'),
  panelFoot: document.querySelector('.panel-foot'),
  colophonCount: document.getElementById('colophonCount'),
  exportBtn: document.getElementById('exportBtn'),
  unlockBtn: document.getElementById('unlockBtn'),
  lockBtn: document.getElementById('lockBtn'),
  editBadge: document.getElementById('editBadge'),
  confirmField: document.getElementById('confirmField'),
  confirmInput: document.getElementById('confirmInput'),
  confirmNote: document.getElementById('confirmNote'),
  notice: document.getElementById('notice'),
  noticeText: document.getElementById('noticeText'),
  noticeRetry: document.getElementById('noticeRetry'),
  noticeDismiss: document.getElementById('noticeDismiss'),
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
   FILM DETAIL
   ------------------------------------------------------------
   The overview, the TMDB score and the director, fetched once per
   film and kept. Search and discover payloads carry the first two
   but never the crew, so the panel asks for credits by id.
   ------------------------------------------------------------ */

const Details = (function () {
  const cache = new Map();
  const waiting = new Map();

  function extract(movie) {
    const crew = movie && movie.credits && Array.isArray(movie.credits.crew) ? movie.credits.crew : [];
    const directors = crew
      .filter(function (person) { return person && person.job === 'Director'; })
      .map(function (person) { return person.name; })
      .filter(Boolean);

    return {
      voteAverage: Number(movie.vote_average) || 0,
      overview: typeof movie.overview === 'string' ? movie.overview : '',
      director: directors.join(', ')
    };
  }

  function settle(tmdbId, detail) {
    if (detail) cache.set(tmdbId, detail);
    (waiting.get(tmdbId) || []).forEach(function (done) { done(detail); });
    waiting.delete(tmdbId);
  }

  return {
    get: function (tmdbId) { return cache.get(tmdbId) || null; },

    load: function (tmdbId, done) {
      if (!tmdbId) { done(null); return; }
      if (cache.has(tmdbId)) { done(cache.get(tmdbId)); return; }
      if (waiting.has(tmdbId)) { waiting.get(tmdbId).push(done); return; }

      waiting.set(tmdbId, [done]);
      fetch(TMDB_ENDPOINT + '?id=' + encodeURIComponent(tmdbId) + '&credits=1')
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (movie) { settle(tmdbId, movie ? extract(movie) : null); })
        .catch(function () { settle(tmdbId, null); });
    }
  };
})();


/* ------------------------------------------------------------
   DISCOVER
   ------------------------------------------------------------
   Top-rated horror from TMDB, minus anything already on the
   shelves. Filtering shrinks each page, so a fill keeps pulling
   pages until the grid has enough or the cap is reached.
   ------------------------------------------------------------ */

const SEARCH_MIN = 1;            // horror is full of one-letter titles: X, M, It, Us
const SEARCH_SHORT = 2;          // at this length or less, a query is very short
const SEARCH_DEBOUNCE = 300;
const SEARCH_DEBOUNCE_SHORT = 550;   // short queries wait a little longer

/* Title match dominates; votes settle each tier. The tiers are far
   enough apart that no vote count can lift a loose match over an
   exact one - there are four films called exactly "X", and votes
   are what tell them apart. */
const SEARCH_EXACT = 1000;
const SEARCH_PREFIX = 500;
const SEARCH_LOOSE = 100;

const SEARCH_VISIBLE = 20;         // a full payload
const SEARCH_VISIBLE_SHORT = 12;   // a one-letter search should not flood the grid

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
    exhausted: false,

    /* searching by name runs alongside the browsable grid rather
       than replacing it, so clearing the field puts the reader
       back where they were, filters and all */
    query: '',
    search: { results: [], status: 'idle', reason: '', visible: SEARCH_VISIBLE }
  };

  let searchTimer = null;

  /* TMDB relevance order is kept. Entries with no artwork or
     almost no votes are moved to the back, since those are nearly
     always shorts, duplicates and misfiled fragments. */
  function titleTier(result, target) {
    const candidates = [normalise(result.title), normalise(result.original_title)];
    let best = SEARCH_LOOSE;

    candidates.forEach(function (candidate) {
      if (!candidate) return;
      if (candidate === target) best = Math.max(best, SEARCH_EXACT);
      else if (candidate.indexOf(target) === 0) best = Math.max(best, SEARCH_PREFIX);
    });

    return best;
  }

  function votesOf(result) {
    return Math.max(0, Number(result.vote_count) || 0);
  }

  /* Sorted by how well the title answers the query, then by how
     many people have seen it. Anything without artwork goes to the
     bottom whatever it scores, since those are nearly always
     duplicates and fragments. */
  function rank(results, query) {
    const target = normalise(query);
    const shown = [];
    const artless = [];

    results.forEach(function (result) {
      if (!result || !result.id) return;
      (result.poster_path ? shown : artless).push(result);
    });

    function order(a, b) {
      const tierA = titleTier(a, target);
      const tierB = titleTier(b, target);
      if (tierA !== tierB) return tierB - tierA;
      return votesOf(b) - votesOf(a);
    }

    shown.sort(order);
    artless.sort(order);
    return shown.concat(artless);
  }

  function visibleCap(query) {
    return query.length <= SEARCH_SHORT ? SEARCH_VISIBLE_SHORT : SEARCH_VISIBLE;
  }

  function findResult(tmdbId) {
    const pools = state.search.results.concat(state.results);
    return pools.filter(function (result) { return result.id === tmdbId; })[0] || null;
  }

  function runSearch(query) {
    state.query = query;
    state.search = { results: [], status: 'loading', reason: '', visible: visibleCap(query) };
    renderDiscoverBody();

    fetch(TMDB_ENDPOINT + '?query=' + encodeURIComponent(query))
      .then(function (response) {
        if (!response.ok) throw new Error('the archive replied ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (state.query !== query) return;   // a later search has overtaken this one
        state.search.results = rank(Array.isArray(data.results) ? data.results : [], query);
        state.search.status = 'ready';
        renderDiscoverBody();
      })
      .catch(function (error) {
        if (state.query !== query) return;
        state.search.status = 'error';
        state.search.reason = error && error.message ? error.message : 'the search failed';
        renderDiscoverBody();
      });
  }

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
    searching: function () { return Boolean(state.query); },

    find: findResult,

    /* redraw one search tile, so a standing change shows without
       rebuilding the grid under the reader */
    refreshTile: function (tmdbId) {
      const tile = dom.collection.querySelector('.tile--discover[data-tmdb="' + tmdbId + '"]');
      const result = findResult(tmdbId);
      if (!tile || !tile.parentNode || !result) return;

      const holder = document.createElement('div');
      holder.innerHTML = discoverTileHTML(result, true);
      tile.parentNode.replaceChild(holder.firstChild, tile);
      guardPosters();
    },

    /* typed into the search field: debounced, and quiet below the
       minimum length so two letters never reach the archive */
    type: function (raw) {
      const query = String(raw || '').trim();
      if (searchTimer) window.clearTimeout(searchTimer);

      if (query.length < SEARCH_MIN) {
        const was = Boolean(state.query);
        state.query = '';
        state.search = { results: [], status: 'idle', reason: '', visible: SEARCH_VISIBLE };
        if (was) renderDiscoverBody();
        return;
      }

      if (query === state.query && state.search.status === 'ready') return;

      /* one or two letters wait a little longer, since those are the
         queries still being typed */
      const delay = query.length <= SEARCH_SHORT ? SEARCH_DEBOUNCE_SHORT : SEARCH_DEBOUNCE;
      searchTimer = window.setTimeout(function () { runSearch(query); }, delay);
    },

    retrySearch: function () { if (state.query) runSearch(state.query); },
    kick: function () { if (state.status === 'idle') fill(true); },
    retry: function () { fill(true); },
    more: function () {
      if (state.query) {
        const search = state.search;
        if (search.status !== 'ready' || search.visible >= search.results.length) return;
        search.visible += visibleCap(state.query);
        renderDiscoverBody();
        return;
      }
      if (state.status === 'ready' && !state.exhausted) fill(false);
    },
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

/* The collected film carrying this TMDB id, if there is one.
   Everything that adds from Discover checks here first, so a
   second entry can never be made for the same film. */
function collectedByTmdb(tmdbId) {
  return Archive.all().filter(function (film) { return film.tmdbId === tmdbId; })[0] || null;
}

function statusLabel(status) {
  const found = STATUSES.filter(function (option) { return option.value === status; })[0];
  return found ? found.label : '';
}

/* A Discover result in the shape of a film, not yet collected. */
function draftFromResult(result) {
  return {
    id: 'tmdb-' + result.id,
    title: result.title || 'Untitled',
    year: Number(String(result.release_date || '').slice(0, 4)) || null,
    director: '',
    posterUrl: result.poster_path ? POSTER_BASE + result.poster_path : '',
    tmdbId: result.id,
    status: null,
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  };
}

function detailFromResult(result) {
  return {
    voteAverage: Number(result.vote_average) || 0,
    overview: typeof result.overview === 'string' ? result.overview : '',
    director: ''
  };
}

/* Take a Discover result onto the shelves at the given status.
   Marking something watched opens its entry, so the ratings can be
   set while the film is still in mind. */
function adopt(tmdbId, status, thenOpen) {
  if (!Auth.unlocked()) return;
  const result = Discover.find(tmdbId);
  if (!result) return;

  const held = collectedByTmdb(tmdbId);
  let film;

  if (held) {
    film = Archive.update(held.id, { status: status });   // never a second entry
  } else {
    film = draftFromResult(result);
    film.status = status;
    Archive.add(film);
  }

  refreshChrome();

  /* browsing hands the film over and the tile leaves; searching is a
     lookup, so the tile stays and simply reports its new standing */
  if (Discover.searching()) Discover.refreshTile(tmdbId);
  else Discover.dismiss(tmdbId);

  if (thenOpen && film) openEntry(Archive.get(film.id), detailFromResult(result));
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

function discoverSearchHTML() {
  const state = Discover.snapshot();
  return '' +
    '<div class="disc-search">' +
      '<label class="visually-hidden" for="discSearch">Search the archive by name</label>' +
      '<input class="search-input" id="discSearch" type="search" autocomplete="off"' +
      ' spellcheck="false" placeholder="Name any film - living or dead"' +
      ' value="' + esc(state.query) + '">' +
      '<button class="text-link disc-clear" id="discClear" type="button"' +
      (state.query ? '' : ' hidden') + '>clear</button>' +
    '</div>';
}

function discoverControlsHTML() {
  const state = Discover.snapshot();
  const rows = [
    { kind: 'decade', label: 'Decade', options: DECADES, active: state.decade },
    { kind: 'rating', label: 'Minimum rating', options: RATING_FLOORS, active: state.minRating }
  ];

  const paused = Discover.searching();

  return '<div class="disc-controls' + (paused ? ' is-paused' : '') + '">' +
    '<p class="control-paused" id="controlPaused"' + (paused ? '' : ' hidden') + '>' +
      'Paused while searching - decade and rating apply to the browsable list only.' +
    '</p>' +
    rows.map(function (row) {
    return '' +
      '<div class="control-row">' +
        '<span class="control-label" id="ctl-' + row.kind + '">' + esc(row.label) + '</span>' +
        '<div class="control-set" role="group" aria-labelledby="ctl-' + row.kind + '">' +
          row.options.map(function (option) {
            const on = row.active === option.value;
            return '<button class="control-opt" type="button"' +
              ' data-discover-filter="' + row.kind + '" data-value="' + esc(option.value) + '"' +
              ' aria-pressed="' + (on ? 'true' : 'false') + '"' + (paused ? ' disabled' : '') + '>' +
              esc(option.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }).join('') + '</div>';
}

function discoverTileHTML(result, searching) {
  const year = Number(String(result.release_date || '').slice(0, 4)) || null;
  const poster = result.poster_path ? POSTER_BASE + result.poster_path : '';
  const score = (Number(result.vote_average) || 0).toFixed(1);
  const title = result.title || 'Untitled';
  const held = collectedByTmdb(result.id);

  const actions = [
    { status: 'to_watch', label: 'add to watchlist', modifier: '' },
    { status: 'watched', label: 'mark as watched', modifier: '' },
    { status: 'banished', label: 'banish', modifier: ' tile-action--banish' }
  ];

  return '' +
    '<article class="tile tile--discover' + (searching ? ' tile--search' : '') + '"' +
    ' data-tmdb="' + esc(result.id) + '">' +
      '<div class="tile-frame">' +
        (held && held.status
          ? '<span class="tile-held">' + esc(statusLabel(held.status)) + '</span>'
          : '') +
        '<div class="tile-art' + (poster ? ' has-poster' : '') + '" role="button" tabindex="0"' +
        ' aria-label="' + esc(title + (year ? ', ' + year : '') + '. Open entry.') + '">' +
          (poster ? '<img class="tile-img" src="' + esc(poster) + '" alt="" loading="lazy" decoding="async">' : '') +
          '<div class="plate">' +
            '<span class="plate-mark" aria-hidden="true"></span>' +
            '<span class="plate-title">' + esc(title) + '</span>' +
            '<span class="plate-rule" aria-hidden="true"></span>' +
            '<span class="plate-year">' + esc(year || '') + '</span>' +
          '</div>' +
        '</div>' +
        /* siblings of the art, so no button sits inside another */
        '<div class="tile-actions">' +
          actions.map(function (action) {
            return '<button class="tile-action' + action.modifier + '" type="button"' +
              ' data-discover-add="' + action.status + '" data-tmdb="' + esc(result.id) + '"' + lockedAttr() + '>' +
              esc(action.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="tile-meta">' +
        '<h3 class="tile-title">' + esc(title) + '</h3>' +
        '<p class="tile-year' + (searching ? ' tile-year--lead' : '') + '">' +
          esc(year || 'undated') + '</p>' +
        '<p class="tmdb-score">' +
          '<span class="tmdb-label">TMDB score</span>' +
          '<span class="tmdb-value">' + esc(score) + '</span>' +
        '</p>' +
        (held
          ? '<p class="tile-holding">' +
              (held.status
                ? 'In your collection - ' + esc(statusLabel(held.status))
                : 'In your collection - no standing') +
            '</p>'
          : '') +
      '</div>' +
    '</article>';
}

function noteHTML(copy, modifier, extra) {
  return '' +
    '<div class="empty' + (modifier ? ' empty--' + modifier : '') + '">' +
      '<div class="empty-mark" aria-hidden="true"></div>' +
      '<p class="empty-kicker">' + esc(copy.kicker) + '</p>' +
      '<h2 class="empty-title">' + esc(copy.title) + '</h2>' +
      '<p class="empty-body">' + esc(copy.body) + '</p>' +
      (extra || '') +
    '</div>';
}

function discoverNoteHTML(key, extra) {
  return noteHTML(DISCOVER_STATES[key], key, extra);
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

function searchBodyHTML() {
  const search = Discover.snapshot().search;

  if (search.status === 'loading') return noteHTML(SEARCH_STATES.loading, 'loading');

  if (search.status === 'error') {
    return noteHTML(SEARCH_STATES.error, 'error',
      '<p class="empty-reason">' + esc(search.reason) + '</p>' +
      '<button class="ghost-btn" type="button" data-search-retry>try again</button>');
  }

  if (!search.results.length) return noteHTML(SEARCH_STATES.empty, 'empty');

  const showing = search.results.slice(0, search.visible);

  return '<div class="grid">' + showing.map(function (result) {
    return discoverTileHTML(result, true);
  }).join('') + '</div>' +
    (search.visible < search.results.length ? loadMoreHTML(false) : '');
}

function browseBodyHTML() {
  const state = Discover.snapshot();

  if (state.status === 'loading') return discoverNoteHTML('loading');

  if (state.status === 'error') {
    return discoverNoteHTML('error',
      '<p class="empty-reason">' + esc(state.reason) + '</p>' +
      '<button class="ghost-btn" type="button" data-discover-retry>try again</button>');
  }

  if (!state.results.length) return discoverNoteHTML('empty');

  return '<div class="grid">' + state.results.map(function (result) {
    return discoverTileHTML(result, false);
  }).join('') + '</div>' +
    (state.exhausted ? '' : loadMoreHTML(state.status === 'more'));
}

function discoverBodyHTML() {
  return Discover.searching() ? searchBodyHTML() : browseBodyHTML();
}

/* Only the body is replaced as searches come and go, so the field
   keeps its value, its caret and the reader's attention. */
function renderDiscoverBody() {
  const body = document.getElementById('discBody');
  if (!body) { renderCollection(); return; }

  body.innerHTML = discoverBodyHTML();
  guardPosters();
  syncDiscoverChrome();
}

function syncDiscoverChrome() {
  const searching = Discover.searching();

  const clear = document.getElementById('discClear');
  if (clear) clear.hidden = !searching;

  const controls = dom.collection.querySelector('.disc-controls');
  if (!controls) return;

  controls.classList.toggle('is-paused', searching);
  Array.prototype.forEach.call(controls.querySelectorAll('.control-opt'), function (button) {
    button.disabled = searching;
  });

  const note = document.getElementById('controlPaused');
  if (note) note.hidden = !searching;
}

function discoverHTML() {
  return discoverSearchHTML() + discoverControlsHTML() +
    '<div class="disc-body" id="discBody">' + discoverBodyHTML() + '</div>';
}

/* Ornamental small caps, the same language as the tabs and the
   Discover filters. Choosing an order is reading, not editing, so
   it stays available to a locked session. */
function watchedSortHTML() {
  return '' +
    '<div class="disc-controls list-controls">' +
      '<div class="control-row">' +
        '<span class="control-label" id="ctl-watched-sort">Sort by</span>' +
        '<div class="control-set" role="group" aria-labelledby="ctl-watched-sort">' +
          WATCHED_SORTS.map(function (sort) {
            return '<button class="control-opt" type="button"' +
              ' data-watched-sort="' + esc(sort.value) + '"' +
              ' aria-pressed="' + (watchedSort === sort.value ? 'true' : 'false') + '">' +
              esc(sort.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>';
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
  if (collectionState === 'loading') {
    dom.collection.innerHTML = noteHTML(COLLECTION_STATES.loading, 'loading');
    return;
  }

  if (collectionState === 'error') {
    dom.collection.innerHTML = noteHTML(COLLECTION_STATES.error, 'error',
      '<p class="empty-reason">' + esc(collectionError) + '</p>' +
      '<button class="ghost-btn" type="button" data-collection-retry>try again</button>');
    return;
  }

  if (activeTab === 'discover') {
    const field = document.getElementById('discSearch');
    const hadFocus = Boolean(field) && document.activeElement === field;
    const caret = hadFocus ? field.selectionStart : null;

    dom.collection.innerHTML = discoverHTML();
    guardPosters();
    syncDiscoverChrome();

    if (hadFocus) {
      const restored = document.getElementById('discSearch');
      if (restored) {
        restored.focus();
        if (caret !== null) restored.setSelectionRange(caret, caret);
      }
    }

    Discover.kick();          // no-op unless nothing has been fetched yet
    return;
  }

  const films = Archive.byStatus(activeTab, watchedSort);
  const sorter = activeTab === 'watched' ? watchedSortHTML() : '';

  if (!films.length) {
    dom.collection.innerHTML = sorter + emptyHTML(activeTab);
    return;
  }

  dom.collection.innerHTML = sorter +
    '<div class="grid">' + films.map(tileHTML).join('') + '</div>';
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

/* Read-only visitors see every control, greyed rather than gone. */
function applyLockState() {
  const locked = !Auth.unlocked();

  document.body.classList.toggle('is-readonly', locked);
  dom.review.disabled = locked;
  dom.yearWatched.disabled = locked;
  dom.importBtn.disabled = locked;
  dom.unlockBtn.hidden = !locked;
  dom.lockBtn.hidden = locked;
  dom.editBadge.hidden = locked;
}

function render() {
  renderTabs();
  renderCollection();
  renderColophon();
  applyLockState();
}


/* ---- panel ---- */

function lockedAttr() {
  return Auth.unlocked() ? '' : ' disabled';
}

function renderStatusGroup(film) {
  dom.statusGroup.innerHTML = STATUSES.map(function (status) {
    return '<button class="opt" type="button" data-status="' + esc(status.value) + '"' +
      ' aria-pressed="' + (film.status === status.value ? 'true' : 'false') + '"' + lockedAttr() + '>' +
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
      ' aria-label="' + esc(meta.labels[level] + ' - ' + level + ' of 3, ' + meta.legend) + '"' + lockedAttr() + '>' +
        iconHTML(meta.icon, Boolean(value) && level <= value) +
      '</button>';
  }

  html += '<span class="rate-read' + (value ? ' is-set' : '') + '">' +
    esc(value ? meta.labels[value] : 'unrated') + '</span>';

  const group = kind === 'enjoyment' ? dom.enjoymentGroup : dom.fearGroup;
  group.innerHTML = html;
}

/* The year only means anything once a film has been watched. */
function renderYearField(film) {
  const value = film.yearWatched || '';
  dom.yearWatched.innerHTML = yearOptionsHTML(value);
  dom.yearWatched.value = value;
  dom.yearField.hidden = film.status !== 'watched';
}

function renderPanelControls(film) {
  renderStatusGroup(film);
  renderRatingGroup('enjoyment', film.enjoyment);
  renderRatingGroup('fear', film.fear);
  renderYearField(film);
}

function currentFilm() {
  return openFilmId ? Archive.get(openFilmId) : draftFilm;
}

function subLine(film) {
  const director = film.director || (panelDetail && panelDetail.director) || '';
  const year = film.year || 'year unknown';
  return director ? year + ' - directed by ' + director : String(year);
}

function renderPanelDetail(film) {
  const score = panelDetail && panelDetail.voteAverage ? panelDetail.voteAverage.toFixed(1) : '';
  const overview = panelDetail && panelDetail.overview ? panelDetail.overview : '';

  dom.panelSub.textContent = subLine(film);
  dom.panelScore.textContent = score;
  dom.panelOverview.textContent = overview;
  dom.panelScore.parentNode.hidden = !score;
  dom.panelOverview.hidden = !overview;
  dom.panelTmdb.hidden = !score && !overview;
}

function renderPanelFoot() {
  dom.panelFoot.textContent = draftFilm
    ? 'Not in your collection yet. Give it a standing or a rating and it joins.'
    : (Auth.unlocked()
      ? 'Kept in the archive. Changes are saved as you make them.'
      : 'Read only. Unlock at the foot of the page to make changes.');
}

/* One entry, whether it is already collected or still a Discover result. */
function openEntry(film, detail) {
  if (!film) return;

  const collected = Boolean(Archive.get(film.id));
  openFilmId = collected ? film.id : null;
  draftFilm = collected ? null : film;
  panelDetail = detail || (film.tmdbId ? Details.get(film.tmdbId) : null);

  if (dom.scrim.hidden) lastFocused = document.activeElement;

  dom.panelTitle.textContent = film.title;
  dom.review.value = film.review || '';
  renderPanelControls(film);
  renderPanelDetail(film);
  renderPanelFoot();

  dom.scrim.hidden = false;
  document.body.classList.add('is-locked');
  dom.panel.focus();

  /* fill in whatever the payload did not carry - usually the director */
  if (film.tmdbId) {
    const wanted = film.tmdbId;
    Details.load(wanted, function (loaded) {
      if (!loaded) return;
      const open = currentFilm();
      if (!open || open.tmdbId !== wanted) return;   // the panel moved on

      panelDetail = Object.assign({}, panelDetail, {
        voteAverage: loaded.voteAverage || (panelDetail && panelDetail.voteAverage) || 0,
        overview: loaded.overview || (panelDetail && panelDetail.overview) || '',
        director: loaded.director || (panelDetail && panelDetail.director) || ''
      });

      /* a collected film may as well keep the director it just learned */
      if (openFilmId && loaded.director && !open.director) {
        Archive.update(openFilmId, { director: loaded.director });
      }
      renderPanelDetail(currentFilm() || open);
    });
  }
}

function openPanel(id) {
  openEntry(Archive.get(id), null);
}

/* A Discover tile: the film is not in the collection yet. */
function openDiscoverEntry(tmdbId) {
  const result = Discover.find(tmdbId);
  const held = collectedByTmdb(tmdbId);

  /* already on the shelves: open the entry that exists, with its
     own ratings and review, rather than a fresh draft */
  if (held) {
    openEntry(Archive.get(held.id), result ? detailFromResult(result) : null);
    return;
  }

  if (!result) return;
  openEntry(draftFromResult(result), detailFromResult(result));
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
  draftFilm = null;
  panelDetail = null;

  if (returning) {
    returning.focus();
  } else if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus();
  }
  lastFocused = null;
}

/* The grid behind the panel only needs rebuilding when it shows films. */
function refreshChrome() {
  if (activeTab === 'discover') {
    renderTabs();
    renderColophon();
  } else {
    render();
  }
}

/* Write a change, refresh the panel controls and the grid behind it.
   Field values are left alone so typing is never interrupted.

   Editing anything on a Discover film puts it into the collection:
   with the standing that was chosen, or as watched, since rating or
   writing about something implies having seen it. */
function commit(patch, refreshControls) {
  if (!Auth.unlocked()) return;
  const open = currentFilm();
  if (!open) return;

  let film;

  if (openFilmId) {
    film = Archive.update(openFilmId, patch);
  } else {
    const joining = Object.assign({}, draftFilm, patch);
    if (patch.status === undefined) joining.status = 'watched';

    film = Archive.add(joining) || Archive.update(joining.id, joining);
    openFilmId = joining.id;
    draftFilm = null;

    Discover.dismiss(open.tmdbId);
    renderPanelFoot();
  }

  if (!film) return;
  if (refreshControls) renderPanelControls(film);
  refreshChrome();
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

  const asks = Boolean(options.prompt);
  dom.confirmField.hidden = !asks;
  dom.confirmInput.value = '';
  dom.confirmNote.hidden = !options.note;
  dom.confirmNote.textContent = options.note || '';

  dom.confirmScrim.hidden = false;
  document.body.classList.add('is-locked');
  if (asks) dom.confirmInput.focus(); else dom.confirmPanel.focus();
}

function closeConfirm() {
  if (dom.confirmScrim.hidden) return;
  dom.confirmScrim.hidden = true;
  confirmAction = null;
  if (dom.scrim.hidden) document.body.classList.remove('is-locked');
}

let unsavedFilms = null;

function showNotice(message) {
  dom.noticeText.textContent = message + ' The change is still here, and unsaved.';
  dom.notice.hidden = false;
}

function hideNotice() {
  dom.notice.hidden = true;
  unsavedFilms = null;
}

/* A PIN is proved by using it: the collection is written back
   unchanged, and the archive either accepts it or does not. */
function attemptUnlock(value) {
  const pin = String(value || '').trim();
  if (!pin) { promptForPin('Enter the PIN to continue.'); return; }

  if (collectionState !== 'ready') {
    openConfirm({
      eyebrow: 'Edit mode',
      title: 'Not yet',
      body: 'The collection has not been read yet, so there is nothing safe to write back. Let it load, then unlock.',
      cancelLabel: 'close'
    });
    return;
  }

  /* try the PIN before committing it, so the interface never
     flickers open on a PIN the archive is about to refuse */
  Store.push(Archive.all(), pin)
    .then(function (saved) {
      Auth.unlock(pin);
      Archive.hydrate(saved);
      hideNotice();
      render();
    })
    .catch(function (error) {
      promptForPin(error && error.message ? error.message : 'That PIN was refused.');
    });
}

function promptForPin(note) {
  openConfirm({
    eyebrow: 'Edit mode',
    title: 'Unlock the ledger',
    body: 'Editing is kept behind a PIN. It is checked by the archive, held for this tab alone, and forgotten when the tab closes.',
    prompt: true,
    note: note || '',
    confirmLabel: 'unlock',
    cancelLabel: 'stay read-only',
    onConfirm: attemptUnlock
  });
}

function lockSession() {
  Auth.lock();
  hideNotice();
  closePanel();
  render();
}

function boot() {
  collectionState = 'loading';
  collectionError = '';
  render();

  Store.load()
    .then(function (films) {
      Archive.hydrate(films);
      collectionState = 'ready';
      render();
      Posters.loadAll(Archive.all());
    })
    .catch(function (error) {
      collectionState = 'error';
      collectionError = error && error.message ? error.message : 'The archive did not answer.';
      render();
    });
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

/* Enough of a check to refuse a file that is plainly not a
   collection. The archive is the authority on shape - whatever it
   stores comes back in the response and replaces this copy. */
function readableCollection(value) {
  if (!Array.isArray(value)) return null;

  const films = value.filter(function (film) {
    return film && typeof film === 'object' &&
      typeof film.id === 'string' && film.id &&
      typeof film.title === 'string' && film.title;
  });

  return films.length || value.length === 0 ? films : null;
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
      incoming = readableCollection(JSON.parse(reader.result));
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

        Store.push(Archive.all())
          .then(function (saved) {
            Archive.hydrate(saved);
            hideNotice();
            render();
            Posters.loadAll(Archive.all());
          })
          .catch(function (error) {
            unsavedFilms = incoming;
            showNotice(error && error.message ? error.message : 'The import could not be saved.');
          });
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

dom.collection.addEventListener('input', function (event) {
  if (event.target && event.target.id === 'discSearch') Discover.type(event.target.value);
});

dom.collection.addEventListener('click', function (event) {
  if (event.target.closest('[data-collection-retry]')) { boot(); return; }
  if (event.target.closest('[data-search-retry]')) { Discover.retrySearch(); return; }

  if (event.target.closest('#discClear')) {
    const field = document.getElementById('discSearch');
    if (field) { field.value = ''; field.focus(); }
    Discover.type('');
    return;
  }

  const filter = event.target.closest('[data-discover-filter]');
  if (filter) {
    Discover.setFilter(filter.dataset.discoverFilter, filter.dataset.value);
    return;
  }

  if (event.target.closest('[data-discover-more]')) { Discover.more(); return; }
  if (event.target.closest('[data-discover-retry]')) { Discover.retry(); return; }

  const action = event.target.closest('[data-discover-add]');
  if (action) {
    /* the quick actions must not also open the entry behind them */
    event.stopPropagation();
    event.preventDefault();
    const status = action.dataset.discoverAdd;
    adopt(Number(action.dataset.tmdb), status, status === 'watched');
    return;
  }

  const sortChoice = event.target.closest('[data-watched-sort]');
  if (sortChoice) {
    const chosen = sortChoice.dataset.watchedSort;
    if (isWatchedSort(chosen) && chosen !== watchedSort) {
      watchedSort = chosen;
      Prefs.set('watchedSort', chosen);
      renderCollection();
    }
    return;
  }

  const discoverTile = event.target.closest('.tile--discover');
  if (discoverTile) {
    openDiscoverEntry(Number(discoverTile.dataset.tmdb));
    return;
  }

  const tile = event.target.closest('.tile');
  if (tile && tile.dataset.id) openPanel(tile.dataset.id);
});

dom.collection.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const sortChoice = event.target.closest('[data-watched-sort]');
  if (sortChoice) {
    const chosen = sortChoice.dataset.watchedSort;
    if (isWatchedSort(chosen) && chosen !== watchedSort) {
      watchedSort = chosen;
      Prefs.set('watchedSort', chosen);
      renderCollection();
    }
    return;
  }

  const discoverTile = event.target.closest('.tile--discover');
  if (discoverTile && event.target.closest('.tile-art')) {
    event.preventDefault();
    openDiscoverEntry(Number(discoverTile.dataset.tmdb));
    return;
  }

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

  const film = currentFilm();
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
  const film = currentFilm();
  if (film) renderRatingGroup(group.dataset.rating, film[group.dataset.rating]);
});

dom.yearWatched.addEventListener('change', function () {
  commit({ yearWatched: dom.yearWatched.value }, false);
});

dom.review.addEventListener('input', function () {
  commit({ review: dom.review.value }, false);
});

dom.scrim.addEventListener('mousedown', function (event) {
  if (event.target === dom.scrim) closePanel();
});

Store.listen(
  function (saved, settled, generation) {
    hideNotice();
    /* only take the archive's copy when nothing newer is waiting,
       and never when the collection has been swapped out since */
    if (!settled) return;
    if (generation !== undefined && generation !== Archive.generation()) return;
    Archive.hydrate(saved);
    render();
  },
  function (message, films) {
    unsavedFilms = films;
    showNotice(message);
  }
);

dom.exportBtn.addEventListener('click', exportCollection);

dom.unlockBtn.addEventListener('click', function () { promptForPin(''); });

dom.lockBtn.addEventListener('click', lockSession);

dom.noticeDismiss.addEventListener('click', hideNotice);

dom.noticeRetry.addEventListener('click', function () {
  dom.noticeText.textContent = 'Trying the archive again.';
  Store.push(Archive.all())
    .then(function (saved) {
      Archive.hydrate(saved);
      hideNotice();
      render();
    })
    .catch(function (error) {
      showNotice(error && error.message ? error.message : 'The change could not be saved.');
    });
});

dom.importBtn.addEventListener('click', function () { dom.importFile.click(); });

dom.importFile.addEventListener('change', function () {
  const file = dom.importFile.files && dom.importFile.files[0];
  dom.importFile.value = '';        // so the same file can be chosen twice
  if (file) importCollection(file);
});

function submitConfirm() {
  const action = confirmAction;
  const typed = dom.confirmField.hidden ? null : dom.confirmInput.value;
  closeConfirm();
  if (action) action(typed);
}

dom.confirmYes.addEventListener('click', submitConfirm);

dom.confirmInput.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') { event.preventDefault(); submitConfirm(); }
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

boot();
