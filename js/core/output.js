/* =====================================================================
   Build the rich-text string from a list of tiles.

   A "tile" is one '@' character on the paper. Each tile has two settings:
       color  : 3-digit hex string, or null  -> open a <font color> tag here
       closes : integer                      -> emit this many </font> here

   Color tags may be NESTED instead of closed. A tile's effective color is
   the innermost open tag; closing the inner tag restores the outer color.

   Simulates a stack of open <font> tags. Each stack entry is
   { hasFace, color }. Root entry has face but no color.

   Returns:
     text       final string
     tileInfo   per-tile display info:
                  effectiveColor (innermost open color)
                  ignored        (close+reopen same color dropped)
                  hasLegacyFace  (face still active)
                  depth          (number of open color tags at this tile)
     wastedTags number of color tags nested inside another color tag
   ===================================================================== */

(function (MG) {
  'use strict';

  const S = MG.settings;

  function buildOutput(tileList) {
    const rootTag = { hasFace: true, color: null };
    const stack = [rootTag];

    // Only merge the single color into the opening tag when nothing ever
    // closes a tag. The root tag cannot be popped, so merging a tag that the
    // tile list intends to close would silently paint the "black" tiles in
    // that color instead.
    const mergeFirstColor =
      tileList.length > 0 &&
      !!tileList[0].color &&
      (tileList[0].closes || 0) === 0 &&
      tileList.every(t => !(t.closes > 0)) &&
      tileList.filter(t => t.color).length === 1;
    if (mergeFirstColor) rootTag.color = tileList[0].color;

    let text = "<font face='Legacy'" + (mergeFirstColor ? 'color=' + MG.quoteColor(rootTag.color) : '') + '>' + (S.strokeMode ? MG.STROKE_TAG : '');
    let wastedTags = 0;
    const tileInfo = [];

    tileList.forEach((tile, index) => {
      const topOfStack = stack[stack.length - 1];
      const closes = tile.closes || 0;

      // Close + reopen of the exact same color on a single tile does nothing.
      const ignored = closes === 1 && !!tile.color && !!topOfStack && topOfStack.color === tile.color;

      if (!ignored) {
        for (let c = 0; c < closes && stack.length > 1; c++) {
          stack.pop();
          text += '</font>';
        }
        if (tile.color && !(index === 0 && mergeFirstColor)) {
          const needsFace = !stack.some(entry => entry.hasFace);
          if (stack.some(entry => entry.color)) wastedTags++;
          stack.push({ hasFace: needsFace, color: tile.color });
          text += (needsFace ? "<font face='Legacy'color=" : '<font color=') + MG.quoteColor(tile.color) + '>';
        }
      }

      text += '@';
      if (S.overlapMode && (index + 1) % S.getColsPerPaper() === 0) text += '\n';

      // Effective color is the innermost open color tag.
      const openColors = stack.filter(entry => entry.color);
      const depth = openColors.length;
      const effectiveColor = depth > 0 ? openColors[depth - 1].color : null;
      tileInfo.push({
        effectiveColor,
        ignored,
        hasLegacyFace: stack.some(entry => entry.hasFace),
        depth,
      });
    });

    return { text, tileInfo, wastedTags };
  }

  MG.buildOutput = buildOutput;

})(window.MG = window.MG || {});
