/// =====================================================================
//  Ninety's Mural Generator – script
//
//  Colors are stored as 3-digit hex strings ("f80" = #ff8800) because
//  that is the shortest form that fits in a Fathom paper.
//
//  A "tile" is one '@' character on the paper. Each tile has two settings:
//      color  : 3-digit hex string, or null  -> open a <font color> tag here
//      closes : integer                      -> emit this many </font> here
//
//  Color tags may be NESTED instead of closed. A tile's effective color
//  is the innermost open tag; closing the inner tag restores the outer
//  color. The nesting limit slider constrains how many tags may be open
//  at once.
//
//  Overlap mode uses a 5x6 grid per paper (with newlines after every row)
//  instead of the normal 8x10, trading more papers for more color changes
//  per paper.
// =====================================================================

// ---------------------------------------------------------------------
//  Constants & small helpers
// ---------------------------------------------------------------------
let nestingLimit = 2;      // 0-8, slider value. maxOpen = nestingLimit + 1
let overlapMode = false;   // when true, each paper is 5x6 (with newlines)
let CHAR_LIMIT = 400;

const getMaxOpen = () => nestingLimit + 1;
const getColsPerPaper = () => overlapMode ? 5 : 8;
const getRowsPerPaper = () => overlapMode ? 6 : 10;
const getTileCount = () => getColsPerPaper() * getRowsPerPaper();

const byId = id => document.getElementById(id);

// Convert "f80" -> "#ff8800". Falls back to black for null/undefined.
const hex3ToCss = hex3 =>
  hex3 ? '#' + hex3.split('').map(ch => ch + ch).join('') : '#000';

// Wrap a color in the single quotes used inside the font tag: '#f80'
const quoteColor = hex3 => "'#" + hex3 + "'";

// Base character count: opening tag + all @ plus (overlap only) newlines
function baseCharCount() {
  const n = getTileCount();
  const newlines = overlapMode ? Math.ceil(n / getColsPerPaper()) : 0;
  return "<font face='Legacy'>".length + n + newlines;
}

// ---------------------------------------------------------------------
//  Tab switching
// ---------------------------------------------------------------------
function showTab(tabName, button) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  byId('tab-' + tabName).classList.add('active');
  button.classList.add('active');
}

// ---------------------------------------------------------------------
//  Drawing an '@' glyph that fills an exact rectangle
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
//  Painter state
// ---------------------------------------------------------------------
let tiles = [];
let clickMode = 'color';
let selectedColor = 'fff';
let hue = 0, sat = 0, val = 1;
let lastBuild;

// ---------------------------------------------------------------------
//  Color math
// ---------------------------------------------------------------------
function hsvToRgb(h, s, v) {
  const channel = n => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [channel(5), channel(3), channel(1)].map(x => x * 255);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max == r)      h = ((g - b) / delta) % 6;
    else if (max == g) h = (b - r) / delta + 2;
    else               h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? delta / max : 0, max];
}

const snapTo4Bit = x => Math.round(x / 17) * 17;
const snapRgb = (r, g, b) => [r, g, b].map(snapTo4Bit);

function pickerToHex3() {
  return hsvToRgb(hue, sat, val).map(x => Math.round(x / 17).toString(16)).join('');
}

// ---------------------------------------------------------------------
//  Color picker UI
// ---------------------------------------------------------------------
const svCanvas = byId('sv');
const svCtx = svCanvas.getContext('2d');
const hueCanvas = byId('hue');
const hueCtx = hueCanvas.getContext('2d');

function drawHueStrip() {
  for (let x = 0; x < 208; x++) {
    const [r, g, b] = snapRgb(...hsvToRgb(x / 208 * 360, 1, 1));
    hueCtx.fillStyle = `rgb(${r},${g},${b})`;
    hueCtx.fillRect(x, 0, 1, 16);
  }
  const markerX = hue / 360 * 208;
  hueCtx.fillStyle = '#fff';
  hueCtx.fillRect(markerX - 2, 0, 4, 16);
  hueCtx.fillStyle = '#000';
  hueCtx.fillRect(markerX - 1, 0, 2, 16);
}

function drawSatValSquare() {
  const image = svCtx.createImageData(208, 160);
  const pixels = image.data;
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 208; x++) {
      const [r, g, b] = snapRgb(...hsvToRgb(hue, x / 208, 1 - y / 160));
      const i = (y * 208 + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
  svCtx.putImageData(image, 0, 0);
  const cx = sat * 208, cy = (1 - val) * 160;
  svCtx.strokeStyle = '#fff'; svCtx.lineWidth = 2;
  svCtx.beginPath(); svCtx.arc(cx, cy, 6, 0, 7); svCtx.stroke();
  svCtx.strokeStyle = '#000'; svCtx.lineWidth = 1;
  svCtx.beginPath(); svCtx.arc(cx, cy, 7.5, 0, 7); svCtx.stroke();
}

function syncPicker(fromHexBox) {
  selectedColor = pickerToHex3();
  byId('sw').style.background = '#' + selectedColor;
  if (!fromHexBox) byId('hex').value = '#' + selectedColor;
  drawSatValSquare();
  drawHueStrip();
}

function onHueDrag(e) {
  const rect = hueCanvas.getBoundingClientRect();
  hue = Math.min(359.99, Math.max(0, (e.clientX - rect.left) / rect.width * 360));
  syncPicker();
}
hueCanvas.onpointerdown = e => {
  hueCanvas.setPointerCapture(e.pointerId);
  onHueDrag(e);
  hueCanvas.onpointermove = onHueDrag;
};
hueCanvas.onpointerup = () => hueCanvas.onpointermove = null;

function onSatValDrag(e) {
  const rect = svCanvas.getBoundingClientRect();
  sat = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  val = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  syncPicker();
}
svCanvas.onpointerdown = e => {
  svCanvas.setPointerCapture(e.pointerId);
  onSatValDrag(e);
  svCanvas.onpointermove = onSatValDrag;
};
svCanvas.onpointerup = () => svCanvas.onpointermove = null;

function setPickerFromHex3(hex3) {
  const [r, g, b] = hex3.split('').map(ch => parseInt(ch + ch, 16));
  [hue, sat, val] = rgbToHsv(r, g, b);
  syncPicker();
}

byId('hex').oninput = e => {
  const typed = e.target.value.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(typed)) {
    setPickerFromHex3(typed.toLowerCase());
    byId('hex').value = e.target.value;
  }
};
byId('hex').onblur = () => byId('hex').value = '#' + selectedColor;

