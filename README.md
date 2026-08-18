# horror

A single-page tracker for horror and gothic film. Static site, no build step, no
framework, no dependencies beyond Google Fonts.

## Files

    index.html      markup and the inline SVG ornament sprite
    styles.css      the whole design
    script.js       data layer, poster service, rendering, events
    api/tmdb.js     serverless proxy to TMDB (keeps the API key server-side)

## Running it

Opening `index.html` directly works, but `/api/tmdb` will not resolve, so every
tile falls back to its ornamental plate and Discover shows its error state. To
see real posters and recommendations:

    npm i -g vercel
    cp .env.example .env        # then paste your TMDB key into it
    vercel dev

Get a key from https://www.themoviedb.org/settings/api. `.env` is git-ignored and
the key is only ever read by the serverless function, never sent to the browser.

## State of things

Film data is hardcoded in `script.js` behind an `Archive` façade, which hands out
copies and takes writes through `Archive.update()`. Swapping the seed array for a
real API and database means changing that one module. Edits live in memory only -
a refresh resets everything, which is expected for now.
