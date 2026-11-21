/* =====================================================================
   Image Importer: orchestration.

   Owns the debounced recompute pipeline (sample -> solve -> build ->
   preview), the multi-paper layout, and applying a result to the Note
   Painter. The crop editor itself lives in crop.js.
   ===================================================================== */

(function (MG) {
  'use strict';

  const byId = MG.byId;
  const S = MG.settings;

  const previewBox = document.querySelector('.prevs');

  let recomputeTimer = 0;
  let recomputeGeneration = 0;
  let recomputeInFlight = false;
  let applyAfterRecompute = false;
  let lastRenderKey = null, lastRenderImage = null;
  let lastResults = null;

  const papersWide = () => byId('mp').checked ? Math.max(1, Math.floor(+byId('pw').value) || 1) : 1;
  const papersTall = () => byId('mp').checked ? Math.max(1, Math.floor(+byId('ph').value) || 1) : 1;

  // ---------------------------------------------------------------------
  //  Solver workers
  //
  //  Papers are solved independently, so multi-paper runs are spread across a
  //  small pool of Web Workers. The worker script is built from the solver
  //  function's own source, so there is no duplicated implementation. If
  //  workers are unavailable (or fail), everything falls back to the main
  //  thread and produces the same results.
  // ---------------------------------------------------------------------

  const MAX_SOLVER_WORKERS = 4;
  const canUseWorkers =
    typeof Worker === 'function' &&
    typeof Blob === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function';

  let solverPool = null;

  function spawnSolverWorker(pool) {
    const worker = new Worker(pool.url);
    worker.onmessage = e => {
      const entry = pool.pending.get(e.data.id);
      if (!entry) return;
      pool.pending.delete(e.data.id);
      pool.idle.push(worker);
      if (e.data.error) entry.reject(new Error(e.data.error));
      else entry.resolve(e.data.result);
      pumpPool(pool);
    };
    worker.onerror = e => {
      if (e && e.preventDefault) e.preventDefault();
      worker.terminate();
      pool.workers = pool.workers.filter(w => w !== worker);
      pool.idle = pool.idle.filter(w => w !== worker);
      for (const [id, entry] of pool.pending) {
        if (entry.worker === worker) {
          pool.pending.delete(id);
          entry.reject(new Error('Solver worker failed'));
        }
      }
      if (!pool.workers.length) {
        pool.queue.forEach(job => job.reject(new Error('No solver workers available')));
        pool.queue = [];
      }
      pumpPool(pool);
    };
    pool.workers.push(worker);
    pool.idle.push(worker);
  }

  function createSolverPool(size) {
    const source =
      "'use strict';\n" +
      'const solveColorRuns = ' + MG.solveColorRuns.toString() + ';\n' +
      'self.onmessage = function (e) {\n' +
      '  var d = e.data;\n' +
      '  try { self.postMessage({ id: d.id, result: solveColorRuns(d.tileColors, d.config) }); }\n' +
      '  catch (err) { self.postMessage({ id: d.id, error: String(err && err.stack || err) }); }\n' +
      '};\n';
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const pool = { url, workers: [], idle: [], queue: [], pending: new Map(), nextId: 0 };
    for (let i = 0; i < size; i++) spawnSolverWorker(pool);
    return pool;
  }

  function pumpPool(pool) {
    while (pool.idle.length && pool.queue.length) {
      const worker = pool.idle.pop();
      const job = pool.queue.shift();
      const id = pool.nextId++;
      pool.pending.set(id, { worker, resolve: job.resolve, reject: job.reject });
      worker.postMessage({ id, tileColors: job.tileColors, config: job.config });
    }
  }

  function getSolverPool(papersNeeded) {
    const cores = Math.max(1, navigator.hardwareConcurrency || 4);
    const wanted = Math.max(1, Math.min(MAX_SOLVER_WORKERS, cores, papersNeeded));

    if (!solverPool || !solverPool.workers.length) {
      if (solverPool) URL.revokeObjectURL(solverPool.url);
      solverPool = createSolverPool(wanted);
    } else {
      while (solverPool.workers.length < wanted) spawnSolverWorker(solverPool);
    }
    return solverPool;
  }

  function solveInWorkers(papersTileColors, config) {
    const pool = getSolverPool(papersTileColors.length);
    const jobs = papersTileColors.map(tileColors => new Promise((resolve, reject) => {
      pool.queue.push({ tileColors, config, resolve, reject });
    }));
    pumpPool(pool);
    return Promise.all(jobs);
  }

  function solveSynchronously(papersTileColors, config) {
    return papersTileColors.map(tileColors => MG.solveColorRuns(tileColors, config));
  }

  async function solveAllPapers(papersTileColors, config) {
    if (canUseWorkers && papersTileColors.length > 1) {
      try {
        return await solveInWorkers(papersTileColors, config);
      } catch {
        // Worker setup/runtime failure: fall back to the main thread.
      }
    }
    return solveSynchronously(papersTileColors, config);
  }

  // ---------------------------------------------------------------------
  //  Debounced redraw / recompute
  //
  //  The crop editor itself is cheap and redraws every frame. The conversion
  //  preview (sampling + solver) is expensive, so it is debounced: it only
  //  runs once the user has stopped panning / zooming / resizing.
  // ---------------------------------------------------------------------

  function markPreviewStale() {
    if (MG.cropEditor.hasImage()) previewBox.classList.add('stale');
  }

  function scheduleRecompute(delay = 0) {
    clearTimeout(recomputeTimer);
    markPreviewStale();
    recomputeTimer = setTimeout(() => {
      recomputeTimer = 0;
      recomputeImport();
    }, delay);
  }

  function scheduleRedraw(recomputeDelay = 0) {
    MG.cropEditor.redraw();
    if (recomputeDelay === null) markPreviewStale();
    else scheduleRecompute(recomputeDelay);
  }

  // ---------------------------------------------------------------------
  //  Preview mosaics
  // ---------------------------------------------------------------------

  function drawMosaic(canvasId, wide, tall, colorFor) {
    const canvas = byId(canvasId);
    const g = canvas.getContext('2d');
    const paperRotation = MG.cropEditor.getPaperRotation();
    const rotateUV = MG.cropEditor.rotateUV;
    const isSideways = paperRotation & 1;

    const ppCols = S.getColsPerPaper(), ppRows = S.getRowsPerPaper();
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

    g.fillStyle = S.strokeMode ? '#000' : '#8A8B8D';
    g.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const [u, v] = rotateUV(paperRotation, (col + 0.5) / gridCols, (row + 0.5) / gridRows);
        const paperIndex = (row / ppRows | 0) * wide + (col / ppCols | 0);
        const tileIndex = (row % ppRows) * ppCols + col % ppCols;
        MG.drawAtGlyph(
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
  //  Recompute everything for the importer
  // ---------------------------------------------------------------------

  async function recomputeImport() {
    clearTimeout(recomputeTimer);
    recomputeTimer = 0;

    // Increment before any early return: this also invalidates a slower run
    // that is still in flight when the settings change back to a cached state.
    const generation = ++recomputeGeneration;

    const sourceImage = MG.cropEditor.getSourceImage();
    if (!sourceImage) {
      recomputeInFlight = false;
      applyAfterRecompute = false;
      previewBox.classList.remove('stale');
      lastResults = null;
      lastRenderKey = null;
      return;
    }

    // Only rebuild the preview when something that affects it has changed
    const crop = MG.cropEditor.getCrop();
    const key = JSON.stringify([
      crop.x, crop.y, crop.w, crop.h, MG.cropEditor.getPaperRotation(), S.overlapMode, S.strokeMode, S.nestingLimit,
      // Checkbox .value is always "on"; the checked state must be keyed explicitly.
      byId('mp').checked,
      ['meth', 'sx', 'sy', 'bud', 'br', 'ct', 'sa', 'bg', 'pw', 'ph', 'psel'].map(id => byId(id).value),
      byId('live').checked,
    ]);
    if (lastResults && sourceImage === lastRenderImage && key === lastRenderKey) {
      recomputeInFlight = false;
      previewBox.classList.remove('stale');
      if (applyAfterRecompute) {
        applyAfterRecompute = false;
        applyResultToPainter();
      }
      return;
    }

    recomputeInFlight = true;

    const wide = papersWide(), tall = papersTall();
    const ppCols = S.getColsPerPaper(), ppRows = S.getRowsPerPaper();
    const gridCols = ppCols * wide;
    const sampled = MG.sampleTileColors();
    const solverConfig = {
      method: byId('meth').value,
      budget: +byId('bud').value || 400,
      maxOpen: S.getMaxOpen(),
      baseCharCount: S.baseCharCount(),
    };

    const papersTileColors = [];
    for (let paperRow = 0; paperRow < tall; paperRow++) {
      for (let paperCol = 0; paperCol < wide; paperCol++) {
        const tileColors = [];
        for (let r = 0; r < ppRows; r++) {
          for (let c = 0; c < ppCols; c++) {
            tileColors.push(sampled[(paperRow * ppRows + r) * gridCols + paperCol * ppCols + c]);
          }
        }
        papersTileColors.push(tileColors);
      }
    }

    const solutions = await solveAllPapers(papersTileColors, solverConfig);
    if (generation !== recomputeGeneration) return;   // a newer recompute superseded us

    const papers = [];
    let totalError = 0, totalColorTags = 0, longestOutput = 0;
    solutions.forEach((solution, index) => {
      const built = MG.buildOutput(solution.tileSettings);
      papers.push({ ...solution, built, tileColors: papersTileColors[index] });

      totalError += solution.totalError;
      totalColorTags += solution.colorTagCount;
      longestOutput = Math.max(longestOutput, built.text.length);
    });

    lastResults = papers;
    lastRenderImage = sourceImage;
    lastRenderKey = key;
    recomputeInFlight = false;
    previewBox.classList.remove('stale');

    drawMosaic('gT', wide, tall, (paper, tile) => `rgb(${papers[paper].tileColors[tile].map(Math.round)})`);
    drawMosaic('gR', wide, tall, (paper, tile) => MG.hex3ToCss(papers[paper].built.tileInfo[tile].effectiveColor));

    const selected = Math.min(+byId('psel').value || 0, papers.length - 1);
    const copyGrid = byId('cg');
    const shownWide = MG.cropEditor.getPaperRotation() & 1 ? tall : wide;
    const shownTall = MG.cropEditor.getPaperRotation() & 1 ? wide : tall;
    copyGrid.style.gridTemplateColumns = `repeat(${shownWide},1fr)`;
    copyGrid.innerHTML = '';

    if (papers.length > 1) {
      papers.forEach((paper, k) => {
        const button = document.createElement('button');
        button.textContent = `Copy ${(k / wide | 0) + 1},${k % wide + 1} (${paper.built.text.length})`;
        if (k == selected) button.className = 'on';
        button.onclick = () => MG.copyToClipboard(paper.built.text, button);

        const [u, v] = MG.cropEditor.rotateUV(
          MG.cropEditor.getPaperRotation(),
          (k % wide + 0.5) / wide,
          ((k / wide | 0) + 0.5) / tall
        );
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

    if (applyAfterRecompute || byId('live').checked) {
      applyAfterRecompute = false;
      applyResultToPainter();
    }
  }

  // ---------------------------------------------------------------------
  //  Apply result to the painter
  // ---------------------------------------------------------------------

  function applyResultToPainter() {
    if (!lastResults) return;
    // A recompute is still running: apply as soon as its new results are in,
    // so a click never applies a stale preview.
    if (recomputeInFlight) { applyAfterRecompute = true; return; }

    // Match overlap mode to the importer so the painter uses the same layout
    if (S.overlapMode !== byId('ovl').checked) {
      S.setOverlapMode(byId('ovl').checked);
    }

    const tiles = MG.paper.getTiles();
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
    MG.paper.render();
  }

  // ---------------------------------------------------------------------
  //  Paper layout
  // ---------------------------------------------------------------------

  function updatePaperLayout() {
    const wide = papersWide(), tall = papersTall();
    const previouslySelected = +byId('psel').value || 0;

    // Used area of one paper (in pixels) depends on the tile grid
    const usedW = S.getColsPerPaper() * 56;
    const usedH = S.getRowsPerPaper() * 66;

    const rotation = MG.cropEditor.getPaperRotation();
    MG.cropEditor.setCropAspect((rotation & 1)
      ? wide * usedW / (tall * usedH)
      : tall * usedH / (wide * usedW));

    byId('pw').disabled = byId('ph').disabled = !byId('mp').checked;

    byId('psel').innerHTML = Array.from({ length: wide * tall }, (_, k) =>
      `<option value="${k}">Row ${(k / wide | 0) + 1}, Col ${k % wide + 1}</option>`).join('');
    byId('psel').value = previouslySelected < wide * tall ? previouslySelected : 0;

    byId('cg').style.display = wide * tall > 1 ? 'grid' : 'none';

    if (MG.cropEditor.hasImage()) MG.cropEditor.fitCropToImage('fill');
    else scheduleRedraw();
  }

  // ---------------------------------------------------------------------
  //  Wiring
  // ---------------------------------------------------------------------

  function init() {
    byId('apply').onclick = applyResultToPainter;

    document.querySelector('.imp').addEventListener('input', e => {
      if (['cx', 'cy', 'cw', 'ch'].includes(e.target.id)) return;   // handled in crop.js, debounced
      if (['mp', 'pw', 'ph'].includes(e.target.id)) updatePaperLayout();
      else scheduleRedraw(120);   // sliders fire constantly; let them settle briefly
    });

    updatePaperLayout();
  }

  MG.importer = {
    init,
    getPapersWide: papersWide,
    getPapersTall: papersTall,
    scheduleRedraw,
    scheduleRecompute,
    updatePaperLayout,
  };

})(window.MG = window.MG || {});