// ---------------------------------------------------------------------
//  Click-mode buttons
// ---------------------------------------------------------------------
function setClickMode(newMode) {
  clickMode = newMode;
  byId('mColor').classList.toggle('on', newMode == 'color');
  byId('mClose').classList.toggle('on', newMode == 'close');
}
byId('mColor').onclick = () => setClickMode('color');
byId('mClose').onclick = () => setClickMode('close');

// ---------------------------------------------------------------------
//  Nesting slider (painter) — syncs with the importer's slider
// ---------------------------------------------------------------------
function setNestingLimit(n) {
  nestingLimit = Math.max(0, Math.min(8, n | 0));
  byId('nest').value = nestingLimit;
  byId('nest2').value = nestingLimit;
  byId('nestVal').textContent = nestingLimit;
  byId('nestTags').textContent = getMaxOpen();
  renderPainter();
  if (sourceImage) recomputeImport();
}
byId('nest').oninput = e => setNestingLimit(+e.target.value);
byId('nest2').oninput = e => setNestingLimit(+e.target.value);

// ---------------------------------------------------------------------
//  Overlap mode
// ---------------------------------------------------------------------
function setOverlapMode(on) {
  if (overlapMode === on) return;
  overlapMode = on;
  const newCount = getTileCount();
  const oldCount = tiles.length;
  if (oldCount !== newCount) {
    const old = tiles;
    tiles = Array.from({ length: newCount }, (_, i) =>
      old[i] ? { color: old[i].color, closes: old[i].closes || 0 }
             : { color: null, closes: 0 });
    rebuildPaper();
  }
  if (byId('ovl').checked !== on) byId('ovl').checked = on;
  updatePaperLayout();
  renderPainter();
}
byId('ovl').onchange = e => setOverlapMode(e.target.checked);

// ---------------------------------------------------------------------
//  Build the rich-text string from a list of tiles
//
//  Simulates a stack of open <font> tags. Each stack entry is
//  { hasFace, color }. Root entry has face but no color.
//
//  Returns:
//    text       final string
//    tileInfo   per-tile display info:
//                 effectiveColor (innermost open color)
//                 ignored        (close+reopen same color dropped)
//                 hasLegacyFace  (face still active)
//                 depth          (number of open color tags at this tile)
//    wastedTags number of color tags nested inside another color tag
// ---------------------------------------------------------------------
function buildOutput(tileList = tiles) {
  const rootTag = { hasFace: true, color: null };
  const stack = [rootTag];

  const mergeFirstColor =
    tileList.length > 0 &&
    !!tileList[0].color &&
    (tileList[0].closes || 0) === 0 &&
    tileList.filter(t => t.color).length === 1;
  if (mergeFirstColor) rootTag.color = tileList[0].color;

  let text = "<font face='Legacy'" + (mergeFirstColor ? 'color=' + quoteColor(rootTag.color) : '') + '><stroke th=5>';
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
        text += (needsFace ? "<font face='Legacy'color=" : '<font color=') + quoteColor(tile.color) + '>';
      }
    }

    text += '@';
    if (overlapMode && (index + 1) % getColsPerPaper() === 0) text += '\n';

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

// ---------------------------------------------------------------------
//  Painter tile DOM
// ---------------------------------------------------------------------
const paperElement = byId('paper');

function rebuildPaper() {
  paperElement.innerHTML = '';
  paperElement.style.gridTemplateColumns = `repeat(${getColsPerPaper()},minmax(0,1fr))`;
  tiles.forEach((_, index) => {
    const tileEl = document.createElement('div');
    tileEl.className = 'tile';
    tileEl.innerHTML = '<canvas class="at" width="112" height="132"></canvas>';

    tileEl.onmousedown = e => e.preventDefault();
    tileEl.onmouseup = e => {
      const tile = tiles[index];
      if (!tile) return;
      if (e.button === 0) {
        if (clickMode === 'color') {
          tile.color = (tile.color === selectedColor) ? null : selectedColor;
        } else {
          tile.closes = (tile.closes || 0) > 0 ? 0 : 1;
        }
      } else if (e.button === 2) {
        // Cycle 0..9 closes
        tile.closes = ((tile.closes || 0) + 1) % 10;
      } else if (e.button === 1) {
        const picked = tile.color || (lastBuild && lastBuild.tileInfo[index].effectiveColor);
        if (picked) setPickerFromHex3(picked);
      }
      renderPainter();
    };
    tileEl.oncontextmenu = e => e.preventDefault();

    paperElement.appendChild(tileEl);
  });
}

