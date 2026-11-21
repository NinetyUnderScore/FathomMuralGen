/* =====================================================================
   Image Importer: image loading and the interactive crop editor.

   The crop rectangle lives in source-image pixels and is mapped onto the
   paper grid (optionally rotated). Everything here only concerns selecting
   and adjusting the region; sampling and solving live in their own files.
   ===================================================================== */

(function (MG) {
  'use strict';

  const byId = MG.byId;
  const S = MG.settings;

  // Crop editor canvas
  const cropCanvas = byId('ic');
  const cropCtx = cropCanvas.getContext('2d');
  const VIEW_W = cropCanvas.width;
  const VIEW_H = cropCanvas.height;

  let cropAspect = 660 / 448;
  let sourceImage = null;
  let crop = { x: 0, y: 0, w: 100, h: 100 };
  let viewScale = 1;
  let viewOffsetX = 0;
  let viewOffsetY = 0;
  let dragState = null;
  let redrawHandle = 0;
  let paperRotation = 0;
  let wheelActive = false, wheelTimer = 0;

  // Map (u,v) in paper space to the un-rotated crop rectangle
  const rotateUV = (rotation, u, v) => [[u, v], [1 - v, u], [1 - u, 1 - v], [v, 1 - u]][rotation];

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

  // recomputeDelay: ms to wait before the (expensive) preview is rebuilt,
  // or null to leave the preview alone for now (used while dragging).
  function syncCropInputs(recomputeDelay = 0) {
    ['x', 'y', 'w', 'h'].forEach(key => {
      const input = byId('c' + key);
      if (input !== document.activeElement) input.value = Math.round(crop[key]);
    });
    MG.importer.scheduleRedraw(recomputeDelay);
  }

  function redrawEditor() {
    cancelAnimationFrame(redrawHandle);
    redrawHandle = requestAnimationFrame(drawCropEditor);
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

    const wide = MG.importer.getPapersWide(), tall = MG.importer.getPapersTall();
    const ppCols = S.getColsPerPaper(), ppRows = S.getRowsPerPaper();
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

    // While panning / zooming / resizing only the cheap overlays are drawn; the
    // per-tile grid and sample dots (thousands of shapes with many papers)
    // come back as soon as the interaction ends.
    const interacting = !!dragState || wheelActive;

    if (!interacting && rectW / shownCols > 5 && rectH / shownRows > 5) drawGridLines(shownCols, shownRows, '#fff4', 1);
    if (wide * tall > 1) {
      if (isSideways) drawGridLines(tall, wide, '#ffd24a', 2.5);
      else drawGridLines(wide, tall, '#ffd24a', 2.5);
    }

    if (!interacting && byId('meth').value == 'near' && Math.min(rectW / shownCols, rectH / shownRows) > 8) {
      cropCtx.fillStyle = '#ff0';
      const fracX = byId('sx').value / 100;
      const fracY = byId('sy').value / 100;
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const [u, v] = rotateUV(paperRotation, (col + fracX) / gridCols, (row + fracY) / gridRows);
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

  function endDrag() {
    if (!dragState) return;
    dragState = null;
    redrawEditor();          // bring back the full overlays
    MG.importer.scheduleRecompute(0);
  }

  // ---------------------------------------------------------------------
  //  Image rotation
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  //  Wiring
  // ---------------------------------------------------------------------

  function init() {
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
      syncCropInputs(null);   // keep the editor live, hold the preview until release
    };

    cropCanvas.onpointerup = endDrag;
    cropCanvas.onpointercancel = endDrag;

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
      wheelActive = true;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheelActive = false; redrawEditor(); }, 250);
      syncCropInputs(250);    // wait for the wheel to stop turning
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
        syncCropInputs(250);
      };
    });

    byId('pL').onclick = () => { paperRotation = (paperRotation + 3) % 4; MG.importer.updatePaperLayout(); };
    byId('pR').onclick = () => { paperRotation = (paperRotation + 1) % 4; MG.importer.updatePaperLayout(); };

    byId('rL').onclick = () => rotateImage(-1);
    byId('rR').onclick = () => rotateImage(1);
  }

  MG.cropEditor = {
    init,
    rotateUV,
    hasImage: () => !!sourceImage,
    getSourceImage: () => sourceImage,
    getCrop: () => crop,
    getCropAspect: () => cropAspect,
    setCropAspect: aspect => { cropAspect = aspect; },
    getPaperRotation: () => paperRotation,
    fitCropToImage,
    redraw: redrawEditor,
  };

})(window.MG = window.MG || {});
