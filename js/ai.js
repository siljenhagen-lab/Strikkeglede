// AI-tolkning av strikkediagrammer med Claude. Krever nett og en API-nøkkel
// som brukeren legger inn selv; nøkkelen lagres bare på denne enheten.
import * as db from './db.js';
import { loadImage, resizeImage } from './media.js';
import { normalizeChart } from './chart.js';

const MODEL = 'claude-opus-5-5';

export const getApiKey = async () => (await db.get('kv', 'apiKey')) || '';
export const setApiKey = (key) => (key ? db.put('kv', key.trim(), 'apiKey') : db.del('kv', 'apiKey'));

let sdkPromise;
const sdk = () => (sdkPromise ||= import('../vendor/anthropic/anthropic-sdk.min.mjs'));

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const evenLines = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);

/**
 * Lager en kopi av diagrambildet med rad- og kolonnenummer i margen,
 * slik at modellen vet nøyaktig hvilken rute som er hvilken.
 */
export async function annotateChart(blob, { rows, cols, rowLines, colLines, direction }) {
  const img = await loadImage(blob);
  const rl = rowLines && rowLines.length === rows + 1 ? rowLines : evenLines(rows);
  const cl = colLines && colLines.length === cols + 1 ? colLines : evenLines(cols);
  const maxGrid = 1450;
  const s = Math.min(1, maxGrid / Math.max(img.naturalWidth, img.naturalHeight));
  const gw = Math.round(img.naturalWidth * s), gh = Math.round(img.naturalHeight * s);
  const cellH = gh / rows, cellW = gw / cols;
  const font = Math.max(11, Math.min(22, Math.round(Math.min(cellH, cellW) * 0.55)));
  const L = font * 2.6, T = font * 2;
  const c = document.createElement('canvas');
  c.width = Math.round(gw + L + 6);
  c.height = Math.round(gh + T + 6);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, L, T, gw, gh);
  ctx.fillStyle = '#0a3fd1';
  ctx.font = `bold ${font}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 0; k < rows; k++) {
    const y = T + gh * (rl[k] + rl[k + 1]) / 2;
    const no = direction === 'down' ? k + 1 : rows - k;
    ctx.fillText(String(no), L / 2, y);
  }
  const step = cols > 40 ? 2 : 1;
  for (let k = 0; k < cols; k += step) {
    ctx.fillText(String(k + 1), L + gw * (cl[k] + cl[k + 1]) / 2, T / 2);
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
}

const SCHEMA = {
  type: 'object',
  properties: {
    symbols: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          glyph: { type: 'string' },
          color: { type: 'string' },
          meaning: { type: 'string' },
        },
        required: ['key', 'glyph', 'color', 'meaning'],
        additionalProperties: false,
      },
    },
    grid: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row: { type: 'integer' },
          cells: { type: 'array', items: { type: 'string' } },
        },
        required: ['row', 'cells'],
        additionalProperties: false,
      },
    },
    repeat: {
      type: 'object',
      properties: {
        present: { type: 'boolean' },
        fromRow: { type: 'integer' },
        toRow: { type: 'integer' },
        fromCol: { type: 'integer' },
        toCol: { type: 'integer' },
      },
      required: ['present', 'fromRow', 'toRow', 'fromCol', 'toCol'],
      additionalProperties: false,
    },
    notes: { type: 'string' },
  },
  required: ['symbols', 'grid', 'repeat', 'notes'],
  additionalProperties: false,
};

const SYSTEM = `You transcribe photographed knitting charts into exact digital grids for a knitting app.
Read every square carefully, row by row. Accuracy matters more than speed: compare each square with the legend before deciding.
Write symbol meanings in the same language as the legend (usually Norwegian), short and faithful to the legend's wording.`;

function instructions({ rows, cols, direction, legendText, hasLegendImage }) {
  return `The first image is the chart. It has exactly ${rows} rows and ${cols} columns of squares.
Blue numbers in the left margin are row numbers (row 1 is ${direction === 'down' ? 'the top' : 'the bottom'} row). Blue numbers along the top are column numbers, counted left to right.
${hasLegendImage ? 'The second image is the legend (tegnforklaring) explaining the symbols.' : ''}
${legendText ? `The knitter also typed this legend:\n${legendText}\n` : ''}
Return:
- symbols: one entry per distinct square type in the chart, including the plain/empty square. "key" is a short unique id (e.g. "r", "o", "k2tog"). "glyph" is ONE Unicode character that looks like the printed symbol (e.g. "○", "/", "\\\\", "◎", "•", "×", "▲"), or "" for an empty square. "color" is the square's background as #rrggbb (#ffffff unless the square is coloured, as in colourwork charts). "meaning" is the legend's explanation.
- grid: exactly ${rows} entries, one per row number 1..${rows}. Each "cells" array has exactly ${cols} keys, column 1 first (leftmost).
- repeat: if a coloured frame marks a pattern repeat (rapport), give its first/last row number and first/last column number (inclusive) with present=true; otherwise present=false and zeros.
- notes: anything uncertain (e.g. squares you could not read), in the legend's language. Empty string if none.`;
}

