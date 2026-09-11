# Code version: v1.0.0

Worthward does not bundle an interface typeface. Ordinary interface text uses
the operating-system stack declared by `--font-family-base`; CJK systems retain
their platform-specific glyph fallbacks.

KaTeX keeps its separately vendored mathematical glyph fonts as a scoped
formula-rendering exception. Any future bundled interface font must include a
redistribution license that is compatible with this repository's license.
