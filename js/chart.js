// Digitale strikkediagrammer: datamodell og tegning.
//
// chart = {
//   rows, cols,
//   symbols: [{ key, glyph, color, meaning }],
//   cells: [[key, …], …]   // visuelt ovenfra og ned, venstre mot høyre
//   repeat: { r0, r1, c0, c1 } | null   // rapport, visuelle indekser (inklusive)
// }

export const DEFAULT_SYMBOLS = [
  { key: 'r', glyph: '', color: '#ffffff', meaning: 'Rett fra retten, vrang fra vrangen' },
  { key: 'v', glyph: '•', color: '#ffffff', meaning: 'Vrang fra retten, rett fra vrangen' },
  { key: 'o', glyph: '○', color: '#ffffff', meaning: 'Kast' },
  { key: 'k2', glyph: '/', color: '#ffffff', meaning: '2 rett sammen' },
  { key: 'ovt', glyph: '\\', color: '#ffffff', meaning: 'Ta 1 m løs av, 1 r, løft den løse m over' },
];

export function emptyChart(rows, cols) {
  const symbols = DEFAULT_SYMBOLS.map((s) => ({ ...s }));
  return { rows, cols, symbols, cells: Array.from({ length: rows }, () => Array(cols).fill(symbols[0].key)), repeat: null };
}

export function symbolMap(chart) {
  return Object.fromEntries(chart.symbols.map((s) => [s.key, s]));
}

/** Sørger for at alle rader har riktig lengde og at alle nøkler finnes. */
export function normalizeChart(chart) {
  const keys = new Set(chart.symbols.map((s) => s.key));
  const fallback = chart.symbols[0] ? chart.symbols[0].key : 'r';
  chart.cells = Array.from({ length: chart.rows }, (_, r) => {
    const row = (chart.cells[r] || []).slice(0, chart.cols);
    while (row.length < chart.cols) row.push(fallback);
    return row.map((k) => (keys.has(k) ? k : fallback));
  });
  if (chart.repeat) {
    const { r0, r1, c0, c1 } = chart.repeat;
    const ok = [r0, r1, c0, c1].every(Number.isInteger) && r0 <= r1 && c0 <= c1 &&
      r0 >= 0 && c0 >= 0 && r1 < chart.rows && c1 < chart.cols;
    if (!ok) chart.repeat = null;
  }
  return chart;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Lyst eller mørkt symbol avhengig av bakgrunnen. */
function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#222';
  const n = parseInt(m[1], 16);
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l < 140 ? '#fff' : '#222';
}

/**
 * Tegner diagrammet som SVG. Radnummer står til høyre, slik at radene
 * fyller hele høyden og radtelleren kan legges rett over.
 */
export function chartToSvg(chart, { direction = 'up', cell = 28 } = {}) {
  const map = symbolMap(chart);
  const numW = cell * 1.3;
  const W = chart.cols * cell + numW, H = chart.rows * cell;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`];
  for (let r = 0; r < chart.rows; r++) {
    for (let c = 0; c < chart.cols; c++) {
      const s = map[chart.cells[r][c]] || {};
      const x = c * cell, y = r * cell;
      out.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${esc(s.color || '#fff')}" stroke="#666" stroke-width="1"/>`);
      if (s.glyph) {
        out.push(`<text x="${x + cell / 2}" y="${y + cell / 2}" font-size="${cell * 0.62}" text-anchor="middle" dominant-baseline="central" fill="${inkFor(s.color)}">${esc(s.glyph)}</text>`);
      }
    }
    const no = direction === 'down' ? r + 1 : chart.rows - r;
    out.push(`<text x="${chart.cols * cell + numW / 2}" y="${r * cell + cell / 2}" font-size="${cell * 0.42}" text-anchor="middle" dominant-baseline="central" fill="#777">${no}</text>`);
  }
  out.push(`<rect x="0.5" y="0.5" width="${chart.cols * cell - 1}" height="${H - 1}" fill="none" stroke="#222" stroke-width="2"/>`);
  if (chart.repeat) {
    const { r0, r1, c0, c1 } = chart.repeat;
    out.push(`<rect x="${c0 * cell + 1.5}" y="${r0 * cell + 1.5}" width="${(c1 - c0 + 1) * cell - 3}" height="${(r1 - r0 + 1) * cell - 3}" fill="none" stroke="#d6262b" stroke-width="3"/>`);
  }
  out.push('</svg>');
  return out.join('');
}

export function chartToBlob(chart, opts) {
  return new Blob([chartToSvg(chart, opts)], { type: 'image/svg+xml' });
}
