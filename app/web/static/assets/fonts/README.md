# Code version: v0.4.0

`UniversNextforHSBC.ttc` is the only approved Western typeface source used by
the web application. Its SHA-256 is
`e10a317b9da0016c24a9fce70ccbd33eb39458da15253d5abfe051d8cc33e21a`.

Run `python3 scripts/build_web_fonts.py` from the repository root to reproduce
the nine browser-transport TTF faces. They are not alternate typefaces: the
extractor relocates the TTC tables without changing glyphs, metrics, or
PostScript names. Chromium otherwise selects the collection's first Bold face
for every CSS weight.

`foundation/fonts.css` maps each extracted PostScript face to its CSS weight
and style:

- Ultra Light: `100`, normal and italic
- Thin: `200`, normal and italic
- Light: `300`, normal and italic
- Regular: `400`, normal
- Medium: `500` through `600`, normal
- Bold: `700` through `900`, normal

KaTeX retains its vendored mathematical glyph fonts as a scoped formula-rendering
exception; they do not participate in ordinary interface text.

To update the collection, replace this single source file with the approved host font,
verify its SHA-256 checksum, inspect its face metadata, and update the CSS map
only when the supplied PostScript face names or available styles change. Only
add fonts that are licensed for self-hosted web use in this application.
