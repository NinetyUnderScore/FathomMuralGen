/* =====================================================================
   Optimal color-run solver (dynamic programming).

   Splits the N tiles of one paper into consecutive runs. Each run is either
   uncolored (black) or colored with one quantized color. Goal: minimize
   squared color error while staying inside the character budget and the
   nesting limit.

   NESTED "ISLANDS"
   A colored run may contain small islands of another color that are opened
   inside it and closed again, so the outer color resumes without being
   re-declared:

       <font color='#fff'>@<font color='#000'>@</font>@

   That costs 19 (outer) + 19 + 7 (island) = 45 chars, versus 71 for three
   separate tags (and 57 if all three are simply nested). Every (start, end)
   run therefore has several "variants": the plain run, plus the best 1, 2
   or 3 islands that can be carved out of it. Each variant has its own error
   and extra character cost, and the DP below picks whichever mix is best.

   DP state: (j, cost, type, depth)
       j     tiles 0..j-1 already covered
       cost  extra characters spent so far
       type  1 if the last run was colored, 0 if not
       depth number of open color tags at position j
             (islands are always closed again, so they do not change it)

   dp[state] = lowest error reaching that state.

   Transition costs:
     colored run, depth < maxOpen   -> 19 (nest, depth + 1)
     colored run, depth == maxOpen  -> 26 (close one + open, depth stays)
     each island inside a run       -> 26 (open nested + close), needs
                                       one spare level of nesting
     uncolored run, from colored    -> 7 * depth (close all, depth = 0)
   ===================================================================== */

