/* =====================================================================
   Shared settings and page geometry.

   These values are global to the app: they are changed from either the
   Note Painter tab or the Settings tab and are read by the output
   builder, the painter and the importer.

   Page size:
     normal  = 8 columns x 10 rows  (80 tiles, no newlines)
     overlap = 5 columns x  6 rows  (30 tiles, one newline per row)
   ===================================================================== */

(function (MG) {
  'use strict';

  const byId = MG.byId;

  // The stroke tag stays open for the whole page, so it costs characters AND
  // takes one of the open-tag slots that color tags would otherwise use.
  const STROKE_TAG = '<stroke thickness="5">';

  function getMaxOpen() {
    return Math.max(0, settings.nestingLimit + 1 - (settings.strokeMode ? 1 : 0));
  }

  function getColsPerPaper() {
    return settings.overlapMode ? 5 : 8;
  }

  function getRowsPerPaper() {
    return settings.overlapMode ? 6 : 10;
  }

  function getTileCount() {
    return getColsPerPaper() * getRowsPerPaper();
  }

  // Base character count: opening tag + all @ plus (overlap only) newlines
  function baseCharCount() {
    const n = getTileCount();
    const newlines = settings.overlapMode ? Math.ceil(n / getColsPerPaper()) : 0;
    return "<font face='Legacy'>".length + (settings.strokeMode ? STROKE_TAG.length : 0) + n + newlines;
  }

  // Refresh every label that depends on nesting / overlap / stroke
  function updateLabels() {
    byId('nestVal').textContent = settings.nestingLimit;
    byId('setNestVal').textContent = settings.nestingLimit;
    byId('nestTags').textContent = getMaxOpen();
    byId('setInfo').innerHTML =
      `Color tags that can be open at once: <b>${getMaxOpen()}</b><br>` +
      `Characters left for color tags per page: <b>${Math.max(0, settings.CHAR_LIMIT - baseCharCount())}</b>`;
  }

  // ---------------------------------------------------------------------
  //  Setting setters (kept in sync across all three sliders/checkboxes)
  // ---------------------------------------------------------------------

  function setNestingLimit(n) {
    settings.nestingLimit = Math.max(0, Math.min(8, n | 0));
    ['nest', 'nest2', 'setNest'].forEach(id => byId(id).value = settings.nestingLimit);
    updateLabels();
    MG.paper.render();
    if (MG.cropEditor.hasImage()) MG.importer.scheduleRecompute(120);
  }

  function setStrokeMode(on) {
    if (settings.strokeMode === on) return;
    settings.strokeMode = on;
    byId('setStroke').checked = on;
    document.body.classList.toggle('stroke-on', on);   // black preview backgrounds
    updateLabels();
    MG.paper.render();
    if (MG.cropEditor.hasImage()) MG.importer.scheduleRecompute(0);
  }

  function setOverlapMode(on) {
    if (settings.overlapMode === on) return;
    settings.overlapMode = on;
    MG.paper.resizeToTileCount(getTileCount());
    if (byId('ovl').checked !== on) byId('ovl').checked = on;
    if (byId('setOvl').checked !== on) byId('setOvl').checked = on;
    updateLabels();
    MG.importer.updatePaperLayout();
    MG.paper.render();
  }

  // ---------------------------------------------------------------------
  //  Wiring / initial values
  // ---------------------------------------------------------------------

  function init() {
    ['nest', 'nest2', 'setNest'].forEach(id => byId(id).value = settings.nestingLimit);
    byId('ovl').checked = settings.overlapMode;
    byId('setOvl').checked = settings.overlapMode;
    byId('setStroke').checked = settings.strokeMode;
    updateLabels();

    byId('nest').oninput = e => setNestingLimit(+e.target.value);
    byId('nest2').oninput = e => setNestingLimit(+e.target.value);
    byId('setNest').oninput = e => setNestingLimit(+e.target.value);
    byId('setStroke').onchange = e => setStrokeMode(e.target.checked);
    byId('ovl').onchange = e => setOverlapMode(e.target.checked);
    byId('setOvl').onchange = e => setOverlapMode(e.target.checked);
  }

  const settings = MG.settings = {
    CHAR_LIMIT: 400,
    nestingLimit: 2,      // 0-8, slider value
    overlapMode: false,   // when true, each paper is 5x6 (with newlines)
    strokeMode: false,    // when true, every page starts with a <stroke> tag

    getMaxOpen,
    getColsPerPaper,
    getRowsPerPaper,
    getTileCount,
    baseCharCount,
    updateLabels,
    setNestingLimit,
    setStrokeMode,
    setOverlapMode,
    init,
  };

  MG.STROKE_TAG = STROKE_TAG;

})(window.MG = window.MG || {});
