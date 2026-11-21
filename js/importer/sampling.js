/* =====================================================================
   Image Importer: turn the crop into one [r,g,b] per tile across all
   papers, applying the brightness / contrast / saturation controls.
   ===================================================================== */

(function (MG) {
  'use strict';

  const byId = MG.byId;
  const S = MG.settings;

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

  function sampleTileColors() {
    const sourceImage = MG.cropEditor.getSourceImage();
    const crop = MG.cropEditor.getCrop();
    const paperRotation = MG.cropEditor.getPaperRotation();
    const rotateUV = MG.cropEditor.rotateUV;

    const ppCols = S.getColsPerPaper(), ppRows = S.getRowsPerPaper();
    const gridCols = ppCols * MG.importer.getPapersWide();
    const gridRows = ppRows * MG.importer.getPapersTall();
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

    const toImagePoint = (u, v) => {
      const [U, V] = rotateUV(paperRotation, u, v);
      return [crop.x + U * crop.w, crop.y + V * crop.h];
    };

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
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

  MG.sampleTileColors = sampleTileColors;

})(window.MG = window.MG || {});
