# SF Symbols asset catalog

Catalog version: `v1.0.0`

The host asset source is SF Symbols `7.2`. Project SVGs exported by Apple's app retain their original CoreSVG geometry and are consumed as CSS masks. Keep canonical Apple symbol names as filenames; consult the host `name_aliases.strings` and `name_availability.plist` before adding or renaming an asset.

## Active migration

- `waveform.and.person.filled` was renamed to its canonical SF Symbols 7 name, `waveform.and.person`. The geometry remains compatible with the existing Live Trading control.
- Grid Trading uses `square.grid.3x3.topleft.filled`, distinct from Backtest's `square.stack.3d.down.forward.fill`.

## Reserved assets

These already-exported symbols are intentionally kept for upcoming controls and status states:

- `arrow.up.document.fill`: import or publish action
- `arrow.up.page.on.clipboard`: clipboard import action
- `calendar.badge.checkmark`: scheduled-data success state
- `chart.bar.xaxis.ascending`: performance analytics
- `circle.badge.plus`: additive compact action
- `clock.arrow.trianglehead.counterclockwise.rotate.90`: history or retry state
- `lock.badge.checkmark.fill`: authorized or protected state
- `menubar.arrow.down.rectangle`: compact download action
- `menubar.arrow.up.rectangle`: compact upload action
- `slider.horizontal.2.square.on.square`: enabled parameter tuning
- `square.and.arrow.down.badge.clock`: deferred export state

Do not delete reserved assets solely because no production selector currently references them. Brand logos and `ticker-placeholder.svg` are not SF Symbols assets.
