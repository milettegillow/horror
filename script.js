/* ============================================================
   horror - a ledger of the gothic
   ------------------------------------------------------------
   Section 1  Data layer   (swap for API + database later)
   Section 2  View state
   Section 3  Rendering
   Section 4  Events
   ============================================================ */


/* ------------------------------------------------------------
   1. DATA LAYER
   ------------------------------------------------------------
   Everything below this comment block is the only part that
   knows where films come from. The renderer never touches the
   array directly - it asks Archive for copies and posts changes
   back through Archive.update(). Replacing SEED_FILMS with a
   fetch() and Archive.update() with a PATCH is the whole job.

   film = {
     id, title, year, director, posterUrl,
     status:  "to_watch" | "watched" | "banished",
     verdict: "loved" | "meh" | "nope" | null,
     scare:   1 | 2 | 3 | null,
     review:  string,
     yearWatched: string
   }
   ------------------------------------------------------------ */

const SEED_FILMS = [
  {
    id: 'nosferatu-1922',
    title: 'Nosferatu',
    year: 1922,
    director: 'F. W. Murnau',
    posterUrl: '',
    status: 'watched',
    verdict: 'loved',
    scare: 2,
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
    verdict: null,
    scare: null,
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
    verdict: null,
    scare: null,
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
    verdict: 'loved',
    scare: 3,
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
    verdict: 'loved',
    scare: 3,
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
    verdict: 'meh',
    scare: 2,
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
    verdict: 'loved',
    scare: 3,
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
    verdict: null,
    scare: null,
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
    verdict: 'nope',
    scare: 1,
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
    verdict: 'meh',
    scare: 1,
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
    verdict: 'loved',
    scare: 1,
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
    verdict: null,
    scare: null,
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
    verdict: 'nope',
    scare: 3,
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
    verdict: null,
    scare: null,
    review: '',
    yearWatched: ''
  }
];

const Archive = (function () {
  const films = SEED_FILMS.map(function (film) { return Object.assign({}, film); });

  function copy(film) { return Object.assign({}, film); }

  return {
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
   2. VIEW STATE AND VOCABULARY
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

const VERDICTS = [
  { value: 'loved', label: 'loved it' },
  { value: 'meh',   label: 'meh' },
  { value: 'nope',  label: 'not for me' }
];

const EMPTY_STATES = {
  to_watch: {
    kicker: 'The shelf is bare',
    title: 'Nothing waiting',
    body: 'Every film has been seen or sent away. Something will turn up.'
  },
  watched: {
    kicker: 'No records',
    title: 'Nothing watched yet',
    body: 'The ledger begins the moment you finish the first one.'
  },
  banished: {
    kicker: 'Mercifully quiet',
    title: 'Nothing banished',
    body: 'No film has yet earned its way out of the collection. Yet.'
  },
  discover: {
    kicker: 'Not yet connected',
    title: 'Discover',
    body: 'This page will surface the top-rated horror and gothic cinema once the archive is connected - the canonical, the neglected and the quietly awful alike.'
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
  verdictGroup: document.getElementById('verdictGroup'),
  scareGroup: document.getElementById('scareGroup'),
  yearWatched: document.getElementById('yearWatched'),
  review: document.getElementById('review')
};


/* ------------------------------------------------------------
   3. RENDERING
   ------------------------------------------------------------ */

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function verdictLabel(value) {
  const found = VERDICTS.find(function (v) { return v.value === value; });
  return found ? found.label : '';
}

function marksHTML(scare) {
  let html = '<span class="marks" aria-hidden="true">';
  for (let i = 1; i <= 3; i += 1) {
    html += '<span class="mark' + (scare && i <= scare ? ' is-on' : '') + '"></span>';
  }
  return html + '</span>';
}

function tileHTML(film) {
  const hasPoster = Boolean(film.posterUrl);
  const marks = [];

  if (film.verdict) {
    marks.push('<span class="tile-verdict">' + esc(verdictLabel(film.verdict)) + '</span>');
  }
  if (film.verdict && film.scare) {
    marks.push('<span class="bar" aria-hidden="true"></span>');
  }
  if (film.scare) {
    marks.push('<span class="scare-hold" title="Scare ' + film.scare + ' of 3">' + marksHTML(film.scare) + '</span>');
  }

  const readout = [];
  if (film.verdict) readout.push(verdictLabel(film.verdict));
  if (film.scare) readout.push('scare ' + film.scare + ' of 3');

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
        (marks.length ? '<div class="tile-marks">' + marks.join('') + '</div>' : '') +
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
  dom.tabs.innerHTML = TABS.map(function (tab) {
    const count = tab.counted ? Archive.count(tab.id) : 0;
    return '' +
      '<button class="tab" type="button" role="tab" data-tab="' + tab.id + '"' +
      ' aria-selected="' + (activeTab === tab.id ? 'true' : 'false') + '">' +
        '<span class="tab-label">' + tab.label + '</span>' +
        '<span class="tab-count">' + String(count).padStart(2, '0') + '</span>' +
      '</button>';
  }).join('');
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

/* If a poster path ever fails to load, fall back to the plate
   rather than leaving a broken image in the grid. */
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

function render() {
  renderTabs();
  renderCollection();
}


/* ---- panel ---- */

function optionHTML(value, label, pressed, kind) {
  return '' +
    '<button class="opt" type="button" data-' + kind + '="' + esc(value) + '"' +
    ' aria-pressed="' + (pressed ? 'true' : 'false') + '">' + esc(label) + '</button>';
}

function renderPanelControls(film) {
  dom.statusGroup.innerHTML = STATUSES.map(function (status) {
    return optionHTML(status.value, status.label, film.status === status.value, 'status');
  }).join('');

  dom.verdictGroup.innerHTML = VERDICTS.map(function (verdict) {
    return optionHTML(verdict.value, verdict.label, film.verdict === verdict.value, 'verdict');
  }).join('');

  let scareHTML = '';
  for (let level = 1; level <= 3; level += 1) {
    scareHTML += '' +
      '<button class="scare-btn" type="button" data-scare="' + level + '"' +
      ' aria-pressed="' + (film.scare === level ? 'true' : 'false') + '"' +
      ' aria-label="Scare ' + level + ' of 3">' +
        '<span class="mark' + (film.scare && level <= film.scare ? ' is-on' : '') + '"></span>' +
      '</button>';
  }
  scareHTML += '<span class="scare-read">' + (film.scare ? film.scare + ' of 3' : 'unrated') + '</span>';
  dom.scareGroup.innerHTML = scareHTML;
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
   4. EVENTS
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

  if (button.dataset.verdict) {
    const next = film.verdict === button.dataset.verdict ? null : button.dataset.verdict;
    commit({ verdict: next }, true);
    return;
  }

  if (button.dataset.scare) {
    const level = Number(button.dataset.scare);
    commit({ scare: film.scare === level ? null : level }, true);
  }
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
