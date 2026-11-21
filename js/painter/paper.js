/* =====================================================================
   Note Painter: the tile grid, its DOM, redrawing and statistics.

   State:
     tiles[]    one { color, closes } per '@' on the current page
     lastBuild  cached result of buildOutput() for the current tiles
   ===================================================================== */

(function (MG) {
  'use strict';

  const byId = MG.byId;
  const S = MG.settings;

  let tiles = [];
  let lastBuild;

  const paperElement = byId('paper');

  // ---------------------------------------------------------------------
  //  Paper DOM
  // ---------------------------------------------------------------------

  function rebuildPaper() {
    paperElement.innerHTML = '';
    paperElement.style.gridTemplateColumns = `repeat(${S.getColsPerPaper()},minmax(0,1fr))`;
    tiles.forEach((_, index) => {
      const tileEl = document.createElement('div');
      tileEl.className = 'tile';
      tileEl.innerHTML = '<canvas class="at" width="112" height="132"></canvas>';

      tileEl.onmousedown = e => e.preventDefault();
      tileEl.onmouseup = e => {
        const tile = tiles[index];
        if (!tile) return;
        if (e.button === 0) {
          if (MG.picker.getClickMode() === 'color') {
            const selectedColor = MG.picker.getSelectedColor();
            tile.color = (tile.color === selectedColor) ? null : selectedColor;
          } else {
            tile.closes = (tile.closes || 0) > 0 ? 0 : 1;
          }
        } else if (e.button === 2) {
          // Cycle 0..9 closes
          tile.closes = ((tile.closes || 0) + 1) % 10;
        } else if (e.button === 1) {
          const picked = tile.color || (lastBuild && lastBuild.tileInfo[index].effectiveColor);
          if (picked) MG.picker.setFromHex3(picked);
        }
        renderPainter();
      };
      tileEl.oncontextmenu = e => e.preventDefault();

      paperElement.appendChild(tileEl);
    });
  }

  // Rebuild the tile array for a new page size, keeping overlapping tiles.
  function resizeToTileCount(newCount) {
    if (tiles.length === newCount) return;
    const old = tiles;
    tiles = Array.from({ length: newCount }, (_, i) =>
      old[i] ? { color: old[i].color, closes: old[i].closes || 0 }
             : { color: null, closes: 0 });
    rebuildPaper();
  }

  // ---------------------------------------------------------------------
  //  Redraw + statistics
  // ---------------------------------------------------------------------

  function renderPainter() {
    lastBuild = MG.buildOutput(tiles);
    const { text, tileInfo, wastedTags } = lastBuild;
    const maxOpen = S.getMaxOpen();

    [...paperElement.children].forEach((tileEl, index) => {
      const tile = tiles[index];
      if (!tile) return;
      const info = tileInfo[index];

      tileEl.classList.toggle('nf', !info.hasLegacyFace);
      tileEl.classList.toggle('deep', info.depth > maxOpen);

      const g = tileEl.firstChild.getContext('2d');
      g.clearRect(0, 0, 112, 132);
      MG.drawAtGlyph(g, 56, 66, 110, 122, MG.hex3ToCss(info.effectiveColor));

      tileEl.querySelectorAll('.code,.cl,.warn,.dp').forEach(node => node.remove());

      if (tile.color) {
        tileEl.insertAdjacentHTML('beforeend', `<div class="code">${tile.color}</div>`);
      }
      if (tile.closes) {
        const label = tile.closes === 1 ? '&lt;/&gt;' : `×${tile.closes}`;
        tileEl.insertAdjacentHTML('beforeend', `<div class="cl">${label}</div>`);
      }
      if (info.ignored) {
        tileEl.insertAdjacentHTML('beforeend',
          '<div class="warn" title="This close+reopen pair is dropped because the color does not change.">⚠</div>');
      }
      // Depth badge in the top-right corner
      const depthClass = info.depth > maxOpen ? 'dp over' : 'dp';
      tileEl.insertAdjacentHTML('beforeend', `<div class="${depthClass}">${info.depth}</div>`);
    });

    byId('out').value = text;

    const used = text.length;
    const left = S.CHAR_LIMIT - used;
    const currentMaxDepth = tileInfo.reduce((m, t) => Math.max(m, t.depth), 0);

    byId('used').textContent = used + ' / ' + S.CHAR_LIMIT;
    byId('used').className = used > S.CHAR_LIMIT ? 'bad' : '';

    byId('left').textContent = left;
    byId('left').className = left < 0 ? 'bad' : '';

    // How many more changes fit, assuming we can nest `headroom` more times
    const headroom = Math.max(0, maxOpen - currentMaxDepth);
    let fitCount = 0, rem = Math.max(0, left);
    const nested = Math.min(headroom, Math.floor(rem / 19));
    fitCount += nested;
    rem -= nested * 19;
    fitCount += Math.floor(rem / 26);
    byId('fit').textContent = maxOpen === 0 ? 0 : fitCount;

    // Max color changes on an empty page
    const emptyBudget = Math.max(0, S.CHAR_LIMIT - S.baseCharCount());
    const emptyNested = Math.min(maxOpen, Math.floor(emptyBudget / 19));
    const emptyMore = emptyNested < maxOpen ? 0 : Math.floor((emptyBudget - emptyNested * 19) / 26);
    byId('max').textContent = maxOpen === 0 ? 0 : emptyNested + emptyMore;

    byId('waste').textContent = wastedTags;

    byId('depth').textContent = currentMaxDepth + ' / ' + maxOpen;
    byId('depth').className = currentMaxDepth > maxOpen ? 'bad' : '';

    const tilesWithoutFont = tileInfo.filter(info => !info.hasLegacyFace).length;
    byId('nof').textContent = tilesWithoutFont;
    byId('nof').className = tilesWithoutFont ? 'bad' : '';
  }

  // ---------------------------------------------------------------------
  //  Toolbar
  // ---------------------------------------------------------------------

  function init() {
    tiles = Array.from({ length: S.getTileCount() }, () => ({ color: null, closes: 0 }));
    rebuildPaper();

    byId('reset').onclick = () => {
      tiles.forEach(tile => { tile.color = null; tile.closes = 0; });
      renderPainter();
    };

    byId('copy').onclick = async () => {
      const button = byId('copy');
      try {
        await navigator.clipboard.writeText(byId('out').value);
      } catch {
        byId('out').select();
        document.execCommand('copy');
      }
      button.textContent = 'Copied!';
      setTimeout(() => button.textContent = 'Copy raw text', 1200);
    };
  }

  MG.paper = {
    init,
    render: renderPainter,
    rebuild: rebuildPaper,
    resizeToTileCount,
    getTiles: () => tiles,
  };

})(window.MG = window.MG || {});