// ---------------------------------------------------------------------
//  Painter redraw + stats
// ---------------------------------------------------------------------
function renderPainter() {
  lastBuild = buildOutput();
  const { text, tileInfo, wastedTags } = lastBuild;
  const maxOpen = getMaxOpen();

  [...paperElement.children].forEach((tileEl, index) => {
    const tile = tiles[index];
    if (!tile) return;
    const info = tileInfo[index];

    tileEl.classList.toggle('nf', !info.hasLegacyFace);
    tileEl.classList.toggle('deep', info.depth > maxOpen);

    const g = tileEl.firstChild.getContext('2d');
    g.clearRect(0, 0, 112, 132);
    drawAtGlyph(g, 56, 66, 110, 122, hex3ToCss(info.effectiveColor));

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
  const left = CHAR_LIMIT - used;
  const currentMaxDepth = tileInfo.reduce((m, t) => Math.max(m, t.depth), 0);

  byId('used').textContent = used + ' / ' + CHAR_LIMIT;
  byId('used').className = used > CHAR_LIMIT ? 'bad' : '';

  byId('left').textContent = left;
  byId('left').className = left < 0 ? 'bad' : '';

  // How many more changes fit, assuming we can nest `headroom` more times
  const headroom = Math.max(0, maxOpen - currentMaxDepth);
  let fitCount = 0, rem = Math.max(0, left);
  const nested = Math.min(headroom, Math.floor(rem / 19));
  fitCount += nested;
  rem -= nested * 19;
  fitCount += Math.floor(rem / 26);
  byId('fit').textContent = fitCount;

  // Max color changes on an empty page
  const emptyBudget = Math.max(0, CHAR_LIMIT - baseCharCount());
  const emptyNested = Math.min(maxOpen, Math.floor(emptyBudget / 19));
  const emptyMore = emptyNested < maxOpen ? 0 : Math.floor((emptyBudget - emptyNested * 19) / 26);
  byId('max').textContent = emptyNested + emptyMore;

  byId('waste').textContent = wastedTags;
  byId('waste').className = wastedTags ? '' : '';

  byId('depth').textContent = currentMaxDepth + ' / ' + maxOpen;
  byId('depth').className = currentMaxDepth > maxOpen ? 'bad' : '';

  const tilesWithoutFont = tileInfo.filter(info => !info.hasLegacyFace).length;
  byId('nof').textContent = tilesWithoutFont;
  byId('nof').className = tilesWithoutFont ? 'bad' : '';
}

// ---------------------------------------------------------------------
//  Painter toolbar
// ---------------------------------------------------------------------
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

// =====================================================================
//  IMAGE IMPORTER
// =====================================================================

const VIEW_W = byId('ic').width;
const VIEW_H = byId('ic').height;
const cropCanvas = byId('ic');
const cropCtx = cropCanvas.getContext('2d');

let cropAspect = 660 / 448;
let sourceImage = null;
let crop = { x: 0, y: 0, w: 100, h: 100 };
let viewScale = 1;
let viewOffsetX = 0;
let viewOffsetY = 0;
let dragState = null;
let redrawHandle = 0;
let lastResults = null;
let paperRotation = 0;

const quantizeChannel = v => Math.round(v / 17) * 17;
const rgbToHex3 = rgb => rgb.map(v => (v / 17).toString(16)).join('');

const papersWide = () => byId('mp').checked ? Math.max(1, Math.floor(+byId('pw').value) || 1) : 1;
const papersTall = () => byId('mp').checked ? Math.max(1, Math.floor(+byId('ph').value) || 1) : 1;

// Map (u,v) in paper space to the un-rotated crop rectangle
const rotateUV = (u, v) => [[u, v], [1 - v, u], [1 - u, 1 - v], [v, 1 - u]][paperRotation];

// ---------------------------------------------------------------------
//  Image loading
// ---------------------------------------------------------------------
function loadImage(file) {
  const htmlImage = new Image();
  htmlImage.onload = () => {
    const downscale = Math.min(1, 1200 / Math.max(htmlImage.width, htmlImage.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(htmlImage.width * downscale);
    canvas.height = Math.round(htmlImage.height * downscale);
    const g = canvas.getContext('2d');
    g.drawImage(htmlImage, 0, 0, canvas.width, canvas.height);
    sourceImage = {
      w: canvas.width,
      h: canvas.height,
      canvas,
      data: g.getImageData(0, 0, canvas.width, canvas.height).data,
    };
    fitCropToImage('fill');
  };
  htmlImage.src = URL.createObjectURL(file);
}

function fitCropToImage(fitMode) {
  if (!sourceImage) return;
  let w, h;

  if (fitMode == 'stretch') {
    w = sourceImage.w;
    h = sourceImage.h;
    byId('lock').checked = false;
  } else {
    byId('lock').checked = true;
    const widthLimit = sourceImage.w;
    const heightLimit = sourceImage.h / cropAspect;
    w = fitMode == 'fill' ? Math.min(widthLimit, heightLimit) : Math.max(widthLimit, heightLimit);
    h = w * cropAspect;
  }
  crop = { x: (sourceImage.w - w) / 2, y: (sourceImage.h - h) / 2, w, h };

  const boundsX = Math.min(0, crop.x);
  const boundsY = Math.min(0, crop.y);
  const boundsW = Math.max(sourceImage.w, crop.x + w) - boundsX;
  const boundsH = Math.max(sourceImage.h, crop.y + h) - boundsY;
  viewScale = Math.min(VIEW_W / boundsW, VIEW_H / boundsH) * 0.92;
  viewOffsetX = (VIEW_W - boundsW * viewScale) / 2 - boundsX * viewScale;
  viewOffsetY = (VIEW_H - boundsH * viewScale) / 2 - boundsY * viewScale;

  syncCropInputs();
}

function syncCropInputs() {
  ['x', 'y', 'w', 'h'].forEach(key => {
    const input = byId('c' + key);
    if (input !== document.activeElement) input.value = Math.round(crop[key]);
  });
  scheduleRedraw();
}

function scheduleRedraw() {
  cancelAnimationFrame(redrawHandle);
  redrawHandle = requestAnimationFrame(() => {
    drawCropEditor();
    recomputeImport();
  });
}

// ---------------------------------------------------------------------
//  Crop editor canvas
// ---------------------------------------------------------------------
function drawCropEditor() {
  cropCtx.clearRect(0, 0, VIEW_W, VIEW_H);

  if (!sourceImage) {
    cropCtx.fillStyle = '#9a9aa2';
    cropCtx.font = '14px system-ui';
    cropCtx.textAlign = 'center';
    cropCtx.fillText('Choose, drop or paste an image', VIEW_W / 2, VIEW_H / 2);
    return;
  }

  cropCtx.drawImage(sourceImage.canvas, viewOffsetX, viewOffsetY, sourceImage.w * viewScale, sourceImage.h * viewScale);

  const rectX = viewOffsetX + crop.x * viewScale;
  const rectY = viewOffsetY + crop.y * viewScale;
  const rectW = crop.w * viewScale;
  const rectH = crop.h * viewScale;

  cropCtx.fillStyle = '#000a';
  cropCtx.beginPath();
  cropCtx.rect(0, 0, VIEW_W, VIEW_H);
  cropCtx.rect(rectX, rectY, rectW, rectH);
  cropCtx.fill('evenodd');
  cropCtx.strokeStyle = '#5b9cff';
  cropCtx.lineWidth = 2;
  cropCtx.strokeRect(rectX, rectY, rectW, rectH);

  const wide = papersWide(), tall = papersTall();
  const ppCols = getColsPerPaper(), ppRows = getRowsPerPaper();
  const gridCols = ppCols * wide, gridRows = ppRows * tall;
  const isSideways = paperRotation & 1;
  const shownCols = isSideways ? gridRows : gridCols;
  const shownRows = isSideways ? gridCols : gridRows;

  const drawGridLines = (countX, countY, color, lineWidth) => {
    cropCtx.lineWidth = lineWidth;
    cropCtx.strokeStyle = color;
    cropCtx.beginPath();
    for (let i = 1; i < countX; i++) {
      cropCtx.moveTo(rectX + rectW * i / countX, rectY);
      cropCtx.lineTo(rectX + rectW * i / countX, rectY + rectH);
    }
    for (let j = 1; j < countY; j++) {
      cropCtx.moveTo(rectX, rectY + rectH * j / countY);
      cropCtx.lineTo(rectX + rectW, rectY + rectH * j / countY);
    }
    cropCtx.stroke();
  };

  if (rectW / shownCols > 5 && rectH / shownRows > 5) drawGridLines(shownCols, shownRows, '#fff4', 1);
  if (wide * tall > 1) {
    if (isSideways) drawGridLines(tall, wide, '#ffd24a', 2.5);
    else drawGridLines(wide, tall, '#ffd24a', 2.5);
  }

  if (byId('meth').value == 'near' && Math.min(rectW / shownCols, rectH / shownRows) > 8) {
    cropCtx.fillStyle = '#ff0';
    const fracX = byId('sx').value / 100;
    const fracY = byId('sy').value / 100;
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const [u, v] = rotateUV((col + fracX) / gridCols, (row + fracY) / gridRows);
        cropCtx.fillRect(rectX + u * rectW - 1.5, rectY + v * rectH - 1.5, 3, 3);
      }
    }
  }

  {
    const edges = [
      [rectX, rectY, rectX + rectW, rectY],
      [rectX + rectW, rectY, rectX + rectW, rectY + rectH],
      [rectX, rectY + rectH, rectX + rectW, rectY + rectH],
      [rectX, rectY, rectX, rectY + rectH],
    ];
    const labelOffsets = [[0, 10], [-16, 0], [0, -10], [16, 0]];
    const edge = edges[paperRotation];
    const offset = labelOffsets[paperRotation];

    cropCtx.strokeStyle = '#ff8a2a';
    cropCtx.lineWidth = 4;
    cropCtx.beginPath();
    cropCtx.moveTo(edge[0], edge[1]);
    cropCtx.lineTo(edge[2], edge[3]);
    cropCtx.stroke();

    cropCtx.fillStyle = '#ff8a2a';
    cropCtx.font = 'bold 10px system-ui';
    cropCtx.textAlign = 'center';
    cropCtx.textBaseline = 'middle';
    cropCtx.fillText('TOP', (edge[0] + edge[2]) / 2 + offset[0], (edge[1] + edge[3]) / 2 + offset[1]);
  }

  cropCtx.fillStyle = '#5b9cff';
  cropCtx.fillRect(rectX + rectW - 8, rectY + rectH - 8, 16, 16);
}

// ---------------------------------------------------------------------
//  Crop editor interaction
// ---------------------------------------------------------------------
const canvasPoint = e => {
  const rect = cropCanvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * VIEW_W / rect.width, (e.clientY - rect.top) * VIEW_H / rect.height];
};

cropCanvas.onpointerdown = e => {
  if (!sourceImage) return;
  cropCanvas.setPointerCapture(e.pointerId);
  const point = canvasPoint(e);
  const handleX = viewOffsetX + (crop.x + crop.w) * viewScale;
  const handleY = viewOffsetY + (crop.y + crop.h) * viewScale;
  const onHandle = Math.abs(point[0] - handleX) < 14 && Math.abs(point[1] - handleY) < 14;
  dragState = { mode: onHandle ? 'resize' : 'pan', startPoint: point, startCrop: { ...crop } };
};

cropCanvas.onpointermove = e => {
  if (!dragState) return;
  const point = canvasPoint(e);
  const dx = (point[0] - dragState.startPoint[0]) / viewScale;
  const dy = (point[1] - dragState.startPoint[1]) / viewScale;

  if (dragState.mode == 'pan') {
    crop.x = dragState.startCrop.x + dx;
    crop.y = dragState.startCrop.y + dy;
  } else {
    crop.w = Math.max(8, dragState.startCrop.w + dx);
    crop.h = byId('lock').checked ? crop.w * cropAspect : Math.max(8, dragState.startCrop.h + dy);
  }
  syncCropInputs();
};

cropCanvas.onpointerup = () => dragState = null;

cropCanvas.onwheel = e => {
  if (!sourceImage) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 0.92 : 1.087;
  const centerX = crop.x + crop.w / 2;
  const centerY = crop.y + crop.h / 2;
  crop.w *= factor;
  crop.h = byId('lock').checked ? crop.w * cropAspect : crop.h * factor;
  crop.x = centerX - crop.w / 2;
  crop.y = centerY - crop.h / 2;
  syncCropInputs();
};

cropCanvas.ondragover = e => e.preventDefault();
cropCanvas.ondrop = e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) loadImage(file);
};
document.onpaste = e => {
  const file = [...e.clipboardData.files].find(f => f.type.startsWith('image'));
  if (file) loadImage(file);
};
byId('file').onchange = e => e.target.files[0] && loadImage(e.target.files[0]);

