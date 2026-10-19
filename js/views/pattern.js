import { h, topbar, objUrl, emptyState, pickFiles, confirmDlg, toast, dialog, showPhoto } from '../ui.js';
import { getRecipeBundle, saveProject, progressOf } from '../data.js';
import * as db from '../db.js';
import { resizeImage, cropImage, openPdf, renderPdfPage, pdfPageToBlob, isPdf } from '../media.js';
import { navigate } from '../router.js';
import { detectGrid } from '../grid.js';
import { startProjectDialog } from './project.js';

/* ================= Mønster med radteller ================= */
const evenLines = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);
function rowLinesOf(p) {
  return Array.isArray(p.rowLines) && p.rowLines.length === p.rows + 1 ? p.rowLines : evenLines(p.rows);
}

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* ikke støttet – helt greit */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.querySelector('.pattern-view')) keepAwake();
});
window.addEventListener('hashchange', () => { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } });

export async function patternView(m, q) {
  const pattern = await db.get('patterns', m[1]);
  if (!pattern) {
    return h('div', null, topbar('Fant ikke', { back: '#/prosjekter' }),
      h('div', { class: 'content' }, emptyState('🔍', 'Mønsteret finnes ikke lenger.')));
  }
  const bundle = await getRecipeBundle(pattern.recipeId);
  let project = q.get('p') ? bundle.projects.find((p) => p.id === q.get('p')) : null;
  if (!project && bundle.current && bundle.current.status !== 'ferdig') project = bundle.current;

  const rows = pattern.rows;
  const saved = progressOf(project, pattern.id);
  const state = { done: Math.min(saved.done, rows), repeats: saved.repeats || 0 };
  const undoStack = [];
  const zoomKey = 'sg-zoom-' + pattern.id;
  let zoom = 1;
  try { zoom = parseFloat(localStorage.getItem(zoomKey)) || 1; } catch { /* privat modus */ }

  /* --- radknapper over bildet --- */
  // Radlinjer ovenfra og ned (fra automatisk gjenkjenning), ellers jevnt fordelt.
  const lines = rowLinesOf(pattern);
  const rowsEl = h('div', { class: 'rows' });
  const rowBtns = [];
  for (let i = 0; i < rows; i++) {
    const k = pattern.direction === 'down' ? i : rows - 1 - i; // visuell plass ovenfra
    const b = h('button', {
      class: 'r', 'aria-label': `Rad ${i + 1}`, onclick: () => tapRow(i),
      style: { top: lines[k] * 100 + '%', height: (lines[k + 1] - lines[k]) * 100 + '%' },
    });
    rowBtns.push(b);
    rowsEl.append(b);
  }
  const img = h('img', { src: objUrl(pattern.imageBlob), alt: pattern.name, draggable: 'false' });
  const stage = h('div', { class: 'pv-stage' }, img, rowsEl);
  const applyZoom = () => {
    stage.style.width = zoom * 100 + '%';
    try { localStorage.setItem(zoomKey, String(zoom)); } catch { /* ignorer */ }
  };
  const zoomBy = (f) => { zoom = Math.max(1, Math.min(6, Math.round(zoom * f * 100) / 100)); applyZoom(); scrollToNext(); };
  const scroller = h('div', { class: 'pv-scroll' },
    h('div', { class: 'pv-zoom' },
      h('button', { 'aria-label': 'Zoom ut', onclick: () => zoomBy(1 / 1.4) }, '−'),
      h('button', { 'aria-label': 'Zoom inn', onclick: () => zoomBy(1.4) }, '+')),
    stage);
  applyZoom();

  /* --- statuslinje, banner og knapper --- */
  const statusText = h('span', { class: 'grow' });
  const banner = h('div', { class: 'banner hidden' });
  const repeatNum = h('div', { class: 'num' });
  const tally = h('div', { class: 'tally' });
  const undoBtn = h('button', { onclick: undo }, '↶ Angre');
  const nextBtn = h('button', { class: 'primary', onclick: () => tapRow(state.done) }, '✓ Neste rad');
  const repeatBtn = pattern.repeat ? h('button', { onclick: newRepeat }, '↻ Ny runde') : null;

  const repeatCol = pattern.repeat ? h('aside', { class: 'repeat-col', 'aria-label': 'Repetisjoner' },
    h('div', { class: 'lbl' }, 'Repe­tert'),
    repeatNum,
    h('div', { class: 'lbl' }, 'ganger'),
    h('button', { 'aria-label': 'Én repetisjon mer', onclick: () => changeRepeats(1) }, '+'),
    h('button', { 'aria-label': 'Én repetisjon mindre', onclick: () => changeRepeats(-1) }, '−'),
    tally) : null;

  function snapshot() { undoStack.push({ ...state }); if (undoStack.length > 200) undoStack.shift(); }

  async function persist() {
    if (!project) return;
    project.progress ||= {};
    project.progress[pattern.id] = { done: state.done, repeats: state.repeats };
    await saveProject(project);
  }

  function requireProject() {
    if (project) return true;
    startProjectDialog(pattern.recipeId, bundle.projects[0]);
    return false;
  }

  function tapRow(i) {
    if (!requireProject() || i >= rows) return;
    snapshot();
    // Trykk på en rad som ikke er strikket: alt til og med denne blir grønt.
    // Trykk på en grønn rad: den og radene etter blir blanke igjen.
    state.done = i < state.done ? i : i + 1;
    update(); persist();
    if (state.done === rows && navigator.vibrate) navigator.vibrate(60);
  }
  function undo() {
    if (!undoStack.length) {
      if (state.done > 0) { state.done--; update(); persist(); }
      return;
    }
    Object.assign(state, undoStack.pop());
    update(); persist();
  }
  function newRepeat() {
    if (!requireProject()) return;
    snapshot();
    state.repeats++;
    state.done = 0;
    update(); persist();
    toast(`Repetisjon ${state.repeats} ferdig – nye runde starter`);
    scrollToNext();
  }
  function changeRepeats(d) {
    if (!requireProject()) return;
    snapshot();
    state.repeats = Math.max(0, state.repeats + d);
    update(); persist();
  }

  function update() {
    rowBtns.forEach((b, i) => {
      b.classList.toggle('done', i < state.done);
      b.classList.toggle('next', !!project && i === state.done);
    });
    statusText.textContent = state.done >= rows
      ? `Alle ${rows} rader strikket`
      : `Neste: rad ${state.done + 1} av ${rows}`;
    nextBtn.disabled = !project || state.done >= rows;
    undoBtn.disabled = !project || (state.done === 0 && !undoStack.length);
    if (repeatCol) {
      repeatNum.textContent = state.repeats;
      tally.replaceChildren(...Array.from({ length: Math.min(state.repeats, 24) }, () => h('i')));
    }
    if (!project) {
      banner.className = 'banner warn';
      banner.replaceChildren(h('span', { class: 'grow' }, 'Start et prosjekt for å kunne hake av rader.'),
        h('button', { class: 'small primary', onclick: () => startProjectDialog(pattern.recipeId, bundle.projects[0]) }, 'Start prosjekt'));
    } else if (state.done >= rows) {
      banner.className = 'banner';
      banner.replaceChildren(
        h('span', { class: 'grow' }, pattern.repeat ? '🎉 Mønsteret er ferdig! Start neste repetisjon?' : '🎉 Hele mønsteret er strikket!'));
      if (pattern.repeat) banner.append(h('button', { class: 'small primary', onclick: newRepeat }, '↻ Start på nytt'));
    } else {
      banner.className = 'banner hidden';
    }
  }

  function scrollToNext() {
    const target = rowBtns[Math.min(state.done, rows - 1)];
    if (!target || zoom === 1) return;
    requestAnimationFrame(() => {
      const top = target.offsetTop + stage.offsetTop - scroller.clientHeight / 2;
      scroller.scrollTo({ top: Math.max(0, top) });
    });
  }
  img.addEventListener('load', scrollToNext, { once: true });

  update();
  keepAwake();

  const projectInfo = project
    ? [project.size && `Str. ${project.size}`, project.status === 'ferdig' ? 'ferdig prosjekt' : null].filter(Boolean).join(' · ')
    : '';

  /* --- tegnforklaring --- */
  const hasLegend = !!(pattern.legendBlob || pattern.legendText);
  let legendOpen = true;
  try { legendOpen = localStorage.getItem('sg-legend') !== '0'; } catch { /* ignorer */ }
  const legendUrl = pattern.legendBlob ? objUrl(pattern.legendBlob) : null;
  const legendPanel = hasLegend ? h('div', { class: 'legend-panel' + (legendOpen ? '' : ' hidden') },
    legendUrl ? h('img', { src: legendUrl, alt: 'Tegnforklaring', onclick: () => showPhoto(legendUrl) }) : null,
    pattern.legendText ? h('div', { class: 'legend-text' }, pattern.legendText) : null) : null;
  const legendBtn = hasLegend ? h('button', {
    class: 'small' + (legendOpen ? ' on' : ''), 'aria-pressed': String(legendOpen),
    onclick: () => {
      legendOpen = !legendOpen;
      legendPanel.classList.toggle('hidden', !legendOpen);
      legendBtn.classList.toggle('on', legendOpen);
      try { localStorage.setItem('sg-legend', legendOpen ? '1' : '0'); } catch { /* ignorer */ }
    },
  }, 'ⓘ Tegn') : null;

  return h('div', { class: 'pattern-view' },
    topbar(pattern.name, {
      back: project ? `#/prosjekt/${project.id}` : `#/oppskrift/${pattern.recipeId}`,
      actions: [legendBtn, h('a', { class: 'btn small', href: `#/monster/${pattern.id}/rediger`, 'aria-label': 'Rediger mønster' }, '✎')].filter(Boolean),
    }),
    h('div', { class: 'pv-status' }, statusText, projectInfo ? h('span', { class: 'muted small' }, projectInfo) : null),
    legendPanel,
    banner,
    h('div', { class: 'pv-main' }, scroller, repeatCol),
    h('div', { class: 'pv-actions' }, undoBtn, nextBtn, repeatBtn));
}


