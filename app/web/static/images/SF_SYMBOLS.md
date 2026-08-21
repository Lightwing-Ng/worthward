# SF Symbols asset catalog

Catalog version: `v1.1.0`

The asset source audited on 12 Aug 2026 is the official SF Symbols `7.2` app,
build `119`. Project SVGs retain Apple's CoreSVG geometry and are consumed as
monochrome CSS masks.

## Export contract

- Use `Edit -> Copy Image As... -> SVG` in the SF Symbols app.
- Keep `SF Pro`, `Regular`, `20 pt`, and `Large`, which produce the compact
  `Apple Native CoreSVG 341` files used by this directory.
- Do not use `File -> Export Symbol...`; it produces a `3,300 x 2,200` Xcode
  symbol template rather than a compact web asset.
- Keep the official symbol name as the filename. Check both
  `name_aliases.strings` and `name_availability.plist` inside the installed app;
  an alias replacement takes precedence over a legacy availability entry.
- Use these assets only as interface glyphs in contexts permitted by Apple's
  license. Never use an SF Symbol in an app icon, logo, trademark, or other
  source identifier. Exclude symbols whose inspector limits them to an Apple
  product, service, or feature. Review the current
  [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)
  before distribution.

## 7.2 audit result

- `waveform.and.person.filled` is the official name returned by the SF Symbols
  app and its `Copy Name` command. The invalid local rename
  `waveform.and.person` has been reverted without changing the Live Trading
  control's geometry.
- `arrow.left`, `key.circle.fill`, `lock.badge.checkmark.fill`, and
  `lines.measurement.horizontal.aligned.bottom` match fresh 7.2 exports by
  `viewBox` and normalized CoreSVG element geometry.
- Existing official filenames have no current replacements in the 7.2 alias
  map after the Live Trading correction.
- The legacy standalone Grid Trading icon asset `square.grid.3x3.topleft.filled`
  remains reserved; the canonical Backtest workspace uses
  `square.stack.3d.down.forward.fill` for the shared strategy surface.

## Reserved trading assets

These exported symbols are intentionally retained for upcoming trading
controls and states even when no production selector references them yet.

### Market data and analysis

- `chart.xyaxis.line`: generic price history
- `chart.line.uptrend.xyaxis`: advancing trend
- `chart.line.downtrend.xyaxis`: declining trend
- `chart.line.flattrend.xyaxis`: sideways trend
- `chart.dots.scatter`: factor or correlation analysis
- `chart.pie.fill`: allocation breakdown
- `chart.bar.xaxis.ascending`: ranked performance analytics

### Portfolios, orders, and records

- `briefcase.fill`: portfolio or account workspace
- `arrow.left.arrow.right`: position or account transfer
- `arrow.up.and.down.square`: two-sided order flow
- `list.bullet.clipboard.fill`: order blotter
- `clock.badge`: pending or time-in-force state
- `calendar.badge.clock`: scheduled order or event
- `rectangle.stack.badge.plus`: watchlist or strategy collection
- `chart.line.text.clipboard.fill`: market or execution report
- `text.page.badge.magnifyingglass`: filing or research inspection

### Money, monitoring, and risk

- `building.columns.fill`: bank or custodian account
- `dollarsign.circle.fill`: cash balance
- `percent`: return, yield, or fee rate
- `bell.fill`: price or order alert
- `bolt.fill`: realtime state
- `star.fill`: watchlist favorite
- `magnifyingglass`: ticker search
- `line.3.horizontal.decrease.circle`: market or transaction filter
- `gauge.with.dots.needle.50percent`: exposure or risk gauge
- `exclamationmark.triangle.fill`: warning state
- `exclamationmark.shield.fill`: security or risk exception
- `lock.shield.fill`: protected trading action

### Import, export, and authorization

- `arrow.up.document.fill`: import or publish action
- `arrow.up.page.on.clipboard`: clipboard import action
- `calendar.badge.checkmark`: scheduled-data success state
- `circle.badge.plus`: additive compact action
- `clock.arrow.trianglehead.counterclockwise.rotate.90`: history or retry state
- `lock.badge.checkmark.fill`: authorized or protected state
- `menubar.arrow.down.rectangle`: compact download action
- `menubar.arrow.up.rectangle`: compact upload action
- `slider.horizontal.2.square.on.square`: enabled parameter tuning
- `square.and.arrow.down.badge.clock`: deferred export state

Do not delete reserved assets solely because no production selector currently
references them. Brand logos, `loading.spinner.svg`, `favicon.svg`, and
`ticker-placeholder.svg` are project-specific rather than SF Symbols assets.
