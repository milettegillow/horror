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
   1. DATA LAYER
   ------------------------------------------------------------
   Everything below this comment block is the only part that
   knows where films come from. The renderer never touches the
   array directly - it asks Archive for copies and posts changes
   back through Archive.update(). Replacing SEED_FILMS with a
   fetch and Archive.update() with a PATCH is the whole job.

   film = {
     id, title, year, director, posterUrl,
     status:    "to_watch" | "watched" | "banished",
     enjoyment: 1 | 2 | 3 | null,   // how much I liked it
     fear:      1 | 2 | 3 | null,   // how scary it was
     review:    string,
     yearWatched: string
   }

   posterUrl starts empty and is filled in at runtime by the
   poster service below. Until it is, the tile draws its plate.
   ------------------------------------------------------------ */

const SEED_FILMS = [
  {
    id: 'nosferatu-1922',
    title: 'Nosferatu',
    year: 1922,
    director: 'F. W. Murnau',
    posterUrl: '',
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
    status: 'banished',
    enjoyment: 1,
    fear: 3,
    review: '',
    yearWatched: '2019'
  },
  {
    id: 'saint-maud-2019',
    title: 'Saint Maud',
    year: 2019,
    director: 'Rose Glass',
    posterUrl: '',
    status: 'to_watch',
    enjoyment: null,
    fear: null,
    review: '',
    yearWatched: ''
  }
];

const Archive = (function () {
  const films = SEED_FILMS.map(function (film) { return Object.assign({}, film); });

  function copy(film) { return Object.assign({}, film); }

  return {
    all: function () { return films.map(copy); },
    byStatus: function (status) {
      return films
        .filter(function (film) { return film.status === status; })
        .sort(function (a, b) { return a.year - b.year; })
        .map(copy);
    },
    get: function (id) {
      const film = films.find(function (f) { return f.id === id; });
      return film ? copy(film) : null;
    },
    count: function (status) {
      return films.filter(function (film) { return film.status === status; }).length;
    },
    update: function (id, patch) {
      const film = films.find(function (f) { return f.id === id; });
      if (!film) return null;
      Object.assign(film, patch);
      return copy(film);
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

const Posters = (function () {
  const cache = new Map();     // film id -> poster URL, or '' for "none found"
  const pending = new Set();

  function settle(film, url) {
    pending.delete(film.id);
    cache.set(film.id, url);
    if (!url) return;
    Archive.update(film.id, { posterUrl: url });
    paintPoster(film.id, url);
  }

  /* Decode before display, so a tile never flickers through a
     half-drawn or dead image. */
  function preload(film, url) {
    const probe = new Image();
    probe.onload = function () { settle(film, url); };
    probe.onerror = function () { settle(film, ''); };
    probe.src = url;
  }

  function request(film) {
    const query = TMDB_ENDPOINT +
      '?query=' + encodeURIComponent(film.title) +
      '&year=' + encodeURIComponent(film.year);

    fetch(query)
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        const results = data && Array.isArray(data.results) ? data.results : [];
        const first = results[0];
        const path = first && first.poster_path;
        if (path) {
          preload(film, POSTER_BASE + path);
        } else {
          settle(film, '');
        }
      })
      .catch(function () { settle(film, ''); });
  }

  return {
    urlFor: function (id) { return cache.get(id) || ''; },
    load: function (film) {
      if (cache.has(film.id) || pending.has(film.id)) return;
      pending.add(film.id);
      request(film);
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
  },
  discover: {
    kicker: 'Not yet connected',
    title: 'Discover',
    body: 'Once the archive is connected, this page will surface the top-rated horror and gothic cinema - the canonical, the neglected and the quietly awful alike. Until then it keeps its own counsel, and recommends nothing at all.'
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
  review: document.getElementById('review')
};


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
    dom.collection.innerHTML = emptyHTML('discover');
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

function render() {
  renderTabs();
  renderCollection();
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
  dom.panelSub.textContent = film.year + ' - directed by ' + film.director;
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
   5. EVENTS
   ------------------------------------------------------------ */

dom.tabs.addEventListener('click', function (event) {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  activeTab = tab.dataset.tab;
  render();
});

dom.collection.addEventListener('click', function (event) {
  const tile = event.target.closest('.tile');
  if (tile) openPanel(tile.dataset.id);
});

dom.collection.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const tile = event.target.closest('.tile');
  if (!tile) return;
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
    commit({ status: button.dataset.status }, true);
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

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') closePanel();
});

render();
Posters.loadAll(Archive.all());
