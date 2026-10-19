import { h, topbar, objUrl, emptyState, pickFiles, confirmDlg, toast, dialog } from '../ui.js';
import { getRecipeBundle, saveProject, progressOf } from '../data.js';
import * as db from '../db.js';
import { resizeImage, cropImage, openPdf, renderPdfPage, pdfPageToBlob, isPdf } from '../media.js';
import { navigate } from '../router.js';
import { startProjectDialog } from './project.js';

/* ================= Mønster med radteller ================= */
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
  const rowsEl = h('div', { class: 'rows' + (pattern.direction === 'down' ? '' : ' up') });
  const rowBtns = [];
  for (let i = 0; i < rows; i++) {
    const b = h('button', { class: 'r', 'aria-label': `Rad ${i + 1}`, onclick: () => tapRow(i) });
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

  return h('div', { class: 'pattern-view' },
    topbar(pattern.name, {
      back: project ? `#/prosjekt/${project.id}` : `#/oppskrift/${pattern.recipeId}`,
      actions: [h('a', { class: 'btn small', href: `#/monster/${pattern.id}/rediger`, 'aria-label': 'Rediger mønster' }, '✎')],
    }),
    h('div', { class: 'pv-status' }, statusText, projectInfo ? h('span', { class: 'muted small' }, projectInfo) : null),
    banner,
    h('div', { class: 'pv-main' }, scroller, repeatCol),
    h('div', { class: 'pv-actions' }, undoBtn, nextBtn, repeatBtn));
}

/* ================= Legg til / rediger mønster ================= */
async function choosePdfPage(blob) {
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
  const ok = await dialog('Velg siden med mønsteret', body, [
    { label: 'Avbryt', value: false },
    { label: 'Bruk denne siden', value: true, primary: true },
  ], { noFocus: true });
  if (!ok) { doc.destroy(); return null; }
  toast('Henter siden…');
  const out = await pdfPageToBlob(doc, page, 2400);
  doc.destroy();
  return out;
}

async function fileToSource(file) {
  if (isPdf(file)) return choosePdfPage(file);
  return resizeImage(file, 2600);
}

