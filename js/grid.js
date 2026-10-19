// Finner rutenettet i et bilde av et strikkediagram: retter opp skjevhet,
// finner radlinjer og masker, og foreslår en ramme rundt diagrammet.
import { loadImage, drawRotated } from './media.js';

/** Mørke piksler med adaptiv terskel (tåler skygger og ujevnt lys). */
function darkMask(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(6, Math.round(Math.min(w, h) / 40));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      mask[y * w + x] = g[y * w + x] < mean * 0.82 ? 1 : 0;
    }
  }
  return { mask, w, h };
}

/** Andel mørke piksler per rad (axis 'y') eller kolonne (axis 'x') innenfor et område. */
function projection({ mask, w }, axis, a0, a1, b0, b1) {
  // a = posisjonene vi projiserer på, b = området vi summerer over
  const out = new Float32Array(a1 - a0);
  for (let a = a0; a < a1; a++) {
    let n = 0;
    if (axis === 'y') for (let b = b0; b < b1; b++) n += mask[a * w + b];
    else for (let b = b0; b < b1; b++) n += mask[b * w + a];
    out[a - a0] = n / Math.max(1, b1 - b0);
  }
  // glatting [1 2 1]
  const sm = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) sm[i] = (2 * out[i] + (out[i - 1] ?? out[i]) + (out[i + 1] ?? out[i])) / 4;
  return sm;
}

function findPeaks(score, offset) {
  let max = 0;
  for (const v of score) max = Math.max(max, v);
  const thr = max * 0.35;
  const raw = [];
  for (let i = 0; i < score.length; i++) {
    const v = score[i];
    if (v >= thr && v >= (score[i - 1] ?? 0) && v >= (score[i + 1] ?? 0)) raw.push({ p: i + offset, s: v });
  }
  const peaks = [];
  for (const pk of raw) {
    const last = peaks[peaks.length - 1];
    if (last && pk.p - last.p <= 4) { if (pk.s > last.s) peaks[peaks.length - 1] = pk; } else peaks.push(pk);
  }
  return peaks;
}

/** Lengste rekke med (nesten) jevnt fordelte linjer. Tillater én manglende linje om gangen. */
function bestChain(peaks) {
  let best = null;
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < Math.min(peaks.length, i + 4); j++) {
      let d = peaks[j].p - peaks[i].p;
      if (d < 6) continue;
      const chain = [peaks[i].p, peaks[j].p];
      let strength = peaks[i].s + peaks[j].s;
      let k = j;
      for (;;) {
        const last = chain[chain.length - 1];
        const near = (target) => {
          let bestK = -1, bestDist = Infinity;
          for (let m = k + 1; m < peaks.length && peaks[m].p <= target + d * 0.3; m++) {
            const dist = Math.abs(peaks[m].p - target);
            if (dist < bestDist) { bestDist = dist; bestK = m; }
          }
          return bestDist <= d * 0.22 ? bestK : -1;
        };
        let m = near(last + d);
        if (m >= 0) {
          chain.push(peaks[m].p); strength += peaks[m].s; k = m;
        } else {
          m = near(last + 2 * d);
          if (m < 0) break;
          chain.push((last + peaks[m].p) / 2, peaks[m].p); strength += peaks[m].s; k = m;
        }
        d = (chain[chain.length - 1] - chain[0]) / (chain.length - 1);
      }
      const better = !best || chain.length > best.chain.length ||
        (chain.length === best.chain.length && strength > best.strength);
      if (chain.length >= 3 && better) best = { chain, strength };
    }
  }
  return best ? best.chain : null;
}

function skewScore(canvas, box) {
  const m = darkMask(canvas);
  const sc = projection(m, 'y', box.y0, box.y1, box.x0, box.x1);
  let s = 0;
  for (const v of sc) s += v * v;
  return s;
}

function pxBox(crop, w, h, margin) {
  const x0 = Math.max(0, Math.floor(w * (crop.l - margin) / 100));
  const x1 = Math.min(w, Math.ceil(w * (100 - crop.r + margin) / 100));
  const y0 = Math.max(0, Math.floor(h * (crop.t - margin) / 100));
  const y1 = Math.min(h, Math.ceil(h * (100 - crop.b + margin) / 100));
  return { x0, x1, y0, y1 };
}

/**
 * Finner rutenettet innenfor gjeldende ramme (crop i prosent, rot i grader).
 * Returnerer ny rot og ramme, linjer for radene (andeler av rammen, ovenfra og ned) og antall masker.
 */
export async function detectGrid(blob, crop, rot = 0) {
  const img = await loadImage(blob);
  const full = crop.t + crop.b + crop.l + crop.r < 1;
  const margin = full ? 0 : 2;

  // 1. Rett opp: prøv vinkler og velg den som gir skarpest vannrette linjer.
  let bestRot = rot, bestScore = -1;
  const tryAngles = (angles) => {
    for (const a of angles) {
      const c = drawRotated(img, a, 600);
      const s = skewScore(c, pxBox(crop, c.width, c.height, margin));
      if (s > bestScore) { bestScore = s; bestRot = a; }
    }
  };
  const coarse = [];
  for (let a = -4; a <= 4.001; a += 0.5) coarse.push(Math.round((rot + a) * 100) / 100);
  tryAngles(coarse);
  const fine = [];
  for (let a = -0.4; a <= 0.401; a += 0.1) fine.push(Math.round((bestRot + a) * 100) / 100);
  tryAngles(fine);

  // 2. Finn linjene på et større bilde.
  const c = drawRotated(img, bestRot, 1400);
  const m = darkMask(c);
  const { w, h } = m;
  let box = pxBox(crop, w, h, margin);

  const rowsIn = (b) => bestChain(findPeaks(projection(m, 'y', b.y0, b.y1, b.x0, b.x1), b.y0));
  const colsIn = (b) => bestChain(findPeaks(projection(m, 'x', b.x0, b.x1, b.y0, b.y1), b.x0));

  let ys = rowsIn(box);
  if (!ys) return null;
  box = { ...box, y0: Math.floor(ys[0]), y1: Math.ceil(ys[ys.length - 1]) + 1 };
  const xs = colsIn(box);
  if (xs) {
    box = { ...box, x0: Math.floor(xs[0]), x1: Math.ceil(xs[xs.length - 1]) + 1 };
    ys = rowsIn({ ...box, y0: Math.max(0, box.y0 - 6), y1: Math.min(h, box.y1 + 6) }) || ys;
  }
  const top = ys[0], bottom = ys[ys.length - 1];
  const left = xs ? xs[0] : box.x0, right = xs ? xs[xs.length - 1] : box.x1;
  const pct = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  return {
    rot: bestRot,
    crop: { t: pct(top / h * 100), b: pct(100 - bottom / h * 100), l: pct(left / w * 100), r: pct(100 - right / w * 100) },
    rowLines: ys.map((y) => (y - top) / (bottom - top)),
    rows: ys.length - 1,
    cols: xs ? xs.length - 1 : null,
  };
}
