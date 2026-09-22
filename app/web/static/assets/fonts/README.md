# Code version: v2.0.0

`UniversNextforHSBC.ttc` is Worthward's sole approved Western typeface source.
The repository maintainer has explicitly authorized its bundled use. Its pinned
SHA-256 is `e10a317b9da0016c24a9fce70ccbd33eb39458da15253d5abfe051d8cc33e21a`.

Run `python3 scripts/build_web_fonts.py` from the repository root to reproduce
all nine browser-transport TTF faces. These files are not alternate typefaces:
the standard-library extractor verifies source and table checksums, relocates
the tables, and rebuilds each standalone font checksum without changing glyphs,
metrics, or PostScript names.

CSS references each standalone face because Chromium does not reliably select a
requested face from a TTC URL fragment. Weight mappings are UltraLight 100,
Thin 200, Light 300, Regular 400, Medium 500 through 600, and Bold 700 through
900. UltraLight, Thin, and Light also include italic faces.

All Western interface text uses this family, including technical, code, path,
URL, and diagnostic text. CJK fallbacks remain available only for glyphs absent
from the collection. KaTeX keeps its vendored mathematical glyph fonts as the
sole scoped exception.

Do not add another Western typeface, restore a system or monospace stack, edit a
derived TTF independently, or replace the TTC without explicit maintainer
direction. Update the pinned checksum, extractor face order, CSS mapping, and
contract tests together after any approved source replacement. The cross-project
authority is
[`../../../../../../shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md`](../../../../../../shared_docs/SHARED_UI_TYPOGRAPHY_CONTRACT.md).