/* ================= Legg til / rediger mønster ================= */
async function choosePdfPage(blob, title = 'Velg siden med mønsteret') {
  toast('Åpner PDF…');
  const doc = await openPdf(blob);
  let page = 1;
  const holder = h('div', { style: { textAlign: 'center', minHeight: '200px' } });
  const label = h('strong', null);
  const draw = async () => {
    label.textContent = `Side ${page} av ${doc.numPages}`;
    const c = await renderPdfPage(doc, page, 700);
    c.style.width = '100%';
    c.style.border = '1px solid var(--line)';
    holder.replaceChildren(c);
  };
  await draw();
  const body = h('div', null,
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
      h('button', { class: 'small', onclick: () => { if (page > 1) { page--; draw(); } } }, '◀'),
      label,
      h('button', { class: 'small', onclick: () => { if (page < doc.numPages) { page++; draw(); } } }, '▶')),
    holder);
  const ok = await dialog(title, body, [
    { label: 'Avbryt', value: false },
    { label: 'Bruk denne siden', value: true, primary: true },
  ], { noFocus: true });
  if (!ok) { doc.destroy(); return null; }
  toast('Henter siden…');
  const out = await pdfPageToBlob(doc, page, 2400);
  doc.destroy();
  return out;
}

async function fileToSource(file, title) {
  if (isPdf(file)) return choosePdfPage(file, title);
  return resizeImage(file, 2600);
}