/**
 * Tolker et diagrambilde. Returnerer et chart-objekt (visuelle rader ovenfra og ned).
 * onProgress(antallTegn) kalles mens svaret strømmer inn.
 */
export async function interpretChart({ chartBlob, legendBlob, legendText, rows, cols, rowLines, colLines, direction }, onProgress) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Legg inn en API-nøkkel under «Mer» først.');
  if (!navigator.onLine) throw new Error('Du må være på nett for å tolke diagrammet.');

  const annotated = await annotateChart(chartBlob, { rows, cols, rowLines, colLines, direction });
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(annotated) } },
  ];
  if (legendBlob) {
    const small = await resizeImage(legendBlob, 1400, 0.9);
    content.push({ type: 'image', source: { type: 'base64', media_type: small.type || 'image/jpeg', data: await blobToBase64(small) } });
  }
  content.push({ type: 'text', text: instructions({ rows, cols, direction, legendText, hasLegendImage: !!legendBlob }) });

  const { Anthropic, jsonSchemaOutputFormat } = await sdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let message;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: jsonSchemaOutputFormat(SCHEMA) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    let chars = 0;
    stream.on('text', (delta) => { chars += delta.length; if (onProgress) onProgress(chars); });
    message = await stream.finalMessage();
  } catch (e) {
    throw new Error(explainError(e, Anthropic));
  }

  if (message.stop_reason === 'refusal') throw new Error('Tolkningen ble avvist. Prøv et annet utsnitt av bildet.');
  if (message.stop_reason === 'max_tokens') throw new Error('Diagrammet var for stort til å tolke på én gang.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Fikk et uventet svar. Prøv igjen.'); }
  return toChart(data, { rows, cols, direction });
}

function explainError(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError) return 'API-nøkkelen ble ikke godtatt. Sjekk den under «Mer».';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API-nøkkelen har ikke tilgang. Sjekk kontoen din hos Anthropic.';
  if (e instanceof Anthropic.RateLimitError) return 'For mange forespørsler akkurat nå. Vent litt og prøv igjen.';
  if (e instanceof Anthropic.APIConnectionError) return 'Fikk ikke kontakt med tjenesten. Sjekk nettet og prøv igjen.';
  if (e instanceof Anthropic.APIError) return `Tjenesten svarte med en feil (${e.status || '?'}). Prøv igjen senere.`;
  return e && e.message ? e.message : String(e);
}

/** Gjør modellens svar om til vår datamodell (visuelle rader ovenfra og ned). */
export function toChart(data, { rows, cols, direction }) {
  const symbols = [];
  const seen = new Set();
  for (const s of data.symbols || []) {
    const key = String(s.key || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    symbols.push({
      key,
      glyph: [...String(s.glyph || '')].slice(0, 2).join(''),
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#ffffff',
      meaning: String(s.meaning || ''),
    });
  }
  if (!symbols.length) symbols.push({ key: 'r', glyph: '', color: '#ffffff', meaning: 'Rett' });
  const visual = (no) => (direction === 'down' ? no - 1 : rows - no);
  const cells = Array.from({ length: rows }, () => []);
  for (const r of data.grid || []) {
    const idx = visual(r.row);
    if (idx >= 0 && idx < rows) cells[idx] = (r.cells || []).map(String);
  }
  let repeat = null;
  const rp = data.repeat;
  if (rp && rp.present) {
    const a = visual(rp.fromRow), b = visual(rp.toRow);
    repeat = { r0: Math.min(a, b), r1: Math.max(a, b), c0: Math.min(rp.fromCol, rp.toCol) - 1, c1: Math.max(rp.fromCol, rp.toCol) - 1 };
  }
  const chart = normalizeChart({ rows, cols, symbols, cells, repeat });
  chart.notes = String(data.notes || '');
  chart.missingRows = Array.from({ length: rows }, (_, i) => i).filter((i) => !((data.grid || []).some((r) => visual(r.row) === i)));
  return chart;
}
