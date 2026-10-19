import { h, topbar, objUrl, emptyState, toast, dialog, confirmDlg } from '../ui.js';
import * as db from '../db.js';
import { navigate } from '../router.js';
import { emptyChart, normalizeChart, symbolMap } from '../chart.js';
import { interpretChart, getApiKey } from '../ai.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

export async function chartEditorView(m) {
  const pattern = await db.get('patterns', m[1]);
  if (!pattern) {
    return h('div', null, topbar('Fant ikke', { back: '#/prosjekter' }),
      h('div', { class: 'content' }, emptyState('🔍', 'Mønsteret finnes ikke lenger.')));
  }
  const direction = pattern.direction || 'up';
  let chart = pattern.chart ? normalizeChart(clone(pattern.chart)) : null;
  let selected = chart ? chart.symbols[0].key : null;
  let mode = 'diagram';
  let cellPx = 0;
  const undoStack = [];
  let dirty = false;
  const hasKey = !!(await getApiKey());

  const body = h('div', { class: 'content chart-editor' });
  const rowNo = (r) => (direction === 'down' ? r + 1 : chart.rows - r);
  const fromRowNo = (no) => (direction === 'down' ? no - 1 : chart.rows - no);

  /* ---------- tolkning ---------- */
  async function runAI() {
    let cols = pattern.cols;
    if (!cols) {
      const input = h('input', { type: 'number', min: 1, max: 300, inputmode: 'numeric' });
      const ok = await dialog('Hvor mange masker?', h('label', { class: 'field' },
        h('span', null, `Antall masker (ruter) i bredden – mønsteret har ${pattern.rows} rader`), input), [
        { label: 'Avbryt', value: false }, { label: 'OK', value: true, primary: true },
      ]);
      cols = parseInt(input.value, 10);
      if (!ok || !(cols > 0)) return;
    }
    const status = h('p', { class: 'muted' }, 'Sender bildet …');
    body.replaceChildren(h('div', { class: 'card ai-working' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('h3', null, 'Tolker diagrammet'),
      h('p', null, `${pattern.rows} rader × ${cols} masker. Dette tar ofte et halvt til to minutter – la appen være åpen.`),
      status));
    try {
      const result = await interpretChart({
        chartBlob: pattern.imageBlob, legendBlob: pattern.legendBlob, legendText: pattern.legendText,
        rows: pattern.rows, cols, rowLines: pattern.rowLines, colLines: pattern.colLines, direction,
      }, (n) => { status.textContent = `Mottar svar … (${n} tegn)`; });
      if (chart) undoStack.push(clone(chart));
      chart = result;
      selected = chart.symbols[0].key;
      dirty = true;
      toast('Ferdig! Sjekk diagrammet mot bildet.');
    } catch (e) {
      dialog('Tolkningen feilet', e.message);
    }
    draw();
  }

  /* ---------- redigering ---------- */
  const snapshot = () => { undoStack.push(clone(chart)); if (undoStack.length > 100) undoStack.shift(); dirty = true; };

  function editSymbols() {
    const work = clone(chart.symbols);
    const list = h('div');
    const drawList = () => list.replaceChildren(...work.map((s, i) => h('div', { class: 'sym-edit' },
      h('input', { type: 'text', value: s.glyph, maxlength: 2, class: 'glyph-in', 'aria-label': 'Tegn', oninput: (e) => { s.glyph = e.target.value; } }),
      h('input', { type: 'color', value: s.color || '#ffffff', 'aria-label': 'Farge', oninput: (e) => { s.color = e.target.value; } }),
      h('input', { type: 'text', value: s.meaning, placeholder: 'Betydning', oninput: (e) => { s.meaning = e.target.value; } }),
      work.length > 1 ? h('button', { class: 'small ghost', 'aria-label': 'Slett symbol', onclick: () => { work.splice(i, 1); drawList(); } }, '✕') : null)));
    drawList();
    const content = h('div', null,
      h('p', { class: 'muted small' }, 'Tegn: ett tegn som ligner symbolet (f.eks. ○ / \\ • ×), eller tomt. Farge brukes til mønstre med farger.'),
      list,
      h('button', {
        class: 'small', onclick: () => {
          let n = work.length + 1;
          while (work.some((s) => s.key === 's' + n)) n++;
          work.push({ key: 's' + n, glyph: '?', color: '#ffffff', meaning: '' });
          drawList();
        },
      }, '+ Nytt symbol'));
    return dialog('Symboler', content, [
      { label: 'Avbryt', value: false }, { label: 'Bruk', value: true, primary: true },
    ], { noFocus: true }).then((ok) => {
      if (!ok) return;
      snapshot();
      chart.symbols = work;
      normalizeChart(chart);
      if (!work.some((s) => s.key === selected)) selected = work[0].key;
      draw();
    });
  }

  async function editSize() {
    const btn = (label, fn) => h('button', { class: 'small', onclick: () => { snapshot(); fn(); normalizeChart(chart); draw(); toast(`${chart.rows} rader × ${chart.cols} masker`); } }, label);
    const blank = () => chart.symbols[0].key;
    const shiftRepeat = (dr, dc) => { if (chart.repeat) { chart.repeat.r0 += dr; chart.repeat.r1 += dr; chart.repeat.c0 += dc; chart.repeat.c1 += dc; } };
    await dialog('Rader og masker', h('div', { class: 'size-grid' },
      h('span', null, 'Rad øverst'),
      btn('+', () => { chart.cells.unshift(Array(chart.cols).fill(blank())); chart.rows++; shiftRepeat(1, 0); }),
      btn('−', () => { if (chart.rows > 1) { chart.cells.shift(); chart.rows--; shiftRepeat(-1, 0); } }),
      h('span', null, 'Rad nederst'),
      btn('+', () => { chart.cells.push(Array(chart.cols).fill(blank())); chart.rows++; }),
      btn('−', () => { if (chart.rows > 1) { chart.cells.pop(); chart.rows--; } }),
      h('span', null, 'Maske til venstre'),
      btn('+', () => { chart.cells.forEach((r) => r.unshift(blank())); chart.cols++; shiftRepeat(0, 1); }),
      btn('−', () => { if (chart.cols > 1) { chart.cells.forEach((r) => r.shift()); chart.cols--; shiftRepeat(0, -1); } }),
      h('span', null, 'Maske til høyre'),
      btn('+', () => { chart.cells.forEach((r) => r.push(blank())); chart.cols++; }),
      btn('−', () => { if (chart.cols > 1) { chart.cells.forEach((r) => r.pop()); chart.cols--; } })),
    [{ label: 'Ferdig', value: true, primary: true }], { noFocus: true });
  }

  async function editRepeat() {
    const rp = chart.repeat;
    const num = (v) => h('input', { type: 'number', min: 1, value: v, inputmode: 'numeric' });
    const lo = rp ? Math.min(rowNo(rp.r0), rowNo(rp.r1)) : 1, hi = rp ? Math.max(rowNo(rp.r0), rowNo(rp.r1)) : chart.rows;
    const fr = num(lo), tr = num(hi), fc = num(rp ? rp.c0 + 1 : 1), tc = num(rp ? rp.c1 + 1 : chart.cols);
    const choice = await dialog('Rapport (rød ramme)', h('div', null,
      h('p', { class: 'muted small' }, 'Området som gjentas i bredden og høyden. Masker telles fra venstre.'),
      h('div', { class: 'size-grid' },
        h('span', null, 'Fra rad'), fr, h('span'), h('span', null, 'Til rad'), tr, h('span'),
        h('span', null, 'Fra maske'), fc, h('span'), h('span', null, 'Til maske'), tc, h('span'))), [
      { label: 'Avbryt', value: null },
      rp ? { label: 'Fjern', value: 'remove', danger: true } : null,
      { label: 'Bruk', value: 'set', primary: true },
    ].filter(Boolean), { noFocus: true });
    if (!choice) return;
    snapshot();
    if (choice === 'remove') chart.repeat = null;
    else {
      const a = fromRowNo(parseInt(fr.value, 10)), b = fromRowNo(parseInt(tr.value, 10));
      chart.repeat = { r0: Math.min(a, b), r1: Math.max(a, b), c0: parseInt(fc.value, 10) - 1, c1: parseInt(tc.value, 10) - 1 };
      normalizeChart(chart);
      if (!chart.repeat) toast('Ugyldig område');
    }
    draw();
  }

  /* ---------- tegning ---------- */
  function gridEl() {
    const map = symbolMap(chart);
    if (!cellPx) cellPx = Math.max(14, Math.min(40, Math.floor((Math.min(window.innerWidth, 900) - 70) / chart.cols)));
    const grid = h('div', {
      class: 'cgrid' + (mode === 'over' ? ' over' : ''),
      style: { gridTemplateColumns: `repeat(${chart.cols}, ${cellPx}px) ${Math.round(cellPx * 1.3)}px`, gridAutoRows: cellPx + 'px', fontSize: Math.round(cellPx * 0.62) + 'px' },
    });
    const photoW = cellPx * chart.cols, photoH = cellPx * chart.rows;
    if (mode === 'over') {
      grid.append(h('img', { class: 'cgrid-photo', src: objUrl(pattern.imageBlob), alt: '', style: { width: photoW + 'px', height: photoH + 'px' } }));
    }
    for (let r = 0; r < chart.rows; r++) {
      for (let c = 0; c < chart.cols; c++) {
        const s = map[chart.cells[r][c]] || {};
        const inRep = chart.repeat && r >= chart.repeat.r0 && r <= chart.repeat.r1 && c >= chart.repeat.c0 && c <= chart.repeat.c1;
        const cls = ['cc'];
        if (inRep) {
          if (r === chart.repeat.r0) cls.push('rt');
          if (r === chart.repeat.r1) cls.push('rb');
          if (c === chart.repeat.c0) cls.push('rl');
          if (c === chart.repeat.c1) cls.push('rr');
        }
        grid.append(h('div', { class: cls.join(' '), dataset: { r, c }, style: { background: s.color || '#fff' } }, s.glyph || ''));
      }
      grid.append(h('div', { class: 'cno' }, rowNo(r)));
    }
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cc');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (chart.cells[r][c] === selected) return;
      snapshot();
      chart.cells[r][c] = selected;
      const s = map[selected];
      cell.style.background = s.color || '#fff';
      cell.textContent = s.glyph || '';
    });
    return grid;
  }

  function draw() {
    if (!chart) {
      body.replaceChildren(
        h('div', { class: 'card' },
          h('h3', null, 'Lag et digitalt diagram'),
          h('p', null, 'AI-en leser symbolene i bildet ved hjelp av tegnforklaringen og lager et diagram du kan redigere. Sjekk alltid resultatet mot bildet og rett ruter som er feil.'),
          h('p', { class: 'muted small' }, `${pattern.rows} rader${pattern.cols ? ` × ${pattern.cols} masker` : ''}${pattern.legendBlob || pattern.legendText ? ' · tegnforklaring følger med' : ' · tips: legg til tegnforklaring på mønsteret først'}`),
          hasKey
            ? h('button', { class: 'primary', onclick: runAI }, '✨ Tolk med AI')
            : h('p', null, 'For å bruke AI-tolkning må du legge inn en API-nøkkel under ', h('a', { href: '#/mer' }, 'Mer'), '.'),
          h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Krever nett. Bildet sendes til Anthropic for tolkning.')),
        h('div', { class: 'card' },
          h('h3', null, 'Eller tegn selv'),
          h('p', { class: 'muted small' }, 'Start med et tomt rutenett og fyll inn symbolene selv.'),
          h('button', {
            onclick: async () => {
              let cols = pattern.cols;
              if (!cols) {
                const input = h('input', { type: 'number', min: 1, max: 300, value: 20 });
                if (!(await dialog('Antall masker', input, [{ label: 'Avbryt', value: false }, { label: 'OK', value: true, primary: true }]))) return;
                cols = parseInt(input.value, 10) || 20;
              }
              chart = emptyChart(pattern.rows, cols);
              selected = chart.symbols[0].key;
              dirty = true;
              draw();
            },
          }, 'Tomt rutenett')));
      return;
    }

    const map = symbolMap(chart);
    const palette = h('div', { class: 'palette', role: 'radiogroup', 'aria-label': 'Velg symbol' },
      chart.symbols.map((s) => h('button', {
        class: 'pal' + (s.key === selected ? ' on' : ''), role: 'radio', 'aria-checked': String(s.key === selected),
        onclick: () => { selected = s.key; draw(); },
      }, h('span', { class: 'sw', style: { background: s.color || '#fff' } }, s.glyph || ''), h('span', { class: 'pm' }, s.meaning || s.key))),
      h('button', { class: 'pal', onclick: editSymbols }, '✎ Symboler'));

    const notes = [
      chart.notes ? h('div', { class: 'banner warn' }, '🤖 ', chart.notes) : null,
      chart.missingRows && chart.missingRows.length
        ? h('div', { class: 'banner warn' }, `Rad ${chart.missingRows.map(rowNo).join(', ')} manglet i svaret og er fylt med «${(map[chart.symbols[0].key] || {}).meaning || 'tomme ruter'}».`)
        : null,
    ];

    const modeSeg = h('div', { class: 'segmented', style: { marginBottom: '10px' } },
      [['diagram', 'Diagram'], ['over', 'Over bildet'], ['photo', 'Bildet']].map(([v, l]) =>
        h('button', { class: mode === v ? 'on' : '', onclick: () => { mode = v; draw(); } }, l)));

    const stage = mode === 'photo'
      ? h('img', { src: objUrl(pattern.imageBlob), alt: 'Originalbildet', style: { width: '100%', display: 'block' } })
      : gridEl();

    body.replaceChildren(
      ...notes.filter(Boolean),
      modeSeg,
      h('div', { class: 'cgrid-wrap' },
        h('div', { class: 'pv-zoom' },
          h('button', { 'aria-label': 'Mindre ruter', onclick: () => { cellPx = Math.max(10, Math.round(cellPx / 1.25)); draw(); } }, '−'),
          h('button', { 'aria-label': 'Større ruter', onclick: () => { cellPx = Math.min(80, Math.round(cellPx * 1.25)); draw(); } }, '+')),
        stage),
      h('p', { class: 'muted small' }, 'Velg et symbol og trykk på rutene som skal endres.'),
      palette,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'small', disabled: !undoStack.length, onclick: () => { chart = undoStack.pop(); draw(); } }, '↶ Angre'),
        h('button', { class: 'small', onclick: editSize }, 'Rader/masker'),
        h('button', { class: 'small', onclick: editRepeat }, 'Rapport'),
        hasKey ? h('button', {
          class: 'small', onclick: async () => {
            if (await confirmDlg('Tolke på nytt?', 'Diagrammet erstattes med en ny tolkning. Du kan angre etterpå.', 'Tolk på nytt')) runAI();
          },
        }, '✨ Tolk på nytt') : null),
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { class: 'primary grow', onclick: save }, 'Lagre diagram'),
        pattern.chart ? h('button', { class: 'danger', onclick: removeChart }, 'Slett diagram') : null));
  }

  async function save() {
    if (!chart) return;
    const p = await db.get('patterns', pattern.id);
    const { notes, missingRows, ...clean } = chart;
    p.chart = { ...clean, notes: notes || '' };
    if (p.rows !== chart.rows) { p.rows = chart.rows; p.rowLines = null; }
    p.updatedAt = Date.now();
    await db.put('patterns', p);
    try { localStorage.setItem('sg-mode-' + p.id, 'chart'); } catch { /* ignorer */ }
    dirty = false;
    toast('Diagrammet er lagret');
    navigate(`#/monster/${p.id}`, { replace: true });
  }

  async function removeChart() {
    if (!(await confirmDlg('Slette diagrammet?', 'Det digitale diagrammet slettes. Bildet av mønsteret beholdes.', 'Slett', true))) return;
    const p = await db.get('patterns', pattern.id);
    delete p.chart;
    await db.put('patterns', p);
    navigate(`#/monster/${p.id}`, { replace: true });
  }

  draw();
  const back = h('button', {
    class: 'back', 'aria-label': 'Tilbake',
    onclick: async () => {
      if (dirty && !(await confirmDlg('Forkaste endringer?', 'Diagrammet er ikke lagret.', 'Forkast', true))) return;
      navigate(`#/monster/${pattern.id}`);
    },
  }, '‹');
  const bar = topbar('Digitalt diagram', { actions: [h('button', { class: 'primary small', onclick: () => save() }, 'Lagre')] });
  bar.prepend(back);
  return h('div', null, bar, body);
}