const FULL = () => ({ t: 0, b: 0, l: 0, r: 0, rot: 0 });

/**
 * Bilde med justerbar ramme (og evt. radlinjer). target har { source, crop } og,
 * for mønster, { rows, rowLines, direction }. onEdit kalles når brukeren endrer rammen selv.
 */
function cropper(target, { grid = false, onEdit } = {}) {
  let zoom = 1;
  const img = h('img', { src: objUrl(target.source), alt: '' });
  const box = h('div', { class: 'crop-box' });
  const stage = h('div', { class: 'crop-stage' }, img, box);
  const scroll = h('div', { class: 'crop-scroll' }, stage);

  const drawBox = () => {
    const c = target.crop;
    img.style.transform = c.rot ? `rotate(${c.rot}deg)` : '';
    Object.assign(box.style, { top: c.t + '%', bottom: c.b + '%', left: c.l + '%', right: c.r + '%' });
    if (!grid) return;
    const n = Math.max(1, Math.min(target.rows || 1, 400));
    const lines = Array.isArray(target.rowLines) && target.rowLines.length === n + 1 ? target.rowLines : evenLines(n);
    const first = target.direction === 'down' ? 0 : n - 1;
    box.replaceChildren(
      h('div', { class: 'first-row', style: { top: lines[first] * 100 + '%', height: (lines[first + 1] - lines[first]) * 100 + '%' } }),
      ...lines.slice(1, -1).map((f) => h('div', { class: 'line', style: { top: f * 100 + '%' } })));
  };

  const slider = (key, label, min, max, step) => {
    const input = h('input', {
      type: 'range', min, max, step, value: target.crop[key] || 0,
      oninput: (e) => {
        let v = parseFloat(e.target.value);
        const opp = { t: 'b', b: 't', l: 'r', r: 'l' }[key];
        if (opp) v = Math.min(v, 95 - target.crop[opp]);
        target.crop[key] = v;
        e.target.value = v;
        if (onEdit) onEdit();
        drawBox();
      },
    });
    return [h('span', null, label), input];
  };

  drawBox();
  const el = h('div', null,
    h('div', { class: 'crop-wrap' },
      scroll,
      h('div', { class: 'crop-zoom' },
        h('button', { 'aria-label': 'Zoom ut', onclick: () => { zoom = Math.max(1, zoom / 1.5); stage.style.width = zoom * 100 + '%'; } }, '−'),
        h('button', { 'aria-label': 'Zoom inn', onclick: () => { zoom = Math.min(5, zoom * 1.5); stage.style.width = zoom * 100 + '%'; } }, '+'))),
    h('div', { class: 'sliders' },
      slider('t', 'Topp', 0, 95, 0.1), slider('b', 'Bunn', 0, 95, 0.1),
      slider('l', 'Venstre', 0, 95, 0.1), slider('r', 'Høyre', 0, 95, 0.1),
      slider('rot', 'Rotér', -10, 10, 0.1)));
  return { el, drawBox };
}