(function (MG) {
  'use strict';

  // Everything the solver needs is passed in, so this function is
  // self-contained. That lets its source be shipped verbatim to a Web Worker
  // for multi-paper runs (see importer.js).
  //
  // config: {
  //   method        "near" | "tile" | "run"
  //   budget        character budget for one paper
  //   maxOpen       number of color tags that may stay open
  //   baseCharCount characters used by the page scaffolding
  // }
  function solveColorRuns(tileColors, config) {
    const runMode = config.method == 'run';
    const n = tileColors.length;
    const maxOpen = config.maxOpen;
    const W = n + 1;                 // row stride for (start, end) tables
    const MAX_ISLANDS = 3;           // islands carved out of a single run
    const ISLAND_COST = 19 + 7;      // <font color='#xyz'> + </font>

    const maxExtraChars = Math.max(0, config.budget - config.baseCharCount);
    // An island variant costs 26 characters, so searching for more islands
    // than the remaining budget could ever pay for is wasted work.
    const maxIslands = Math.min(MAX_ISLANDS, Math.floor(maxExtraChars / ISLAND_COST));

    // Local copies keep the function free of external references so its
    // source can run inside a worker.
    const quantizeChannel = v => Math.round(v / 17) * 17;
    const rgbToHex3 = rgb => rgb.map(v => (v / 17).toString(16)).join('');

    const prefixR = [0], prefixG = [0], prefixB = [0], prefixSquares = [0];
    tileColors.forEach(c => {
      prefixR.push(prefixR.at(-1) + c[0]);
      prefixG.push(prefixG.at(-1) + c[1]);
      prefixB.push(prefixB.at(-1) + c[2]);
      prefixSquares.push(prefixSquares.at(-1) + c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
    });

    // Squared error of painting tiles a..b-1 with color c
    const errAgainst = (c, a, b) =>
      (prefixSquares[b] - prefixSquares[a])
      - 2 * (c[0] * (prefixR[b] - prefixR[a])
           + c[1] * (prefixG[b] - prefixG[a])
           + c[2] * (prefixB[b] - prefixB[a]))
      + (b - a) * (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);

    const runColor = (start, end) =>
      runMode
        ? [prefixR, prefixG, prefixB].map(p => quantizeChannel((p[end] - p[start]) / (end - start)))
        : tileColors[start].map(quantizeChannel);

    // Color and error of every plain (start, end) run
    const plainColor = new Array(W * W);
    const plainErr = new Float64Array(W * W);
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b <= n; b++) {
        const color = runColor(a, b);
        plainColor[a * W + b] = color;
        plainErr[a * W + b] = errAgainst(color, a, b);
      }
    }

    // Scratch buffers for the island search
    const gain = new Float64Array(W * W);
    const bestGain = new Float64Array((MAX_ISLANDS + 1) * W);
    const chosenFrom = new Int16Array((MAX_ISLANDS + 1) * W);

    // For the run [s, e) painted with color cA, find the best sets of 1..MAX
    // non-overlapping islands. An island [x, y) must start after tile s (a tile
    // can only open one tag) and end before tile e (the outer color has to
    // resume on at least one tile, where the island's </font> is placed).
    // Returns an array indexed by island count, or null if nothing fits.
    function pickIslands(s, e, cA) {
      const lo = s + 1, hi = e - 1, L = hi - lo;
      if (L < 1) return null;

      // gain[i * W + j] holds the improvement of using an island covering
      // offsets [j, i). Scanning end-first writes gain contiguously, and the
      // order matches the generic DP so that ties resolve identically.
      // errAgainst() is inlined here because this is the hottest loop.
      const cA0 = cA[0], cA1 = cA[1], cA2 = cA[2];
      const cASquared = cA0 * cA0 + cA1 * cA1 + cA2 * cA2;

      // Row 1 of the DP is simply "best single island so far". Filling it in
      // the same pass as the gains saves a full O(L^2) DP pass.
      for (let i = 0; i <= L; i++) bestGain[i] = 0;   // zero-gain base row
      bestGain[W] = 0;
      let bestSoFar = 0;
      for (let i = 1; i <= L; i++) {
        const b = lo + i;
        // End-side prefix values are constant for this row.
        const sqB = prefixSquares[b], rB = prefixR[b], gB = prefixG[b], blB = prefixB[b];
        let bestEnd = 0, bestEndFrom = -1;
        let a = lo;
        let plainIndex = a * W + b;
        let gainIndex = i * W;
        let spanSquared = i * cASquared;

        for (let j = 0; j < i; j++, a++, plainIndex += W, gainIndex++, spanSquared -= cASquared) {
          const outerError =
            (sqB - prefixSquares[a])
            - 2 * (cA0 * (rB - prefixR[a])
                 + cA1 * (gB - prefixG[a])
                 + cA2 * (blB - prefixB[a]))
            + spanSquared;
          const g = outerError - plainErr[plainIndex];
          gain[gainIndex] = g;
          if (g > bestEnd) { bestEnd = g; bestEndFrom = j; }
        }

        // Only record an island here if it beats what was already reachable.
        const from = bestEnd > bestSoFar ? bestEndFrom : -1;
        if (bestEnd > bestSoFar) bestSoFar = bestEnd;
        bestGain[W + i] = bestSoFar;
        chosenFrom[W + i] = from;
      }

      // Rows 2..maxIslands use the standard DP.
      for (let k = 2; k <= maxIslands; k++) {
        const currentBase = k * W;
        const previousBase = (k - 1) * W;
        bestGain[currentBase] = 0;
        let skippedGain = 0;
        for (let i = 1; i <= L; i++) {
          let bestValue = skippedGain, from = -1;
          const gainRow = i * W;
          for (let j = 0; j < i; j++) {
            const g = gain[gainRow + j];
            if (g <= 0) continue;
            const value = bestGain[previousBase + j] + g;
            if (value > bestValue) { bestValue = value; from = j; }
          }
          bestGain[currentBase + i] = bestValue;
          chosenFrom[currentBase + i] = from;
          skippedGain = bestValue;
        }
      }

      const result = [];
      for (let k = 1; k <= maxIslands; k++) {
        const list = [];
        for (let kk = k, i = L; kk > 0 && i > 0;) {
          const from = chosenFrom[kk * W + i];
          if (from < 0) { i--; }
          else { list.unshift([lo + from, lo + i]); i = from; kk--; }
        }
        result[k] = list;
      }
      return result;
    }

    // Every way of painting [s, e): variants[0] is the plain run, later ones
    // add islands. Each variant: { err, color, islands: [[x, y, color]], extra }
    const variantTable = new Array(W * W);

    function buildVariants(s, e) {
      const variants = [{ err: plainErr[s * W + e], color: plainColor[s * W + e], islands: [], extra: 0 }];
      // Islands need a spare nesting level and a run long enough to carve one
      // out, and the budget must be able to pay for at least one.
      if (maxOpen < 2 || maxIslands < 1 || e - s < 3) return variants;

      const picks = pickIslands(s, e, plainColor[s * W + e]);
      if (!picks) return variants;

      for (let k = 1; k <= maxIslands; k++) {
        const islands = picks[k];
        if (!islands.length || islands.length <= variants.at(-1).islands.length) continue;

        // Tiles owned by the outer tag = the run minus its islands
        let r = prefixR[e] - prefixR[s], g = prefixG[e] - prefixG[s], b = prefixB[e] - prefixB[s];
        let sq = prefixSquares[e] - prefixSquares[s];
        let count = e - s, islandError = 0;
        islands.forEach(([x, y]) => {
          r -= prefixR[y] - prefixR[x];
          g -= prefixG[y] - prefixG[x];
          b -= prefixB[y] - prefixB[x];
          sq -= prefixSquares[y] - prefixSquares[x];
          count -= y - x;
          islandError += plainErr[x * W + y];
        });
        // With "average" sampling the outer color is re-averaged over the tiles it still owns
        const color = runMode ? [r, g, b].map(v => quantizeChannel(v / count)) : plainColor[s * W + e];
        const ownedError = sq - 2 * (color[0] * r + color[1] * g + color[2] * b)
                         + count * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);
        const err = ownedError + islandError;
        if (err >= variants.at(-1).err) continue;

        variants.push({
          err,
          color,
          islands: islands.map(([x, y]) => [x, y, plainColor[x * W + y]]),
          extra: ISLAND_COST * islands.length,
        });
      }
      return variants;
    }

    const costSlots = maxExtraChars + 1;
    const depthSlots = maxOpen + 1;
    const INFINITY = 1e18;
    const stateCount = (n + 1) * costSlots * 2 * depthSlots;

    const bestError = new Float64Array(stateCount).fill(INFINITY);
    const prevStart = new Int16Array(stateCount);
    const prevCost = new Int16Array(stateCount);
    const prevType = new Int8Array(stateCount);
    const prevDepth = new Int8Array(stateCount);
    const prevVariant = new Int8Array(stateCount);

    const stateIndex = (j, cost, type, depth) =>
      ((j * costSlots + cost) * 2 + type) * depthSlots + depth;

    // Only a small fraction of the (cost, type, depth) states are ever
    // reached, so track the reachable ones per position and transition from
    // just those. They are sorted into (cost, type, depth) order, which keeps
    // the relaxation order — and therefore tie-breaking — identical to an
    // exhaustive scan of the state space.
    const ordinal = (cost, type, depth) => (cost * 2 + type) * depthSlots + depth;
    const ordinalCost = ord => Math.floor(ord / (2 * depthSlots));
    const ordinalType = ord => Math.floor(ord / depthSlots) % 2;
    const ordinalDepth = ord => ord % depthSlots;
    const reachable = Array.from({ length: n + 1 }, () => []);
    const reachableSorted = new Uint8Array(n + 1);

    const relax = (end, start, newCost, type, depth, error, fromCost, fromType, fromDepth, variant) => {
      if (newCost > maxExtraChars) return;
      if (depth > maxOpen) return;
      const k = stateIndex(end, newCost, type, depth);
      if (error < bestError[k]) {
        if (bestError[k] === INFINITY) reachable[end].push(ordinal(newCost, type, depth));
        bestError[k] = error;
        prevStart[k] = start;
        prevCost[k] = fromCost;
        prevType[k] = fromType;
        prevDepth[k] = fromDepth;
        prevVariant[k] = variant;
      }
    };

    for (let end = 1; end <= n; end++) {
      for (let start = 0; start < end; start++) {
        const errorUncolored = prefixSquares[end] - prefixSquares[start];
        const variants = buildVariants(start, end);
        variantTable[start * W + end] = variants;

        if (start === 0) {
          // First run: either uncolored (cost 0) or colored (cost 19, depth 1)
          relax(end, start, 0, 0, 0, errorUncolored, 0, 0, 0, 0);
          for (let vi = 0; vi < variants.length; vi++) {
            const v = variants[vi];
            relax(end, start, 19 + v.extra, 1, 1, v.err, 0, 0, 0, vi);
          }
        } else {
          const states = reachable[start];
          if (!states.length) continue;
          if (!reachableSorted[start]) {
            states.sort((a, b) => a - b);
            reachableSorted[start] = 1;
          }
          for (let si = 0; si < states.length; si++) {
            const ord = states[si];
            const cost = ordinalCost(ord);
            const lastType = ordinalType(ord);
            const lastDepth = ordinalDepth(ord);
            const errorSoFar = bestError[stateIndex(start, cost, lastType, lastDepth)];

            // Uncolored run: close all open color tags
            if (lastType === 1) {
              relax(end, start, cost + 7 * lastDepth, 0, 0, errorSoFar + errorUncolored,
                    cost, lastType, lastDepth, 0);
            }

            // Colored run: nest if room, otherwise close one and open.
            // (With stroke on and nesting limit 0 no color tag fits at all.)
            if (maxOpen === 0) continue;
            let openCost, newDepth;
            if (lastDepth < maxOpen) {
              openCost = 19;
              newDepth = lastDepth + 1;
            } else {
              openCost = 26;
              newDepth = maxOpen;
            }
            for (let vi = 0; vi < variants.length; vi++) {
              // Islands sit one level deeper than the run's own tag
              if (vi > 0 && newDepth >= maxOpen) break;
              relax(end, start, cost + openCost + variants[vi].extra, 1, newDepth,
                    errorSoFar + variants[vi].err, cost, lastType, lastDepth, vi);
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

    // Reconstruct the runs: [start, end, type, depthAfter, variantIndex]
    const runs = [];
    for (let end = n, k = bestState; end > 0;) {
      const start = prevStart[k];
      const type = Math.floor(k / depthSlots) % 2;
      const depthAfter = k % depthSlots;
      runs.unshift([start, end, type, depthAfter, prevVariant[k]]);
      k = stateIndex(start, prevCost[k], prevType[k], prevDepth[k]);
      end = start;
    }

    // Convert runs into tile settings
    const tileSettings = Array.from({ length: n }, () => ({ color: null, closes: 0 }));
    let islandCount = 0;
    runs.forEach(([start, end, type, depthAfter, variantIndex], idx) => {
      const prevRun = runs[idx - 1];
      const prevType = prevRun ? prevRun[2] : 0;
      const prevDepth = prevRun ? prevRun[3] : 0;

      if (type === 1) {
        const variant = variantTable[start * W + end][variantIndex];
        tileSettings[start].color = rgbToHex3(variant.color);
        // Close before opening only when we were already at the limit
        if (prevType === 1 && depthAfter === prevDepth) {
          tileSettings[start].closes = 1;
        }
        // Islands: open the inner tag on its first tile, close it on the
        // tile where the outer color resumes (which may open the next island)
        variant.islands.forEach(([x, y, islandColor]) => {
          tileSettings[x].color = rgbToHex3(islandColor);
          tileSettings[y].closes = 1;
          islandCount++;
        });
      } else {
        // Uncolored: close everything the previous run had open
        if (prevType === 1) {
          tileSettings[start].closes = prevDepth;
        }
      }
    });

    // An uncolored run is encoded by closing the open tags on its first tile,
    // which paints that run black. The same tags can be positioned so that the
    // run inherits a neighbouring color instead, at identical character cost:
    //
    //   - previous color: move the closes to the tile after the run
    //   - next color:     move the next run's opening tag onto the run's first
    //                     tile (after the closes)
    //
    // A trailing run can also drop its closes entirely, because tags at the end
    // of the page are never closed. Pick whichever of black / previous / next
    // is closest to the run's sampled tiles, so genuine black areas stay black
    // while isolated black specks in colored areas disappear.
    const errorOfRun = (start, end, color) => {
      let error = 0;
      for (let i = start; i < end; i++) {
        const c = tileColors[i];
        error += (c[0] - color[0]) ** 2 + (c[1] - color[1]) ** 2 + (c[2] - color[2]) ** 2;
      }
      return error;
    };

    let totalError = bestTotal;
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const [start, end, type] = runs[runIndex];
      if (type !== 0) continue;

      const blackError = errorOfRun(start, end, [0, 0, 0]);
      let bestError = blackError;
      let action = 'black';
      let previousDepth = 0;

      const previous = runIndex > 0 ? runs[runIndex - 1] : null;
      if (previous && previous[2] === 1 && tileSettings[start].closes === previous[3]) {
        previousDepth = previous[3];
        const color = variantTable[previous[0] * W + previous[1]][previous[4]].color;
        const error = errorOfRun(start, end, color);
        if (error < bestError) { bestError = error; action = 'previous'; }
      }

      const next = runIndex + 1 < runs.length ? runs[runIndex + 1] : null;
      if (next && next[2] === 1 && end < n && !tileSettings[end].closes) {
        const color = variantTable[next[0] * W + next[1]][next[4]].color;
        const error = errorOfRun(start, end, color);
        if (error < bestError) { bestError = error; action = 'next'; }
      }

      if (action === 'previous') {
        tileSettings[start].closes = 0;
        if (end < n) tileSettings[end].closes = (tileSettings[end].closes || 0) + previousDepth;
      } else if (action === 'next') {
        tileSettings[start].color = tileSettings[end].color;
        tileSettings[end].color = null;
      }
      totalError += bestError - blackError;
    }

    return {
      tileSettings,
      runs,
      totalError,
      colorTagCount: runs.filter(run => run[2] === 1).length + islandCount,
    };
  }

  MG.solveColorRuns = solveColorRuns;

})(window.MG = window.MG || {});
