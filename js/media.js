// Bildebehandling og PDF-visning (pdf.js lastes først når det trengs).

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Bildet er dekodet og kan tegnes selv om URL-en frigjøres.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.86) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kunne ikke lage bilde'))), type, quality));
}

/** Skalerer ned et bilde slik at lengste side er maks maxDim. */
export async function resizeImage(blob, maxDim = 2400, quality = 0.86) {
  const img = await loadImage(blob);
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, maxDim / Math.max(w, h));
  if (s === 1 && blob.type === 'image/jpeg' && blob.size < 3e6) return blob;
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', quality);
}

/** Beskjærer et bilde. crop = {t, b, l, r} i prosent som skal fjernes fra hver kant. */
export async function cropImage(blob, crop, maxDim = 2400) {
  const img = await loadImage(blob);
  const W = img.naturalWidth, H = img.naturalHeight;
  const sx = W * crop.l / 100, sy = H * crop.t / 100;
  const sw = W * (100 - crop.l - crop.r) / 100, sh = H * (100 - crop.t - crop.b) / 100;
  const s = Math.min(1, maxDim / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s));
  c.height = Math.max(1, Math.round(sh * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return canvasToBlob(c);
}

/* ---------------- PDF ---------------- */
let pdfjsPromise;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(blob) {
  const lib = await pdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return lib.getDocument({
    data,
    standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
    isEvalSupported: false,
  }).promise;
}

/** Tegner én side til et canvas med gitt bredde i piksler. */
export async function renderPdfPage(doc, pageNo, targetWidth) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  // Hold canvas under ~12 MP (grense i Safari på iOS)
  let scale = targetWidth / base.width;
  const maxScale = Math.sqrt(12e6 / (base.width * base.height));
  scale = Math.min(scale, maxScale);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

export async function pdfPageToBlob(doc, pageNo, targetWidth = 2000) {
  const canvas = await renderPdfPage(doc, pageNo, targetWidth);
  const blob = await canvasToBlob(canvas);
  canvas.width = canvas.height = 0;
  return blob;
}

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