export async function patternEditorView(m, q, { editId } = {}) {
  const existing = editId ? await db.get('patterns', editId) : null;
  if (editId && !existing) return h('div', null, topbar('Fant ikke', { back: '#/oppskrifter' }));
  const recipeId = existing ? existing.recipeId : m[1];
  const { recipe, files, patterns } = await getRecipeBundle(recipeId);

  const st = existing ? {
    source: existing.sourceBlob || existing.imageBlob,
    crop: existing.sourceBlob ? { rot: 0, ...existing.crop } : FULL(),
    rows: existing.rows, rowLines: existing.rowLines || null, cols: existing.cols || null,
    direction: existing.direction || 'up', repeat: !!existing.repeat, name: existing.name,
    legend: null, legendText: existing.legendText || '',
  } : {
    source: null, crop: FULL(), rows: 20, rowLines: null, cols: null, direction: 'up', repeat: false,
    name: patterns.length ? `Mønster ${patterns.length + 1}` : 'Mønster', legend: null, legendText: '',
  };
  if (existing && existing.legendCrop) {
    const src = existing.legendFromPattern ? st.source : existing.legendSourceBlob;
    if (src) st.legend = { source: src, crop: { rot: 0, ...existing.legendCrop }, fromPattern: !!existing.legendFromPattern };
  }

  const editor = h('div');
  const legendEditor = h('div');

  /* --- velge bilde --- */
  const fromRecipeFile = async (title) => {
    const choice = files.length === 1 ? files[0].id : await dialog('Velg fil fra oppskriften', null, [
      { label: 'Avbryt', value: null },
      ...files.map((f) => ({ label: (f.kind === 'pdf' ? '📄 ' : '🖼️ ') + f.name, value: f.id })),
    ]);
    if (!choice) return null;
    const f = files.find((x) => x.id === choice);
    return f.kind === 'pdf' ? choosePdfPage(f.blob, title) : f.blob;
  };
  const sourceButtons = (onPick, title) => h('div', { class: 'row', style: { marginBottom: '12px' } },
    h('button', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*', capture: 'environment' }); if (f) onPick(await fileToSource(f, title)); } }, '📷 Ta bilde'),
    h('button', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*,application/pdf' }); if (f) onPick(await fileToSource(f, title)); } }, '🖼️ Bilde eller PDF'),
    files.length ? h('button', { onclick: async () => onPick(await fromRecipeFile(title)) }, '📖 Fra oppskriften') : null);

  /* --- automatisk rutenett --- */
  let edits = 0; // endringer brukeren gjør selv mens gjenkjenningen pågår, vinner
  const autoDetect = async (quiet) => {
    toast('Leter etter rutenettet…');
    const seq = edits;
    let res = null;
    try { res = await detectGrid(st.source, st.crop, st.crop.rot || 0); } catch (e) { console.warn(e); }
    if (seq !== edits) return;
    if (!res || res.rows < 2) {
      if (!quiet) dialog('Fant ikke rutenettet', 'Flytt rammen omtrent rundt diagrammet og prøv igjen – eller still inn rammen og antall rader selv.');
      else toast('Fant ikke rutenettet automatisk – juster rammen selv');
      return;
    }
    st.crop = { ...res.crop, rot: res.rot };
    st.rows = res.rows;
    st.rowLines = res.rowLines;
    st.cols = res.cols;
    toast(`Fant ${res.rows} rader${res.cols ? ` og ${res.cols} masker` : ''} ✓`);
    drawEditor();
  };

  const setSource = async (blob) => {
    if (!blob) return;
    st.source = blob;
    st.crop = FULL();
    st.rowLines = null;
    if (st.legend && st.legend.fromPattern) st.legend.source = blob;
    drawEditor();
    drawLegend();
    await autoDetect(true);
  };

  /* --- mønsterets ramme og rader --- */
  function drawEditor() {
    if (!st.source) {
      editor.replaceChildren(h('div', { class: 'card muted' }, 'Velg et bilde av mønsteret for å fortsette.'));
      return;
    }
    const info = h('p', { class: 'small grid-info' });
    const drawInfo = () => {
      info.textContent = st.rowLines
        ? `✓ Rutenett funnet: ${st.rows} rader${st.cols ? ` × ${st.cols} masker` : ''}. Linjene følger rutene i bildet.`
        : `Radene fordeles jevnt i rammen (${st.rows} rader).`;
      info.classList.toggle('ok', !!st.rowLines);
    };
    const crop = cropper(st, { grid: true, onEdit: () => { edits++; st.rowLines = null; drawInfo(); } });
    const rowsInput = h('input', {
      type: 'number', min: 1, max: 999, value: st.rows, inputmode: 'numeric',
      oninput: (e) => { edits++; st.rows = Math.max(1, parseInt(e.target.value, 10) || 1); st.rowLines = null; drawInfo(); crop.drawBox(); },
    });
    const step = (d) => { edits++; st.rows = Math.max(1, (st.rows || 1) + d); rowsInput.value = st.rows; st.rowLines = null; drawInfo(); crop.drawBox(); };
    const dirSel = h('select', { onchange: (e) => { st.direction = e.target.value; crop.drawBox(); } },
      h('option', { value: 'up', selected: st.direction === 'up' }, 'Rad 1 er nederst (vanligst)'),
      h('option', { value: 'down', selected: st.direction === 'down' }, 'Rad 1 er øverst'));
    const repeat = h('input', { type: 'checkbox', id: 'rep', checked: st.repeat, onchange: (e) => { st.repeat = e.target.checked; } });
    drawInfo();

    editor.replaceChildren(
      h('h2', null, '2. Finn rutene'),
      h('p', { class: 'muted small' }, 'Appen prøver å finne rutenettet selv. Sjekk at de gule linjene følger radene. Hvis ikke: flytt rammen omtrent rundt diagrammet og trykk «Finn rutenett» igjen. Første rad er grønn.'),
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        h('button', { class: 'primary', onclick: () => autoDetect(false) }, '🔍 Finn rutenett'),
        h('button', { class: 'small', onclick: () => { st.crop = FULL(); st.rowLines = null; drawEditor(); } }, 'Nullstill ramme')),
      info,
      crop.el,
      h('h2', null, '3. Rader'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Antall rader i mønsteret'),
        h('div', { class: 'stepper' }, h('button', { onclick: () => step(-1) }, '−'), rowsInput, h('button', { onclick: () => step(1) }, '+'))),
      h('label', { class: 'field' }, h('span', null, 'Leseretning'), dirSel),
      h('label', { class: 'check', for: 'rep' }, repeat, 'Mønsteret repeteres (teller hvor mange ganger du har strikket det)'));
  }

  /* --- tegnforklaring --- */
  const legendText = h('textarea', {
    value: st.legendText, placeholder: 'Skriv forklaringen selv, f.eks.\n□ = rett fra retten\n○ = kast\n/ = 2 r sammen',
    oninput: (e) => { st.legendText = e.target.value; },
    style: { minHeight: '90px' },
  });
  function drawLegend() {
    const setLegend = (blob, fromPattern) => {
      if (!blob) return;
      // Fra samme bilde: foreslå området over diagrammet, der forklaringen ofte står.
      const crop = fromPattern && st.crop.t > 5 ? { t: 0, b: Math.max(0, 100 - st.crop.t), l: 0, r: 0, rot: st.crop.rot || 0 } : FULL();
      st.legend = { source: blob, crop, fromPattern };
      drawLegend();
    };
    const buttons = h('div', { class: 'row', style: { marginBottom: '12px' } },
      st.source ? h('button', { onclick: () => setLegend(st.source, true) }, '▦ Fra samme bilde') : null,
      ...sourceButtons((b) => setLegend(b, false), 'Velg siden med tegnforklaringen').children,
      st.legend ? h('button', { class: 'small danger', onclick: () => { st.legend = null; drawLegend(); } }, 'Fjern bilde') : null);
    legendEditor.replaceChildren(
      h('p', { class: 'muted small' }, 'Ta med forklaringen på symbolene, så ser du den mens du strikker. Velg et utsnitt av bildet, og/eller skriv den inn.'),
      buttons,
      st.legend ? cropper(st.legend).el : null,
      h('label', { class: 'field' }, h('span', null, 'Forklaring som tekst (valgfritt)'), legendText));
  }

  const name = h('input', { type: 'text', value: st.name });

  const save = async () => {
    if (!st.source) { toast('Velg et bilde av mønsteret først'); return; }
    toast('Lagrer mønster…');
    const imageBlob = await cropImage(st.source, st.crop);
    const legendBlob = st.legend ? await cropImage(st.legend.source, st.legend.crop, 1800) : null;
    const p = existing || { id: db.uid(), recipeId, createdAt: Date.now() };
    Object.assign(p, {
      name: name.value.trim() || 'Mønster', sourceBlob: st.source, crop: st.crop, imageBlob,
      rows: st.rows, rowLines: st.rowLines, cols: st.cols, direction: st.direction, repeat: st.repeat,
      legendBlob, legendCrop: st.legend ? st.legend.crop : null, legendFromPattern: !!(st.legend && st.legend.fromPattern),
      legendSourceBlob: st.legend && !st.legend.fromPattern ? st.legend.source : null,
      legendText: st.legendText.trim(), updatedAt: Date.now(),
    });
    await db.put('patterns', p);
    toast('Mønsteret er lagret');
    const { current } = await getRecipeBundle(recipeId);
    const live = current && current.status !== 'ferdig' ? current : null;
    navigate(`#/monster/${p.id}${live ? '?p=' + live.id : ''}`, { replace: true });
  };

  const remove = async () => {
    if (await confirmDlg('Slette mønsteret?', 'Mønsteret og fremdriften på det slettes.', 'Slett', true)) {
      await db.del('patterns', existing.id);
      navigate(`#/oppskrift/${recipeId}`, { replace: true });
    }
  };

  drawEditor();
  drawLegend();

  const view = h('div', null,
    topbar(existing ? 'Rediger mønster' : 'Nytt mønster', {
      back: `#/oppskrift/${recipeId}`,
      actions: [h('button', { class: 'primary small', onclick: save }, 'Lagre')],
    }),
    h('div', { class: 'content' },
      h('p', { class: 'muted' }, recipe.name),
      h('label', { class: 'field' }, h('span', null, 'Navn på mønsteret'), name),
      h('h2', null, '1. Bilde av mønsteret'),
      sourceButtons(setSource, 'Velg siden med mønsteret'),
      editor,
      h('h2', null, '4. Tegnforklaring'),
      legendEditor,
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { class: 'primary grow', onclick: save }, 'Lagre mønster'),
        existing ? h('button', { class: 'danger', onclick: remove }, 'Slett') : null)));

  // Åpnet fra fil-visningen med en bestemt side?
  if (!existing && q.get('fil')) {
    const f = files.find((x) => x.id === q.get('fil'));
    if (f) {
      let blob = f.blob;
      if (f.kind === 'pdf') {
        const doc = await openPdf(f.blob);
        blob = await pdfPageToBlob(doc, parseInt(q.get('side'), 10) || 1, 2400);
        doc.destroy();
      }
      setSource(blob);
    }
  }
  return view;
}