byId('bFill').onclick = () => fitCropToImage('fill');
byId('bFit').onclick = () => fitCropToImage('fit');
byId('bStr').onclick = () => fitCropToImage('stretch');

['x', 'y', 'w', 'h'].forEach(key => {
  byId('c' + key).oninput = e => {
    const value = +e.target.value;
    if (!sourceImage || !isFinite(value)) return;
    if ((key == 'w' || key == 'h') && value <= 0) return;

    crop[key] = value;
    if (byId('lock').checked) {
      if (key == 'w') crop.h = value * cropAspect;
      if (key == 'h') crop.w = value / cropAspect;
    }
    syncCropInputs();
  };
});

document.querySelector('.imp').addEventListener('input', e => {
  if (['mp', 'pw', 'ph'].includes(e.target.id)) updatePaperLayout();
  else scheduleRedraw();
});

// ---------------------------------------------------------------------
//  Paper layout
// ---------------------------------------------------------------------
byId('pL').onclick = () => { paperRotation = (paperRotation + 3) % 4; updatePaperLayout(); };
byId('pR').onclick = () => { paperRotation = (paperRotation + 1) % 4; updatePaperLayout(); };

function updatePaperLayout() {
  const wide = papersWide(), tall = papersTall();
  const previouslySelected = +byId('psel').value || 0;

  // Used area of one paper (in pixels) depends on the tile grid
  const usedW = getColsPerPaper() * 56;
  const usedH = getRowsPerPaper() * 66;

  cropAspect = (paperRotation & 1)
    ? wide * usedW / (tall * usedH)
    : tall * usedH / (wide * usedW);

  byId('pw').disabled = byId('ph').disabled = !byId('mp').checked;

  byId('psel').innerHTML = Array.from({ length: wide * tall }, (_, k) =>
    `<option value="${k}">Row ${(k / wide | 0) + 1}, Col ${k % wide + 1}</option>`).join('');
  byId('psel').value = previouslySelected < wide * tall ? previouslySelected : 0;

  byId('cg').style.display = wide * tall > 1 ? 'grid' : 'none';

  if (sourceImage) fitCropToImage('fill');
  else scheduleRedraw();
}

