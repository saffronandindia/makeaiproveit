# makeaiproveit.com

Static one-page site for Axcel, served on Railway from this repo.

    public/      the site (index.html, images, icons, robots, sitemap)
    server.js    zero-dependency static server
    railway.json Railway build and deploy config
    tools/       maintenance scripts

## Running locally

    npm start          # http://localhost:3000

No install step. There are no dependencies.

## Environment

| Variable         | Purpose                                            |
|------------------|----------------------------------------------------|
| `PORT`           | Set by Railway automatically.                      |
| `CANONICAL_HOST` | Set to `makeaiproveit.com` to send www to the bare domain. |

## How the site is generated

`public/` is built from the design source in the Axcel project, not edited by
hand. The build writes the photos out as separate files with a content hash in
each filename, so they can be cached for a year and a changed photo always
busts the cache. The HTML is about 39 KB; the photos load alongside it rather
than blocking it.

Do not hand-edit `public/index.html` — regenerate it, or the next build will
overwrite the change.

## Image provenance

Some file-delivery pipelines stamp images with a C2PA "Content Credentials"
manifest claiming an AI may have created or modified them. That is not true of
these photographs, and on this site in particular it is actively misleading.

Before publishing, run:

    node tools/strip-provenance.js

It removes only the APP11 (JPEG) or caBX (PNG) segment. Image data is never
re-encoded — the result is byte-identical to the original photograph. The
script is safe to run repeatedly; it reports "nothing to strip" when clean.
