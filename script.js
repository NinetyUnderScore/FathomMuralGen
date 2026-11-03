// =====================================================================
//  Ninety's Mural Generator – script
//
//  Colors are stored as 3-digit hex strings ("f80" = #ff8800) because
//  that is the shortest form that fits in a Fathom paper.
//
//  A "tile" is one '@' character on the paper (8 columns x 10 rows = 80).
//  Each tile in the painter has two settings:
//      color : 3-digit hex string, or null  -> open a <font color> tag here
//      close : boolean                      -> put a </font> before this tile
// =====================================================================

// ---------------------------------------------------------------------
//  Constants & small helpers
// ---------------------------------------------------------------------
const TILE_COUNT = 80;      // tiles on one paper (8 x 10)
const CHAR_LIMIT = 400;     // max characters of rich text per paper
const byId = id => document.getElementById(id);

// Convert "f80" -> "#ff8800". Falls back to black for null/undefined.
const hex3ToCss = hex3 =>
  hex3 ? '#' + hex3.split('').map(ch => ch + ch).join('') : '#000';

// Wrap a color in the single quotes used inside the font tag: '#f80'
const quoteColor = hex3 => "'#" + hex3 + "'";

// ---------------------------------------------------------------------
//  Tab switching (called from the nav buttons' onclick attributes)
// ---------------------------------------------------------------------
function showTab(tabName, button) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  byId('tab-' + tabName).classList.add('active');
  button.classList.add('active');
}

// ---------------------------------------------------------------------
//  Drawing an '@' glyph so that it fills an exact rectangle
//  Measure how big a bold monospace '@' is at 100px, then scale/translate
//  so the glyph's ink box covers the requested width/height.
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

// Draw an '@' centered on (centerX, centerY), stretched to width x height,
// optionally rotated by `angle` radians.
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
let tiles = Array.from({ length: TILE_COUNT }, () => ({ color: null, close: false }));
let clickMode = 'color';       // what a left-click does: 'color' or 'close'
let selectedColor = 'fff';     // currently picked color (3-digit hex)
let hue = 0, sat = 0, val = 1; // picker position: hue 0-360, saturation/value 0-1
let lastBuild;                 // result of the most recent buildOutput() call

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

// Snap an 8-bit channel to the nearest value representable by one hex digit (multiples of 17)
const snapTo4Bit = x => Math.round(x / 17) * 17;
const snapRgb = (r, g, b) => [r, g, b].map(snapTo4Bit);

// Current picker position -> 3-digit hex string
function pickerToHex3() {
  return hsvToRgb(hue, sat, val).map(x => Math.round(x / 17).toString(16)).join('');
}

// ---------------------------------------------------------------------
//  Color picker UI (saturation/value square + hue strip + hex box)
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
  // Marker: white bar with a black center line
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

  // Crosshair ring (white inside, black outside)
  const cx = sat * 208, cy = (1 - val) * 160;
  svCtx.strokeStyle = '#fff'; svCtx.lineWidth = 2;
  svCtx.beginPath(); svCtx.arc(cx, cy, 6, 0, 7); svCtx.stroke();
  svCtx.strokeStyle = '#000'; svCtx.lineWidth = 1;
  svCtx.beginPath(); svCtx.arc(cx, cy, 7.5, 0, 7); svCtx.stroke();
}

// Refresh everything that depends on the picker position.
// `fromHexBox` = true when the change came from typing, so we don't overwrite the text box.
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

// Move the picker to a given 3-digit hex color
function setPickerFromHex3(hex3) {
  const [r, g, b] = hex3.split('').map(ch => parseInt(ch + ch, 16));
  [hue, sat, val] = rgbToHsv(r, g, b);
  syncPicker();
}

byId('hex').oninput = e => {
  const typed = e.target.value.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(typed)) {
    setPickerFromHex3(typed.toLowerCase());
    byId('hex').value = e.target.value; // keep exactly what the user typed
  }
};
byId('hex').onblur = () => byId('hex').value = '#' + selectedColor;

