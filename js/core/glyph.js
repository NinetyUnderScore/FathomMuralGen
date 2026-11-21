/* =====================================================================
   Drawing an '@' glyph that fills an exact rectangle.

   The glyph is always drawn with the same font; its intrinsic metrics are
   measured once and then scaled so the glyph fills the requested box.
   ===================================================================== */

(function (MG) {
  'use strict';

  const GLYPH_METRICS = (() => {
    const g = document.createElement('canvas').getContext('2d');
    g.font = 'bold 100px monospace';
    const m = g.measureText('@');
    return {
      width:   m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      height:  m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
      centerX: (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
      centerY: (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2,
    };
  })();

  function drawAtGlyph(g, centerX, centerY, width, height, color, angle = 0) {
    g.save();
    g.translate(centerX, centerY);
    g.rotate(angle);
    g.scale(width / GLYPH_METRICS.width, height / GLYPH_METRICS.height);
    g.translate(-GLYPH_METRICS.centerX, -GLYPH_METRICS.centerY);
    g.font = 'bold 100px monospace';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = color;
    g.fillText('@', 0, 0);
    g.restore();
  }

  MG.drawAtGlyph = drawAtGlyph;

})(window.MG = window.MG || {});
