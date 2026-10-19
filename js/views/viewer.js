import { h, topbar, objUrl, emptyState } from '../ui.js';
import * as db from '../db.js';
import { openPdf, renderPdfPage } from '../media.js';

/** Viser en PDF eller et bilde fra oppskriften, med zoom. */
export async function fileView(m) {
  const file = await db.get('files', m[1]);
  if (!file) {
    return h('div', null, topbar('Fant ikke', { back: '#/oppskrifter' }),
      h('div', { class: 'content' }, emptyState('🔍', 'Filen finnes ikke lenger.')));
  }
  const viewer = h('div', { class: 'viewer' });
  let zoom = 1;
  const setZoom = (z) => { zoom = Math.max(1, Math.min(4, z)); viewer.style.setProperty('--zoom', zoom); };
  const newPattern = (page) => `#/oppskrift/${file.recipeId}/nytt-monster?fil=${file.id}${page ? '&side=' + page : ''}`;

  if (file.kind === 'pdf') {
    const status = h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Åpner PDF…');
    viewer.append(status);
    renderAll(file.blob, viewer, status, newPattern);
  } else {
    viewer.append(h('img', { class: 'page', src: objUrl(file.blob), alt: file.name }),
      h('div', { class: 'page-tools' }, h('a', { class: 'btn small', href: newPattern() }, '▦ Bruk som mønster')));
  }

  return h('div', null,
    topbar(file.name || 'Oppskrift', {
      back: `#/oppskrift/${file.recipeId}`,
      actions: [
        h('button', { class: 'small', 'aria-label': 'Zoom ut', onclick: () => setZoom(zoom / 1.3) }, '−'),
        h('button', { class: 'small', 'aria-label': 'Zoom inn', onclick: () => setZoom(zoom * 1.3) }, '+'),
      ],
    }),
    viewer);
}

async function renderAll(blob, viewer, status, newPattern) {
  let doc;
  try {
    doc = await openPdf(blob);
  } catch (e) {
    status.textContent = 'Kunne ikke åpne PDF-en: ' + e.message;
    return;
  }
  status.remove();
  const width = Math.min(2200, Math.round((viewer.clientWidth || window.innerWidth) * (window.devicePixelRatio || 1) * 1.5));
  for (let i = 1; i <= doc.numPages; i++) {
    if (!viewer.isConnected && i > 1) break; // brukeren har gått videre
    const canvas = await renderPdfPage(doc, i, width);
    canvas.className = 'page';
    viewer.append(canvas,
      h('div', { class: 'page-tools' },
        h('span', { class: 'muted small' }, `Side ${i} av ${doc.numPages}`),
        h('a', { class: 'btn small', href: newPattern(i) }, '▦ Bruk som mønster')));
  }
  doc.destroy();
}