function rotateImage(direction) {
  if (!sourceImage) return;
  const canvas = document.createElement('canvas');
  canvas.width = sourceImage.h;
  canvas.height = sourceImage.w;
  const g = canvas.getContext('2d');
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate(direction * Math.PI / 2);
  g.drawImage(sourceImage.canvas, -sourceImage.w / 2, -sourceImage.h / 2);
  sourceImage = {
    w: canvas.width,
    h: canvas.height,
    canvas,
    data: g.getImageData(0, 0, canvas.width, canvas.height).data,
  };
  fitCropToImage('fill');
}
byId('rL').onclick = () => rotateImage(-1);
byId('rR').onclick = () => rotateImage(1);

// ---------------------------------------------------------------------
//  Color adjustments
// ---------------------------------------------------------------------
function applyColorAdjustments(rgb) {
  const brightness = byId('br').value * 2.55;
  const contrast = (+byId('ct').value + 100) / 100;
  const saturation = byId('sa').value / 100;
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

  return rgb.map(channel => {
    const saturated = luma + (channel - luma) * saturation;
    const contrasted = (saturated - 128) * contrast + 128 + brightness;
    return Math.max(0, Math.min(255, contrasted));
  });
}

// ---------------------------------------------------------------------
//  Sample the image: one [r,g,b] per tile across ALL papers
// ---------------------------------------------------------------------
function sampleTileColors() {
  const ppCols = getColsPerPaper(), ppRows = getRowsPerPaper();
  const gridCols = ppCols * papersWide();
  const gridRows = ppRows * papersTall();
  const background = [1, 3, 5].map(i => parseInt(byId('bg').value.substr(i, 2), 16));
  const method = byId('meth').value;
  const fracX = byId('sx').value / 100;
  const fracY = byId('sy').value / 100;
  const pixelData = sourceImage.data;
  const colors = [];

  const readPixel = (x, y) => {
    if (x < 0 || y < 0 || x >= sourceImage.w || y >= sourceImage.h) return background;
    const i = (y * sourceImage.w + x) * 4;
    const alpha = pixelData[i + 3] / 255;
    return [0, 1, 2].map(c => pixelData[i + c] * alpha + background[c] * (1 - alpha));
  };

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const toImagePoint = (u, v) => {
        const [U, V] = rotateUV(u, v);
        return [crop.x + U * crop.w, crop.y + V * crop.h];
      };
      const cornerA = toImagePoint(col / gridCols, row / gridRows);
      const cornerB = toImagePoint((col + 1) / gridCols, (row + 1) / gridRows);
      const left = Math.min(cornerA[0], cornerB[0]);
      const top = Math.min(cornerA[1], cornerB[1]);
      const tileW = Math.abs(cornerB[0] - cornerA[0]);
      const tileH = Math.abs(cornerB[1] - cornerA[1]);

      let sumR = 0, sumG = 0, sumB = 0, count = 0;

      if (method == 'near') {
        const point = toImagePoint((col + fracX) / gridCols, (row + fracY) / gridRows);
        [sumR, sumG, sumB] = readPixel(Math.floor(point[0]), Math.floor(point[1]));
        count = 1;
      } else {
        const xStart = Math.floor(left);
        const xEnd = Math.max(xStart + 1, Math.ceil(left + tileW));
        const yStart = Math.floor(top);
        const yEnd = Math.max(yStart + 1, Math.ceil(top + tileH));
        const stepX = Math.max(1, Math.floor((xEnd - xStart) / 16));
        const stepY = Math.max(1, Math.floor((yEnd - yStart) / 16));
        for (let y = yStart; y < yEnd; y += stepY) {
          for (let x = xStart; x < xEnd; x += stepX) {
            const pixel = readPixel(x, y);
            sumR += pixel[0]; sumG += pixel[1]; sumB += pixel[2];
            count++;
          }
        }
      }
      colors.push(applyColorAdjustments([sumR / count, sumG / count, sumB / count]));
    }
  }
  return colors;
}