// ---------------------------------------------------------------------
//  Click-mode buttons ("Add color tag" / "Add </font> tag")
// ---------------------------------------------------------------------
function setClickMode(newMode) {
  clickMode = newMode;
  byId('mColor').classList.toggle('on', newMode == 'color');
  byId('mClose').classList.toggle('on', newMode == 'close');
}
byId('mColor').onclick = () => setClickMode('color');
byId('mClose').onclick = () => setClickMode('close');

// ---------------------------------------------------------------------
//  Build the rich-text string from a list of tiles
//
//  Simulates a stack of open <font> tags. Each stack entry is
//      { hasFace: does this tag declare face='Legacy'?, color: 3-hex or null }
//
//  Returns:
//      text       the final string (what goes into the game)
//      tileInfo   per-tile display info:
//                   effectiveColor  color shown on the tile (outermost color tag)
//                   innermostColor  color of the innermost open color tag
//                   ignored         true if a close+reopen of the same color was dropped
//                   hasLegacyFace   false if the tile lost the Legacy font
//      wastedTags number of color tags nested inside another color tag
// ---------------------------------------------------------------------
function buildOutput(tileList = tiles) {
  const rootTag = { hasFace: true, color: null };
  const stack = [rootTag];

  // Optimization: if the paper has exactly one color tag, and it is on tile 1,
  // fold it into the opening tag as a color='...' attribute.
  const mergeFirstColor =
    !!tileList[0].color &&
    !tileList[0].close &&
    tileList.filter(t => t.color).length == 1;
  if (mergeFirstColor) rootTag.color = tileList[0].color;

  let text = "<font face='Legacy'" + (mergeFirstColor ? 'color=' + quoteColor(rootTag.color) : '') + '>';
  let wastedTags = 0;
  const tileInfo = [];

  tileList.forEach((tile, index) => {
    const topOfStack = stack[stack.length - 1];

    // Closing a color and immediately reopening the same one does nothing – skip both.
    const ignored = tile.close && !!tile.color && !!topOfStack && topOfStack.color === tile.color;

    if (!ignored) {
      if (tile.close && stack.length) {
        stack.pop();
        text += '</font>';
      }
      if (tile.color && !(index == 0 && mergeFirstColor)) {
        // Re-declare the face only if no open tag still provides it
        const needsFace = !stack.some(entry => entry.hasFace);
        if (stack.some(entry => entry.color)) wastedTags++;
        stack.push({ hasFace: needsFace, color: tile.color });
        text += (needsFace ? "<font face='Legacy'color=" : '<font color=') + quoteColor(tile.color) + '>';
      }
    }

    text += '@';

    // Which color will this tile actually render in?
    const effectiveColor = (stack.find(entry => entry.color) || {}).color || null;
    const innermostColor = ([...stack].reverse().find(entry => entry.color) || {}).color || null;
    tileInfo.push({
      effectiveColor,
      innermostColor,
      ignored,
      hasLegacyFace: stack.some(entry => entry.hasFace),
    });
  });

  return { text, tileInfo, wastedTags };
}

// ---------------------------------------------------------------------
//  Painter: create the 80 tile elements
//  Left-click  : apply the current mode (toggle color tag / toggle close)
//  Right-click : toggle close
//  Middle-click: pick the color under the cursor
// ---------------------------------------------------------------------
const paperElement = byId('paper');

tiles.forEach((_, index) => {
  const tileEl = document.createElement('div');
  tileEl.className = 'tile';
  tileEl.innerHTML = '<canvas class="at" width="112" height="132"></canvas>';

  tileEl.onmousedown = e => e.preventDefault();
  tileEl.onmouseup = e => {
    const tile = tiles[index];
    if (e.button == 0) {                       // left
      if (clickMode == 'color') tile.color = (tile.color === selectedColor) ? null : selectedColor;
      else tile.close = !tile.close;
    } else if (e.button == 2) {                // right
      tile.close = !tile.close;
    } else if (e.button == 1) {                // middle: eyedropper
      const picked = tile.color || lastBuild.tileInfo[index].innermostColor;
      if (picked) setPickerFromHex3(picked);
    }
    renderPainter();
  };
  tileEl.oncontextmenu = e => e.preventDefault();

  paperElement.appendChild(tileEl);
});