export async function patternEditorView(m, q, { editId } = {}) {
  const existing = editId ? await db.get('patterns', editId) : null;
  if (editId && !existing) return h('div', null, topbar('Fant ikke', { back: '#/oppskrifter' }));
  const recipeId = existing ? existing.recipeId : m[1];
  const { recipe, files, patterns } = await getRecipeBundle(recipeId);

  const st = existing ? {
    source: existing.sourceBlob || existing.imageBlob,
    crop: existing.sourceBlob ? { ...existing.crop } : { t: 0, b: 0, l: 0, r: 0 },
    rows: existing.rows, direction: existing.direction || 'up', repeat: !!existing.repeat, name: existing.name,
  } : {
    source: null, crop: { t: 0, b: 0, l: 0, r: 0 }, rows: 20, direction: 'up', repeat: false,
    name: patterns.length ? `Mønster ${patterns.length + 1}` : 'Mønster',
  };

  const editor = h('div');
  const sourceInfo = h('p', { class: 'muted small' });

  const setSource = (blob) => {
    if (!blob) return;
    st.source = blob;
    st.crop = { t: 0, b: 0, l: 0, r: 0 };
    drawEditor();
  };

  const fromRecipe = async () => {
    const choice = files.length === 1 ? files[0].id : await dialog('Velg fil fra oppskriften', h('div', { class: 'files' },
      h('p', { class: 'muted small' }, 'Hvilken fil inneholder mønsteret?')), [
      { label: 'Avbryt', value: null },
      ...files.map((f) => ({ label: (f.kind === 'pdf' ? '📄 ' : '🖼️ ') + f.name, value: f.id })),
    ]);
    if (!choice) return;
    const f = files.find((x) => x.id === choice);
    setSource(f.kind === 'pdf' ? await choosePdfPage(f.blob) : f.blob);
  };

  const sourceButtons = h('div', { class: 'row', style: { marginBottom: '12px' } },
    h('button', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*', capture: 'environment' }); if (f) setSource(await fileToSource(f)); } }, '📷 Ta bilde'),
    h('button', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*,application/pdf' }); if (f) setSource(await fileToSource(f)); } }, '🖼️ Bilde eller PDF'),
    files.length ? h('button', { onclick: fromRecipe }, '📖 Fra oppskriften') : null);

  /* --- beskjæring og rader --- */
  function drawEditor() {
    if (!st.source) {
      editor.replaceChildren(h('div', { class: 'card muted' }, 'Velg et bilde av mønsteret for å fortsette.'));
      return;
    }
    const box = h('div', { class: 'crop-box' + (st.direction === 'up' ? ' up' : '') });
    const drawBox = () => {
      Object.assign(box.style, {
        top: st.crop.t + '%', bottom: st.crop.b + '%', left: st.crop.l + '%', right: st.crop.r + '%',
      });
      box.className = 'crop-box' + (st.direction === 'up' ? ' up' : '');
      const n = Math.max(1, Math.min(st.rows || 1, 400));
      if (box.childElementCount !== n) box.replaceChildren(...Array.from({ length: n }, () => h('div')));
    };
    const slider = (key, label) => {
      const input = h('input', {
        type: 'range', min: 0, max: 90, step: 0.1, value: st.crop[key],
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          const opp = { t: 'b', b: 't', l: 'r', r: 'l' }[key];
          st.crop[key] = Math.min(v, 95 - st.crop[opp]);
          e.target.value = st.crop[key];
          drawBox();
        },
      });
      return [h('span', null, label), input];
    };
    const rowsInput = h('input', {
      type: 'number', min: 1, max: 999, value: st.rows, inputmode: 'numeric',
      oninput: (e) => { st.rows = Math.max(1, parseInt(e.target.value, 10) || 1); drawBox(); },
    });
    const step = (d) => { st.rows = Math.max(1, (st.rows || 1) + d); rowsInput.value = st.rows; drawBox(); };
    const dirSel = h('select', { onchange: (e) => { st.direction = e.target.value; drawBox(); } },
      h('option', { value: 'up', selected: st.direction === 'up' }, 'Rad 1 er nederst (vanligst)'),
      h('option', { value: 'down', selected: st.direction === 'down' }, 'Rad 1 er øverst'));
    const repeat = h('input', { type: 'checkbox', id: 'rep', checked: st.repeat, onchange: (e) => { st.repeat = e.target.checked; } });

    drawBox();
    editor.replaceChildren(
      h('h2', null, '2. Ramme rundt mønsteret'),
      h('p', { class: 'muted small' }, 'Flytt kantene slik at den gule rammen ligger nøyaktig rundt rutene i diagrammet. Linjene viser radene – første rad er markert grønn.'),
      h('div', { class: 'crop-stage' }, h('img', { src: objUrl(st.source), alt: '' }), box),
      h('div', { class: 'sliders' }, slider('t', 'Topp'), slider('b', 'Bunn'), slider('l', 'Venstre'), slider('r', 'Høyre')),
      h('h2', null, '3. Rader'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Antall rader i mønsteret'),
        h('div', { class: 'stepper' }, h('button', { onclick: () => step(-1) }, '−'), rowsInput, h('button', { onclick: () => step(1) }, '+'))),
      h('label', { class: 'field' }, h('span', null, 'Leseretning'), dirSel),
      h('label', { class: 'check', for: 'rep' }, repeat, 'Mønsteret repeteres (teller hvor mange ganger du har strikket det)'));
  }

  const name = h('input', { type: 'text', value: st.name });

  const save = async () => {
    if (!st.source) { toast('Velg et bilde av mønsteret først'); return; }
    toast('Lagrer mønster…');
    const imageBlob = await cropImage(st.source, st.crop);
    const p = existing || { id: db.uid(), recipeId, createdAt: Date.now() };
    Object.assign(p, {
      name: name.value.trim() || 'Mønster', sourceBlob: st.source, crop: st.crop, imageBlob,
      rows: st.rows, direction: st.direction, repeat: st.repeat, updatedAt: Date.now(),
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

  // Åpnet fra fil-visningen med en bestemt side?
  if (!existing && q.get('fil')) {
    const f = files.find((x) => x.id === q.get('fil'));
    if (f) {
      if (f.kind === 'pdf') {
        const doc = await openPdf(f.blob);
        setSource(await pdfPageToBlob(doc, parseInt(q.get('side'), 10) || 1, 2400));
        doc.destroy();
      } else setSource(f.blob);
    }
  }

  return h('div', null,
    topbar(existing ? 'Rediger mønster' : 'Nytt mønster', {
      back: `#/oppskrift/${recipeId}`,
      actions: [h('button', { class: 'primary small', onclick: save }, 'Lagre')],
    }),
    h('div', { class: 'content' },
      h('p', { class: 'muted' }, recipe.name),
      h('label', { class: 'field' }, h('span', null, 'Navn på mønsteret'), name),
      h('h2', null, '1. Bilde av mønsteret'),
      sourceButtons, sourceInfo,
      editor,
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { class: 'primary grow', onclick: save }, 'Lagre mønster'),
        existing ? h('button', { class: 'danger', onclick: remove }, 'Slett') : null)));
}
