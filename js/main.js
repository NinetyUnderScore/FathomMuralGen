/* =====================================================================
   Entry point.

   Scripts are plain classic scripts (no modules) so the app still works
   when index.html is opened directly from disk. Initialisation is explicit
   and ordered here; every other file only defines functions and state.
   ===================================================================== */

(function (MG) {
  'use strict';

  MG.bindTabs();

  MG.picker.init();       // color picker + click-mode buttons
  MG.paper.init();        // tile array + paper DOM + toolbar
  MG.settings.init();     // sliders/checkboxes + labels
  MG.cropEditor.init();   // image loading + crop interaction
  MG.importer.init();     // importer controls + paper layout

  MG.paper.render();      // first paint of the Note Painter

})(window.MG);