// ---------------------------------------------------------------------
//  Optimal color-run solver (dynamic programming)
//
//  Splits the N tiles of one paper into consecutive runs. Each run is
//  either uncolored (black) or colored with one quantized color. Goal:
//  minimize squared color error while staying inside the character
//  budget and the nesting limit.
//
//  DP state: (j, cost, type, depth)
//      j     tiles 0..j-1 already covered
//      cost  extra characters spent so far
//      type  1 if the last run was colored, 0 if not
//      depth number of open color tags at position j
//
//  dp[state] = lowest error reaching that state.
//
//  Transition costs:
//    colored run, depth < maxOpen   -> 19 (nest, depth + 1)
//    colored run, depth == maxOpen  -> 26 (close one + open, depth stays)
//    uncolored run, from colored    -> 7 * depth (close all, depth = 0)
// ---------------------------------------------------------------------
function solveColorRuns(tileColors) {
  const method = byId('meth').value;
  const n = tileColors.length;
  const maxOpen = getMaxOpen();

  const prefixR = [0], prefixG = [0], prefixB = [0], prefixSquares = [0];
  tileColors.forEach(c => {
    prefixR.push(prefixR.at(-1) + c[0]);
    prefixG.push(prefixG.at(-1) + c[1]);
    prefixB.push(prefixB.at(-1) + c[2]);
    prefixSquares.push(prefixSquares.at(-1) + c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
  });

  const maxExtraChars = Math.max(0, (+byId('bud').value || 400) - baseCharCount());
  const costSlots = maxExtraChars + 1;
  const depthSlots = maxOpen + 1;
  const INFINITY = 1e18;
  const stateCount = (n + 1) * costSlots * 2 * depthSlots;

  const bestError = new Float64Array(stateCount).fill(INFINITY);
  const prevStart = new Int16Array(stateCount);
  const prevCost = new Int16Array(stateCount);
  const prevType = new Int8Array(stateCount);
  const prevDepth = new Int8Array(stateCount);

  const stateIndex = (j, cost, type, depth) =>
    ((j * costSlots + cost) * 2 + type) * depthSlots + depth;

  const runColor = (start, end) =>
    method == 'run'
      ? [prefixR, prefixG, prefixB].map(p => quantizeChannel((p[end] - p[start]) / (end - start)))
      : tileColors[start].map(quantizeChannel);

  for (let end = 1; end <= n; end++) {
    for (let start = 0; start < end; start++) {
      const length = end - start;
      const sumSquares = prefixSquares[end] - prefixSquares[start];
      const color = runColor(start, end);

      const errorUncolored = sumSquares;
      const errorColored =
        sumSquares
        - 2 * (color[0] * (prefixR[end] - prefixR[start])
             + color[1] * (prefixG[end] - prefixG[start])
             + color[2] * (prefixB[end] - prefixB[start]))
        + length * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);

      const relax = (newCost, type, depth, error, fromCost, fromType, fromDepth) => {
        if (newCost > maxExtraChars) return;
        if (depth > maxOpen) return;
        const k = stateIndex(end, newCost, type, depth);
        if (error < bestError[k]) {
          bestError[k] = error;
          prevStart[k] = start;
          prevCost[k] = fromCost;
          prevType[k] = fromType;
          prevDepth[k] = fromDepth;
        }
      };

      if (start === 0) {
        // First run: either uncolored (cost 0) or colored (cost 19, depth 1)
        relax(0, 0, 0, errorUncolored, 0, 0, 0);
        relax(19, 1, 1, errorColored, 0, 0, 0);
      } else {
        for (let cost = 0; cost <= maxExtraChars; cost++) {
          for (let lastType = 0; lastType < 2; lastType++) {
            for (let lastDepth = 0; lastDepth <= maxOpen; lastDepth++) {
              const errorSoFar = bestError[stateIndex(start, cost, lastType, lastDepth)];
              if (errorSoFar >= INFINITY) continue;

              // Uncolored run: close all open color tags
              if (lastType === 1) {
                relax(cost + 7 * lastDepth, 0, 0, errorSoFar + errorUncolored, cost, lastType, lastDepth);
              }

              // Colored run: nest if room, otherwise close one and open
              let openCost, newDepth;
              if (lastDepth < maxOpen) {
                openCost = 19;
                newDepth = lastDepth + 1;
              } else {
                openCost = 26;
                newDepth = maxOpen;
              }
              relax(cost + openCost, 1, newDepth, errorSoFar + errorColored, cost, lastType, lastDepth);
            }
          }
        }
      }
    }
  }

  // Pick the best final state (any cost, any type, any depth)
  let bestState = -1, bestTotal = INFINITY;
  for (let cost = 0; cost <= maxExtraChars; cost++) {
    for (let type = 0; type < 2; type++) {
      for (let depth = 0; depth <= maxOpen; depth++) {
        const error = bestError[stateIndex(n, cost, type, depth)];
        if (error < bestTotal) {
          bestTotal = error;
          bestState = stateIndex(n, cost, type, depth);
        }
      }
    }
  }

  // Reconstruct the runs: [start, end, type, depthAfter]
  const runs = [];
  for (let end = n, k = bestState; end > 0;) {
    const start = prevStart[k];
    const type = Math.floor(k / depthSlots) % 2;
    const depthAfter = k % depthSlots;
    runs.unshift([start, end, type, depthAfter]);
    k = stateIndex(start, prevCost[k], prevType[k], prevDepth[k]);
    end = start;
  }

  // Convert runs into tile settings
  const tileSettings = Array.from({ length: n }, () => ({ color: null, closes: 0 }));
  runs.forEach(([start, end, type, depthAfter], idx) => {
    const prevRun = runs[idx - 1];
    const prevType = prevRun ? prevRun[2] : 0;
    const prevDepth = prevRun ? prevRun[3] : 0;

    if (type === 1) {
      tileSettings[start].color = rgbToHex3(runColor(start, end));
      // Close before opening only when we were already at the limit
      if (prevType === 1 && depthAfter === prevDepth) {
        tileSettings[start].closes = 1;
      }
    } else {
      // Uncolored: close everything the previous run had open
      if (prevType === 1) {
        tileSettings[start].closes = prevDepth;
      }
    }
  });

  return {
    tileSettings,
    runs,
    totalError: bestTotal,
    colorTagCount: runs.filter(run => run[2] === 1).length,
  };
}