// ---------------------------------------------------------------------
//  Painter: redraw tiles, output text and statistics
// ---------------------------------------------------------------------
function renderPainter() {
  lastBuild = buildOutput();
  const { text, tileInfo, wastedTags } = lastBuild;

  [...paperElement.children].forEach((tileEl, index) => {
    const tile = tiles[index];
    const info = tileInfo[index];

    tileEl.classList.toggle('nf', !info.hasLegacyFace);

    // Draw the '@' in the tile's effective color (black if none)
    const g = tileEl.firstChild.getContext('2d');
    g.clearRect(0, 0, 112, 132);
    drawAtGlyph(g, 56, 66, 110, 122, hex3ToCss(info.effectiveColor));

    // Overlay badges: color code, close marker, ignored warning
    tileEl.querySelectorAll('.code,.cl,.warn').forEach(node => node.remove());
    if (tile.color) tileEl.insertAdjacentHTML('beforeend', `<div class="code">${tile.color}</div>`);
    if (tile.close) tileEl.insertAdjacentHTML('beforeend', '<div class="cl">&lt;/&gt;</div>');
    if (info.ignored) {
      tileEl.insertAdjacentHTML('beforeend',
        '<div class="warn" title="This color tag is ignored as it does not effect the output.">⚠</div>');
    }
  });

  byId('out').value = text;

  // Statistics panel
  const CHARS_PER_COLOR_CHANGE = 26; // "</font>" (7) + "<font color='#xyz'>" (19)
  const used = text.length;
  const left = CHAR_LIMIT - used;

  byId('used').textContent = used + ' / ' + CHAR_LIMIT;
  byId('used').className = used > CHAR_LIMIT ? 'bad' : '';

  byId('left').textContent = left;
  byId('left').className = left < 0 ? 'bad' : '';

  byId('fit').textContent = Math.max(0, Math.floor(left / CHARS_PER_COLOR_CHANGE));
  byId('max').textContent =
    1 + Math.floor((CHAR_LIMIT - TILE_COUNT - "<font face='Legacy'>".length) / CHARS_PER_COLOR_CHANGE);

  byId('waste').textContent = wastedTags;
  byId('waste').className = wastedTags ? 'bad' : '';

  const tilesWithoutFont = tileInfo.filter(info => !info.hasLegacyFace).length;
  byId('nof').textContent = tilesWithoutFont;
  byId('nof').className = tilesWithoutFont ? 'bad' : '';
}

