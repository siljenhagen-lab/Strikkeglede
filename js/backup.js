// Eksport og import av alle data som én JSON-fil (bilder og PDF-er som base64).
import * as db from './db.js';

const DATA_STORES = ['recipes', 'files', 'patterns', 'projects'];

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const type = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function encode(value) {
  if (value instanceof Blob) return { __blob: await blobToDataUrl(value) };
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await encode(v);
    return out;
  }
  return value;
}

function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    if (typeof value.__blob === 'string') return dataUrlToBlob(value.__blob);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

export async function exportAll() {
  const stores = {};
  for (const s of DATA_STORES) stores[s] = await encode(await db.all(s));
  const kv = await encode(await db.kvEntries());
  const payload = { app: 'Strikkeglede', format: 1, exportedAt: new Date().toISOString(), stores, kv };
  const json = JSON.stringify(payload);
  const date = new Date().toISOString().slice(0, 10);
  return new File([json], `strikkeglede-${date}.json`, { type: 'application/json' });
}

/** mode: 'replace' sletter alt først, 'merge' legger til / oppdaterer. */
export async function importAll(file, mode) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('Filen er ikke en gyldig sikkerhetskopi.');
  }
  if (!payload || payload.app !== 'Strikkeglede' || !payload.stores) {
    throw new Error('Filen ser ikke ut til å være en sikkerhetskopi fra Strikkeglede.');
  }
  if (mode === 'replace') await db.clearAll();
  const counts = {};
  for (const s of DATA_STORES) {
    const items = decode(payload.stores[s] || []);
    for (const item of items) await db.put(s, item);
    counts[s] = items.length;
  }
  for (const [k, v] of decode(payload.kv || [])) {
    if (mode === 'merge' && k === 'needles') {
      const cur = (await db.get('kv', 'needles')) || {};
      await db.put('kv', { ...cur, ...v }, k);
    } else if (mode === 'merge' && k === 'customSizes') {
      const cur = (await db.get('kv', 'customSizes')) || [];
      await db.put('kv', [...new Set([...cur, ...v])], k);
    } else {
      await db.put('kv', v, k);
    }
  }
  return counts;
}