// ---------------------------------------------------------------------
//  Preview mosaics
// ---------------------------------------------------------------------
function drawMosaic(canvasId, wide, tall, colorFor) {
  const canvas = byId(canvasId);
  const g = canvas.getContext('2d');
  const isSideways = paperRotation & 1;

  const ppCols = getColsPerPaper(), ppRows = getRowsPerPaper();
  const cellW = isSideways ? 33 : 28;
  const cellH = isSideways ? 28 : 33;
  const gridCols = ppCols * wide, gridRows = ppRows * tall;
  const shownCols = isSideways ? gridRows : gridCols;
  const shownRows = isSideways ? gridCols : gridRows;
  const paperCols = isSideways ? ppRows : ppCols;
  const paperRows = isSideways ? ppCols : ppRows;

  canvas.width = shownCols * cellW;
  canvas.height = shownRows * cellH;
  canvas.style.width = Math.min(shownCols * cellW / 1.4, 280) + 'px';

  g.fillStyle = '#8A8B8D';
  g.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const [u, v] = rotateUV((col + 0.5) / gridCols, (row + 0.5) / gridRows);
      const paperIndex = (row / ppRows | 0) * wide + (col / ppCols | 0);
      const tileIndex = (row % ppRows) * ppCols + col % ppCols;
      drawAtGlyph(
        g,
        (Math.floor(u * shownCols) + 0.5) * cellW,
        (Math.floor(v * shownRows) + 0.5) * cellH,
        27, 30,
        colorFor(paperIndex, tileIndex),
        paperRotation * Math.PI / 2
      );
    }
  }

  if (wide * tall > 1) {
    g.strokeStyle = '#555';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 1; i < shownCols / paperCols; i++) {
      g.moveTo(i * paperCols * cellW, 0);
      g.lineTo(i * paperCols * cellW, canvas.height);
    }
    for (let j = 1; j < shownRows / paperRows; j++) {
      g.moveTo(0, j * paperRows * cellH);
      g.lineTo(canvas.width, j * paperRows * cellH);
    }
    g.stroke();
  }
}