byId('reset').onclick = () => {
  tiles.forEach(tile => { tile.color = null; tile.close = false; });
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

// ---------------------------------------------------------------------
//  Importer state
// ---------------------------------------------------------------------
const VIEW_W = byId('ic').width;     // size of the crop-editor canvas
const VIEW_H = byId('ic').height;
const cropCanvas = byId('ic');
const cropCtx = cropCanvas.getContext('2d');

let cropAspect = 660 / 448;  // crop height / crop width (depends on paper count & rotation)
let sourceImage = null;      // { w, h, canvas, data } once an image is loaded
let crop = { x: 0, y: 0, w: 100, h: 100 }; // crop rectangle in source-image pixels
let viewScale = 1;           // source-image pixel -> editor canvas pixel
let viewOffsetX = 0;         // where the image's top-left sits on the editor canvas
let viewOffsetY = 0;
let dragState = null;        // active pan/resize drag, or null
let redrawHandle = 0;        // requestAnimationFrame id
let lastResults = null;      // per-paper results of the latest compute()
let paperRotation = 0;       // quarter turns clockwise (0-3)

// Snap an 8-bit channel to a multiple of 17 (one hex digit)
const quantizeChannel = v => Math.round(v / 17) * 17;
// [r,g,b] (already multiples of 17) -> "rgb" 3-digit hex string
const rgbToHex3 = rgb => rgb.map(v => (v / 17).toString(16)).join('');

// Number of papers across / down (1x1 unless "Multi-paper" is ticked). No upper limit.
const papersWide = () => byId('mp').checked ? Math.max(1, Math.floor(+byId('pw').value) || 1) : 1;
const papersTall = () => byId('mp').checked ? Math.max(1, Math.floor(+byId('ph').value) || 1) : 1;

// Map a point (u,v) in 0-1 "paper space" to the matching point in the
// un-rotated crop rectangle, according to the paper rotation.
const rotateUV = (u, v) => [[u, v], [1 - v, u], [1 - u, 1 - v], [v, 1 - u]][paperRotation];

// ---------------------------------------------------------------------
//  Loading images
// ---------------------------------------------------------------------
function loadImage(file) {
  const htmlImage = new Image();
  htmlImage.onload = () => {
    // Downscale anything bigger than 1200px to keep sampling fast
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

// Reset the crop rectangle: 'fill' (cover the paper), 'fit' (show whole image), or 'stretch'
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

  // Zoom/pan the editor view so both the image and the crop box are visible
  const boundsX = Math.min(0, crop.x);
  const boundsY = Math.min(0, crop.y);
  const boundsW = Math.max(sourceImage.w, crop.x + w) - boundsX;
  const boundsH = Math.max(sourceImage.h, crop.y + h) - boundsY;
  viewScale = Math.min(VIEW_W / boundsW, VIEW_H / boundsH) * 0.92;
  viewOffsetX = (VIEW_W - boundsW * viewScale) / 2 - boundsX * viewScale;
  viewOffsetY = (VIEW_H - boundsH * viewScale) / 2 - boundsY * viewScale;

  syncCropInputs();
}

// Copy crop values into the X/Y/W/H boxes (unless the user is typing in one) and redraw
function syncCropInputs() {
  ['x', 'y', 'w', 'h'].forEach(key => {
    const input = byId('c' + key);
    if (input !== document.activeElement) input.value = Math.round(crop[key]);
  });
  scheduleRedraw();
}

// Coalesce many changes into one redraw + recompute per animation frame
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

  // The image itself
  cropCtx.drawImage(sourceImage.canvas, viewOffsetX, viewOffsetY, sourceImage.w * viewScale, sourceImage.h * viewScale);

  // Crop rectangle in editor-canvas coordinates
  const rectX = viewOffsetX + crop.x * viewScale;
  const rectY = viewOffsetY + crop.y * viewScale;
  const rectW = crop.w * viewScale;
  const rectH = crop.h * viewScale;

  // Darken everything outside the crop rectangle
  cropCtx.fillStyle = '#000a';
  cropCtx.beginPath();
  cropCtx.rect(0, 0, VIEW_W, VIEW_H);
  cropCtx.rect(rectX, rectY, rectW, rectH);
  cropCtx.fill('evenodd');
  cropCtx.strokeStyle = '#5b9cff';
  cropCtx.lineWidth = 2;
  cropCtx.strokeRect(rectX, rectY, rectW, rectH);

  // Grid size. "paper" grid is rotated when paperRotation is odd, so swap for display.
  const wide = papersWide(), tall = papersTall();
  const gridCols = 8 * wide, gridRows = 10 * tall;
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

  // Faint tile grid (only if tiles are big enough to be useful)
  if (rectW / shownCols > 5 && rectH / shownRows > 5) drawGridLines(shownCols, shownRows, '#fff4', 1);
  // Yellow lines between papers
  if (wide * tall > 1) {
    if (isSideways) drawGridLines(tall, wide, '#ffd24a', 2.5);
    else drawGridLines(wide, tall, '#ffd24a', 2.5);
  }

  // Yellow dots showing where "Nearest pixel" sampling reads each tile
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

  // Orange "TOP" edge marker so you can see the paper's orientation
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

  // Resize handle (bottom-right corner)
  cropCtx.fillStyle = '#5b9cff';
  cropCtx.fillRect(rectX + rectW - 8, rectY + rectH - 8, 16, 16);
}

// ---------------------------------------------------------------------
//  Crop editor interaction: drag = pan, corner = resize, wheel = zoom
// ---------------------------------------------------------------------
// Mouse event -> editor-canvas coordinates
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

// Zoom the crop box around its center
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

// Drag & drop / paste / file picker
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

// Typing into the X / Y / W / H boxes
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

// Any settings change: multi-paper controls rebuild the layout, everything else just recomputes
document.querySelector('.imp').addEventListener('input', e => {
  if (['mp', 'pw', 'ph'].includes(e.target.id)) updatePaperLayout();
  else scheduleRedraw();
});

// ---------------------------------------------------------------------
//  Paper layout (multi-paper grid + rotation)
// ---------------------------------------------------------------------
byId('pL').onclick = () => { paperRotation = (paperRotation + 3) % 4; updatePaperLayout(); };
byId('pR').onclick = () => { paperRotation = (paperRotation + 1) % 4; updatePaperLayout(); };

function updatePaperLayout() {
  const wide = papersWide(), tall = papersTall();
  const previouslySelected = +byId('psel').value || 0;

  // One paper is 448 x 660 px; the crop aspect depends on the paper grid and rotation
  cropAspect = (paperRotation & 1)
    ? wide * 448 / (tall * 660)
    : tall * 660 / (wide * 448);

  byId('pw').disabled = byId('ph').disabled = !byId('mp').checked;

  // Rebuild the "paper shown in editor" dropdown
  byId('psel').innerHTML = Array.from({ length: wide * tall }, (_, k) =>
    `<option value="${k}">Row ${(k / wide | 0) + 1}, Col ${k % wide + 1}</option>`).join('');
  byId('psel').value = previouslySelected < wide * tall ? previouslySelected : 0;

  byId('cg').style.display = wide * tall > 1 ? 'grid' : 'none';

  if (sourceImage) fitCropToImage('fill');
  else scheduleRedraw();
}

// Rotate the source image itself by 90 degrees (direction: -1 = left, 1 = right)
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
//  Color adjustments (brightness / contrast / saturation sliders)
//  Takes and returns an [r,g,b] array with values 0-255.
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
//  Sample the image: one [r,g,b] color per tile, for the whole paper grid
//  Returned in row-major order across ALL papers (cols = 8 * papersWide).
// ---------------------------------------------------------------------
function sampleTileColors() {
  const gridCols = 8 * papersWide();
  const gridRows = 10 * papersTall();
  const background = [1, 3, 5].map(i => parseInt(byId('bg').value.substr(i, 2), 16));
  const method = byId('meth').value;
  const fracX = byId('sx').value / 100;
  const fracY = byId('sy').value / 100;
  const pixelData = sourceImage.data;
  const colors = [];

  // Read one source pixel, blending transparency (and out-of-bounds) with the background color
  const readPixel = (x, y) => {
    if (x < 0 || y < 0 || x >= sourceImage.w || y >= sourceImage.h) return background;
    const i = (y * sourceImage.w + x) * 4;
    const alpha = pixelData[i + 3] / 255;
    return [0, 1, 2].map(c => pixelData[i + c] * alpha + background[c] * (1 - alpha));
  };

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      // (u,v) in paper space -> pixel coordinates in the source image (respecting rotation)
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
        // Single pixel at the chosen position inside the tile
        const point = toImagePoint((col + fracX) / gridCols, (row + fracY) / gridRows);
        [sumR, sumG, sumB] = readPixel(Math.floor(point[0]), Math.floor(point[1]));
        count = 1;
      } else {
        // Average over the tile's area (at most ~16x16 samples)
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
//  Splits the 80 tiles of one paper into consecutive "runs". Each run is
//  either uncolored (black/default) or colored with one quantized color.
//  Goal: minimize total squared color error while keeping the extra
//  characters under the budget.
//
//  DP state (j, cost, type):
//      j     tiles 0..j-1 are already covered
//      cost  extra characters spent so far
//      type  1 if the last run was colored, 0 if not
//  dp[state] = lowest error that reaches that state.
//
//  Extra character costs used:
//      19  opening a colored tag:  <font color='#xyz'>
//       7  closing a colored run:  </font>
//      26  close + open (colored run directly after a colored run)
//
//  Returns { tileSettings, runs, totalError, colorTagCount } where
//  tileSettings is a list of 80 { color, close } objects for the painter.
// ---------------------------------------------------------------------
function solveColorRuns(tileColors) {
  const method = byId('meth').value;

  // Prefix sums so any run's average color / squared error is O(1)
  const prefixR = [0], prefixG = [0], prefixB = [0], prefixSquares = [0];
  tileColors.forEach(c => {
    prefixR.push(prefixR.at(-1) + c[0]);
    prefixG.push(prefixG.at(-1) + c[1]);
    prefixB.push(prefixB.at(-1) + c[2]);
    prefixSquares.push(prefixSquares.at(-1) + c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
  });

  // Character budget beyond the ~100 baseline (opening tag + 80 '@')
  const maxExtraChars = Math.max(0, Math.min(400, +byId('bud').value || 400) - 100);
  const costSlots = maxExtraChars + 1;
  const INFINITY = 1e18;
  const stateCount = 81 * costSlots * 2;

  const bestError = new Float64Array(stateCount).fill(INFINITY);
  const prevStart = new Int16Array(stateCount);  // where the run ending in this state began
  const prevCost = new Int16Array(stateCount);   // cost of the state before that run
  const prevType = new Int8Array(stateCount);    // type of the state before that run
  const stateIndex = (j, cost, type) => (j * costSlots + cost) * 2 + type;

  // Quantized color to use for a colored run covering tiles [start, end)
  const runColor = (start, end) =>
    method == 'run'
      ? [prefixR, prefixG, prefixB].map(prefix => quantizeChannel((prefix[end] - prefix[start]) / (end - start)))
      : tileColors[start].map(quantizeChannel);

  for (let end = 1; end <= TILE_COUNT; end++) {
    for (let start = 0; start < end; start++) {
      const length = end - start;
      const sumSquares = prefixSquares[end] - prefixSquares[start];
      const color = runColor(start, end);

      // Error if this run is uncolored (compared against black)
      const errorUncolored = sumSquares;
      // Error if colored: sum |c - m|^2 = sum c^2 - 2 m.sum(c) + n m^2
      const errorColored =
        sumSquares
        - 2 * (color[0] * (prefixR[end] - prefixR[start])
             + color[1] * (prefixG[end] - prefixG[start])
             + color[2] * (prefixB[end] - prefixB[start]))
        + length * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);

      // Record a transition into state (end, newCost, type) if it beats the current best
      const relax = (newCost, type, error, fromCost, fromType) => {
        if (newCost > maxExtraChars) return;
        const k = stateIndex(end, newCost, type);
        if (error < bestError[k]) {
          bestError[k] = error;
          prevStart[k] = start;
          prevCost[k] = fromCost;
          prevType[k] = fromType;
        }
      };

      if (start == 0) {
        // First run on the paper
        relax(0, 0, errorUncolored, 0, 0);
        relax(19, 1, errorColored, 0, 0);
      } else {
        // Extend every reachable earlier state with this run
        for (let cost = 0; cost <= maxExtraChars; cost++) {
          for (let lastType = 0; lastType < 2; lastType++) {
            const errorSoFar = bestError[stateIndex(start, cost, lastType)];
            if (errorSoFar >= INFINITY) continue;

            // Uncolored run: only useful right after a colored one (needs </font>)
            if (lastType == 1) relax(cost + 7, 0, errorSoFar + errorUncolored, cost, lastType);
            // Colored run: +26 if it follows a colored run (close + open), else +19
            relax(cost + (lastType ? 26 : 19), 1, errorSoFar + errorColored, cost, lastType);
          }
        }
      }
    }
  }

  // Pick the cheapest-error final state (any cost within budget)
  let bestState = -1, bestTotal = INFINITY;
  for (let cost = 0; cost <= maxExtraChars; cost++) {
    for (let type = 0; type < 2; type++) {
      const error = bestError[stateIndex(TILE_COUNT, cost, type)];
      if (error < bestTotal) {
        bestTotal = error;
        bestState = stateIndex(TILE_COUNT, cost, type);
      }
    }
  }

  // Walk backwards through the stored transitions to recover the runs: [start, end, type]
  const runs = [];
  for (let end = TILE_COUNT, k = bestState; end > 0;) {
    const start = prevStart[k];
    runs.unshift([start, end, k % 2]);
    k = stateIndex(start, prevCost[k], prevType[k]);
    end = start;
  }

  // Convert runs into per-tile painter settings
  const tileSettings = Array.from({ length: TILE_COUNT }, () => ({ color: null, close: false }));
  runs.forEach(([start, end, type], runIndex) => {
    const previousRun = runs[runIndex - 1];
    if (type == 1) {
      tileSettings[start].color = rgbToHex3(runColor(start, end));
      if (previousRun && previousRun[2] == 1) tileSettings[start].close = true;
    } else if (previousRun) {
      tileSettings[start].close = true;
    }
  });

  return {
    tileSettings,
    runs,
    totalError: bestTotal,
    colorTagCount: runs.filter(run => run[2]).length,
  };
}

// ---------------------------------------------------------------------
//  Preview mosaics ("Ideal" and "Output" canvases)
//  colorFor(paperIndex, tileIndexOnPaper) -> CSS color for that tile
// ---------------------------------------------------------------------
function drawMosaic(canvasId, wide, tall, colorFor) {
  const canvas = byId(canvasId);
  const g = canvas.getContext('2d');
  const isSideways = paperRotation & 1;

  const cellW = isSideways ? 33 : 28;
  const cellH = isSideways ? 28 : 33;
  const gridCols = 8 * wide, gridRows = 10 * tall;
  const shownCols = isSideways ? gridRows : gridCols;
  const shownRows = isSideways ? gridCols : gridRows;
  const paperCols = isSideways ? 10 : 8;   // paper size in displayed cells (for divider lines)
  const paperRows = isSideways ? 8 : 10;

  canvas.width = shownCols * cellW;
  canvas.height = shownRows * cellH;
  canvas.style.width = Math.min(shownCols * cellW / 1.4, 280) + 'px';

  g.fillStyle = '#8A8B8D';
  g.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const [u, v] = rotateUV((col + 0.5) / gridCols, (row + 0.5) / gridRows);
      const paperIndex = (row / 10 | 0) * wide + (col / 8 | 0);
      const tileIndex = (row % 10) * 8 + col % 8;
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

  // Dark divider lines between papers
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

// Copy text to the clipboard and briefly flash "Copied!" on the button
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
//  Recompute everything for the importer: sample -> solve -> build -> preview
// ---------------------------------------------------------------------
function recomputeImport() {
  if (!sourceImage) { lastResults = null; return; }

  const wide = papersWide(), tall = papersTall();
  const gridCols = 8 * wide;
  const sampled = sampleTileColors();
  const papers = [];
  let totalError = 0, totalColorTags = 0, longestOutput = 0;

  // Solve each paper independently
  for (let paperRow = 0; paperRow < tall; paperRow++) {
    for (let paperCol = 0; paperCol < wide; paperCol++) {
      // Cut this paper's 8x10 tiles out of the full grid
      const tileColors = [];
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 8; c++) {
          tileColors.push(sampled[(paperRow * 10 + r) * gridCols + paperCol * 8 + c]);
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

  // Previews
  drawMosaic('gT', wide, tall, (paper, tile) => `rgb(${papers[paper].tileColors[tile].map(Math.round)})`);
  drawMosaic('gR', wide, tall, (paper, tile) => hex3ToCss(papers[paper].built.tileInfo[tile].effectiveColor));

  // "Copy" buttons, laid out to match the (rotated) paper grid
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

  // Status line
  const rmsError = Math.sqrt(totalError / (240 * papers.length)).toFixed(1); // 240 = 80 tiles x 3 channels
  byId('ist').textContent =
    `${papers.length} paper${papers.length > 1 ? 's' : ''} · longest ${longestOutput}/400 chars · ` +
    `${totalColorTags} color tags · RMS error ${rmsError}/255`;

  if (byId('live').checked) applyResultToPainter();
}

// Write the selected paper's result into the Note Painter tab
function applyResultToPainter() {
  if (!lastResults) return;
  const paper = lastResults[Math.min(+byId('psel').value || 0, lastResults.length - 1)];
  paper.tileSettings.forEach((setting, i) => Object.assign(tiles[i], setting));
  renderPainter();
}
byId('apply').onclick = applyResultToPainter;

// ---------------------------------------------------------------------
//  Startup
// ---------------------------------------------------------------------
updatePaperLayout();
syncPicker();
renderPainter();
