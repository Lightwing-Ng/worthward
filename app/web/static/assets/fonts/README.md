# Code version: v0.3.0

`UniversNextforHSBC.ttc` is the self-hosted Univers Next for HSBC OpenType
collection used by the web application.

It is the sole HSBC font source. `foundation/fonts.css` maps each available
PostScript face from the collection to its CSS weight and style:

- Ultra Light: `100`, normal and italic
- Thin: `200`, normal and italic
- Light: `300`, normal and italic
- Regular: `400`, normal
- Medium: `500` through `600`, normal
- Bold: `700` through `900`, normal

To update the collection, replace this single file with the approved host font,
verify its SHA-256 checksum, inspect its face metadata, and update the CSS map
only when the supplied PostScript face names or available styles change. Only
add fonts that are licensed for self-hosted web use in this application.
