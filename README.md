# Ninety's Mural Generator

A static browser app for painting and importing Fathom murals. There is no
build step — open `index.html` directly in a browser.

## Structure

```
index.html              Markup for all four tabs (Note Painter, Importer, Settings, FAQ)
styles.css              All styling, including the responsive breakpoints

js/
  main.js               Entry point; initialises the modules in order
  core/
    dom.js              byId() helper
    settings.js         Shared state: nesting limit, overlap, stroke, page geometry,
                        character budget, setting setters + control wiring
    colors.js           HSV/RGB conversions and 3-digit-hex helpers
    glyph.js            Draws an '@' glyph stretched to an exact rectangle
    output.js           buildOutput(): tiles -> rich-text string + per-tile info
  ui/
    tabs.js             Top-level tab switching
    clipboard.js        Copy-to-clipboard with button confirmation
  painter/
    picker.js           Color picker, hex input, click-mode buttons
    paper.js            Tile state, paper DOM, redraw and statistics
  importer/
    crop.js             Image loading, crop rectangle, rotation, crop editor canvas
    sampling.js         Crop -> one RGB sample per tile (with color adjustments)
    solver.js           DP solver for optimal color runs and nested islands
    importer.js         Orchestration: debounced recompute, previews, multi-paper
                        layout, applying results to the painter
```

## How it fits together

- Every file is a plain (non-module) script. They share a single `window.MG`
  namespace and are loaded in dependency order at the end of `index.html`.
  This keeps `file://` opening working; ES modules would require a server.
- `MG.settings` is the single source of truth for nesting limit, overlap mode,
  stroke mode and derived page dimensions. Changing it re-renders the painter
  and schedules an importer recompute.
- **Painter pipeline:** tile click -> `MG.paper.render()` -> `MG.buildOutput()`
  -> output string + stats.
- **Importer pipeline:** image -> crop -> `MG.sampleTileColors()` ->
  `MG.solveColorRuns(tileColors, config)` (per paper) -> `MG.buildOutput()` ->
  preview canvases. Applying copies the selected paper's tiles into the painter.
- **Multi-paper parallelism:** papers are independent, so the importer solves
  them in a small pool of Web Workers (up to 4). The worker script is built
  from `MG.solveColorRuns.toString()`, so there is no duplicated solver code.
  If workers are unavailable or fail, the same solver runs on the main thread;
  results are identical either way. Recomputes are generation-tagged so a
  slower, superseded run can never overwrite newer results.

## Data model

A tile is `{ color, closes }`, where `color` is a 3-digit hex string (or `null`)
and `closes` is how many `</font>` tags to emit on that tile. Colors are
quantized to 4-bit channels (multiples of 17), which is what the 3-digit form
represents.
