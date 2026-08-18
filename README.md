# horror

A single-page tracker for horror and gothic film. Static site, no build step, no
framework, no dependencies beyond Google Fonts.

## Files

    index.html          markup and the inline SVG ornament sprite
    styles.css          the whole design
    script.js           data layer, poster service, rendering, events
    api/collection.js   the collection, in Upstash Redis; PIN-gated writes
    api/seed.js         the films used once, to fill an empty archive
    api/tmdb.js         proxy to TMDB (keeps the API key server-side)

## Running it

The site now needs its API routes, so open it through a server rather than as a
file:

    npm i -g vercel
    cp .env.example .env        # then fill it in
    vercel dev

`.env` holds the Upstash REST URL and token, the edit PIN, and a TMDB key. It is
git-ignored, and none of it reaches the browser - the serverless functions are
the only things that read it.

Opened as a plain file, `/api/collection` will not resolve and the site shows its
designed error state rather than a collection.

## Discover

Discover browses TMDB's top-rated horror, filtered by decade and rating, with
anything already in the collection removed. The search field above the filters
looks up any film by name, in any genre - results are not filtered against the
collection but marked with the standing they already have, so searching answers
"do I have this?" as well as "what is this?". The browsable filters pause while
a search is running and return untouched when the field is cleared.

## State of things

Film data starts as a hardcoded seed in `script.js`, behind an `Archive` façade
that hands out copies and takes writes through `Archive.update()`. Swapping the
seed for a real API means changing that one module.

The collection lives in one Upstash Redis key, `horror:collection`. The browser
never talks to Redis - it calls `/api/collection`, which reads on GET and, on
POST, checks a PIN before replacing the whole array. Reading is public; writing
is not.

Client-side, the `Store` module at the top of `script.js` is the only thing that
knows any of this. It loads once at boot, keeps the collection in memory so the
interface never waits on the network, and pushes debounced writes back. A failed
write raises a notice and keeps the change rather than dropping it.

Without a PIN the site is read-only: every control that would change something is
disabled in place rather than hidden. The unlock control in the footer takes a
PIN, proves it against the archive, and holds it in sessionStorage for that tab
alone. Export and import still work, import through the same PIN-gated route.