// ---------------------------------------------------------------------
//  Clipboard helper
// ---------------------------------------------------------------------
async function copyToClipboard(text, button) {
  const originalLabel = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
  }
  button.textContent = 'Copied!';
  setTimeout(() => button.textContent = originalLabel, 1000);
}

// ---------------------------------------------------------------------
//  Recompute everything for the importer
// ---------------------------------------------------------------------
function recomputeImport() {
  if (!sourceImage) { lastResults = null; return; }

  const wide = papersWide(), tall = papersTall();
  const ppCols = getColsPerPaper(), ppRows = getRowsPerPaper();
  const gridCols = ppCols * wide;
  const sampled = sampleTileColors();
  const papers = [];
  let totalError = 0, totalColorTags = 0, longestOutput = 0;

  for (let paperRow = 0; paperRow < tall; paperRow++) {
    for (let paperCol = 0; paperCol < wide; paperCol++) {
      const tileColors = [];
      for (let r = 0; r < ppRows; r++) {
        for (let c = 0; c < ppCols; c++) {
          tileColors.push(sampled[(paperRow * ppRows + r) * gridCols + paperCol * ppCols + c]);
        }
      }
      const solution = solveColorRuns(tileColors);
      const built = buildOutput(solution.tileSettings);
      papers.push({ ...solution, built, tileColors });

      totalError += solution.totalError;
      totalColorTags += solution.colorTagCount;
      longestOutput = Math.max(longestOutput, built.text.length);
    }
  }
  lastResults = papers;

  drawMosaic('gT', wide, tall, (paper, tile) => `rgb(${papers[paper].tileColors[tile].map(Math.round)})`);
  drawMosaic('gR', wide, tall, (paper, tile) => hex3ToCss(papers[paper].built.tileInfo[tile].effectiveColor));

  const selected = Math.min(+byId('psel').value || 0, papers.length - 1);
  const copyGrid = byId('cg');
  const shownWide = paperRotation & 1 ? tall : wide;
  const shownTall = paperRotation & 1 ? wide : tall;
  copyGrid.style.gridTemplateColumns = `repeat(${shownWide},1fr)`;
  copyGrid.innerHTML = '';

  if (papers.length > 1) {
    papers.forEach((paper, k) => {
      const button = document.createElement('button');
      button.textContent = `Copy ${(k / wide | 0) + 1},${k % wide + 1} (${paper.built.text.length})`;
      if (k == selected) button.className = 'on';
      button.onclick = () => copyToClipboard(paper.built.text, button);

      const [u, v] = rotateUV((k % wide + 0.5) / wide, ((k / wide | 0) + 0.5) / tall);
      button.style.gridColumn = Math.floor(u * shownWide) + 1;
      button.style.gridRow = Math.floor(v * shownTall) + 1;
      copyGrid.appendChild(button);
    });
  }

  const totalTiles = ppCols * ppRows * papers.length;
  const rmsError = Math.sqrt(totalError / (totalTiles * 3)).toFixed(1);
  byId('ist').textContent =
    `${papers.length} paper${papers.length > 1 ? 's' : ''} · longest ${longestOutput}/400 chars · ` +
    `${totalColorTags} color tags · RMS error ${rmsError}/255`;

  if (byId('live').checked) applyResultToPainter();
}

// ---------------------------------------------------------------------
//  Apply result to the painter
// ---------------------------------------------------------------------
function applyResultToPainter() {
  if (!lastResults) return;

  // Match overlap mode to the importer so the painter uses the same layout
  if (overlapMode !== byId('ovl').checked) {
    setOverlapMode(byId('ovl').checked);
  }

  const paper = lastResults[Math.min(+byId('psel').value || 0, lastResults.length - 1)];
  const n = Math.min(tiles.length, paper.tileSettings.length);
  for (let i = 0; i < n; i++) {
    tiles[i].color = paper.tileSettings[i].color;
    tiles[i].closes = paper.tileSettings[i].closes;
  }
  // Clear any tiles the source didn't cover
  for (let i = n; i < tiles.length; i++) {
    tiles[i].color = null;
    tiles[i].closes = 0;
  }
  renderPainter();
}
byId('apply').onclick = applyResultToPainter;

// ---------------------------------------------------------------------
//  Startup
// ---------------------------------------------------------------------
function init() {
  // Build the painter's tile array and DOM using current mode
  tiles = Array.from({ length: getTileCount() }, () => ({ color: null, closes: 0 }));
  rebuildPaper();

  // Sync sliders and picker
  byId('nest').value = nestingLimit;
  byId('nest2').value = nestingLimit;
  byId('nestVal').textContent = nestingLimit;
  byId('nestTags').textContent = getMaxOpen();
  byId('ovl').checked = overlapMode;

  syncPicker();
  updatePaperLayout();
  renderPainter();
}
init();