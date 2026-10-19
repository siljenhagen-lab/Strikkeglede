import { h, topbar, objUrl, emptyState, pickFiles, confirmDlg, toast, dialog, showPhoto } from '../ui.js';
import {
  getRecipeBundle, saveProject, startProject, allNeedleSizes, getNeedleInventory, sortNeedles,
  fmtMm, fmtDate, progressOf, NEEDLE_TYPES, STATUS,
} from '../data.js';
import * as db from '../db.js';
import { resizeImage } from '../media.js';
import { rerender, navigate } from '../router.js';

const MAX_PHOTOS = 3;

/* ---------- Pinnevelger (brukes også i skjemaer) ---------- */
export async function needleEditor(initial, onChange) {
  let needles = sortNeedles(initial || []);
  const [sizes, inv] = await Promise.all([allNeedleSizes(), getNeedleInventory()]);
  const owned = (mm, type) => inv[mm] && inv[mm][type] && inv[mm][type].has;

  const chips = h('div', { class: 'chips', style: { marginTop: 0, marginBottom: '8px' } });
  const sizeSel = h('select', { 'aria-label': 'Pinnestørrelse' });
  const typeSel = h('select', { 'aria-label': 'Type pinne' },
    Object.entries(NEEDLE_TYPES).map(([v, l]) => h('option', { value: v }, l)));
  const fillSizes = () => {
    const t = typeSel.value;
    const cur = sizeSel.value;
    sizeSel.replaceChildren(...sizes.map((s) => h('option', { value: s }, `${fmtMm(s)} mm${owned(s, t) ? '  ✓' : ''}`)));
    sizeSel.value = cur || '3.5';
  };
  typeSel.addEventListener('change', fillSizes);
  fillSizes();

  const draw = () => {
    chips.replaceChildren(...needles.map((n, i) => h('span', { class: 'chip' },
      `${NEEDLE_TYPES[n.type]} ${fmtMm(n.mm)} mm`,
      owned(n.mm, n.type) ? null : h('span', { class: 'muted small', title: 'Ikke registrert i pinneoversikten' }, '(mangler?)'),
      h('button', { 'aria-label': 'Fjern', onclick: () => { needles.splice(i, 1); draw(); onChange(needles); } }, '✕'))));
    if (!needles.length) chips.append(h('span', { class: 'muted small' }, 'Ingen pinner valgt'));
  };
  draw();

  return h('div', { style: { marginBottom: '14px' } },
    chips,
    h('div', { class: 'row' },
      h('div', { style: { flex: '1 1 120px' } }, typeSel),
      h('div', { style: { flex: '1 1 100px' } }, sizeSel),
      h('button', {
        onclick: () => {
          const n = { mm: parseFloat(sizeSel.value), type: typeSel.value };
          if (!needles.some((x) => x.mm === n.mm && x.type === n.type)) needles = sortNeedles([...needles, n]);
          draw(); onChange(needles);
        },
      }, '+ Legg til')));
}

/* ---------- Start (nytt) prosjekt ---------- */
export async function startProjectDialog(recipeId, previous) {
  const data = { size: previous ? previous.size : '', needles: previous ? [...previous.needles] : [] };
  const size = h('input', { type: 'text', class: 'upper', value: data.size, placeholder: 'F.eks. M, 6 ÅR' });
  const body = h('div', null,
    h('p', { class: 'muted small' }, previous
      ? 'Et nytt aktivt prosjekt startes med blanke rader. Det forrige prosjektet blir liggende i historikken.'
      : 'Prosjektet blir aktivt og vises øverst.'),
    h('label', { class: 'field' }, h('span', null, 'Størrelse'), size),
    h('div', { class: 'field-label' }, 'Pinner'),
    await needleEditor(data.needles, (n) => { data.needles = n; }));
  const ok = await dialog(previous ? 'Strikk på nytt' : 'Start prosjekt', body, [
    { label: 'Avbryt', value: false },
    { label: 'Start', value: true, primary: true },
  ]);
  if (!ok) return;
  data.size = size.value.trim();

  const { projects } = await getRecipeBundle(recipeId);
  const unfinished = projects.filter((p) => p.status !== 'ferdig');
  if (unfinished.length) {
    const choice = await dialog('Forrige prosjekt', 'Du har et prosjekt av denne oppskriften som ikke er merket ferdig. Hva vil du gjøre med det?', [
      { label: 'Sett på vent', value: 'vent' },
      { label: 'Merk som ferdig', value: 'ferdig', primary: true },
    ]);
    for (const p of unfinished) {
      if (choice) {
        p.status = choice;
        if (choice === 'ferdig') p.finishedAt = Date.now();
        await saveProject(p);
      }
    }
  }
  const p = await startProject(recipeId, data);
  toast('God strikking! ☀️');
  navigate(`#/prosjekt/${p.id}`);
}

/* ---------- Prosjektvisning ---------- */
export async function projectView(m) {
  const project = await db.get('projects', m[1]);
  if (!project) {
    return h('div', null, topbar('Fant ikke', { back: '#/prosjekter' }),
      h('div', { class: 'content' }, emptyState('🔍', 'Prosjektet finnes ikke lenger.')));
  }
  const { recipe, patterns, files } = await getRecipeBundle(project.recipeId);
  const save = () => saveProject(project);

  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Status' },
    Object.entries(STATUS).map(([v, label]) => h('button', {
      class: project.status === v ? 'on' : '', dataset: { v },
      onclick: async () => {
        if (project.status === v) return;
        project.status = v;
        project.finishedAt = v === 'ferdig' ? Date.now() : null;
        await save();
        if (v === 'ferdig') toast('Gratulerer! 🎉 Legg gjerne til bilder og en kommentar.');
        await rerender();
        if (v === 'ferdig') document.getElementById('resultat')?.scrollIntoView({ behavior: 'smooth' });
      },
    }, label)));

  const size = h('input', {
    type: 'text', class: 'upper', value: project.size, placeholder: 'F.eks. M, 6 ÅR, 38/40',
    onchange: async (e) => { project.size = e.target.value.trim().toUpperCase(); e.target.value = project.size; await save(); toast('Lagret'); },
  });

  const needles = await needleEditor(project.needles, async (n) => { project.needles = n; await save(); });

  const patternLinks = patterns.length
    ? h('div', { class: 'pgrid' }, patterns.map((p) => {
      const pr = progressOf(project, p.id);
      return h('a', { href: `#/monster/${p.id}?p=${project.id}` },
        h('img', { src: objUrl(p.imageBlob), alt: '' }),
        h('div', { class: 'cap' }, p.name, h('small', null, `Rad ${pr.done}/${p.rows}${p.repeat ? ` · ↻ ${pr.repeats}` : ''}`)));
    }))
    : h('p', { class: 'muted' }, 'Ingen mønster lagt inn. ', h('a', { href: `#/oppskrift/${recipe.id}/nytt-monster` }, 'Legg til mønster'));

  const photos = h('div', { class: 'photos' },
    (project.photos || []).map((blob, i) => {
      const url = objUrl(blob);
      return h('div', { class: 'ph' },
        h('img', { src: url, alt: `Bilde ${i + 1}`, onclick: () => showPhoto(url) }),
        h('button', {
          'aria-label': 'Fjern bilde',
          onclick: async () => {
            if (!(await confirmDlg('Fjerne bildet?', 'Bildet slettes fra prosjektet.', 'Fjern', true))) return;
            project.photos.splice(i, 1); await save(); rerender();
          },
        }, '✕'));
    }),
    (project.photos || []).length < MAX_PHOTOS ? h('button', {
      class: 'add',
      onclick: async () => {
        const choice = await dialog('Legg til bilde', null, [
          { label: '📷 Ta bilde', value: 'camera', primary: true },
          { label: '🖼️ Velg fra galleri', value: 'pick' },
        ]);
        if (!choice) return;
        const files = await pickFiles(choice === 'camera'
          ? { accept: 'image/*', capture: 'environment' } : { accept: 'image/*', multiple: true });
        project.photos ||= [];
        for (const f of files.slice(0, MAX_PHOTOS - project.photos.length)) {
          project.photos.push(await resizeImage(f, 900, 0.8)); // miniatyrbilde
        }
        if (files.length) { await save(); rerender(); }
      },
    }, h('span', { style: { fontSize: '1.6rem' } }, '+'), 'Bilde') : null);

  const comment = h('textarea', {
    value: project.comment || '', placeholder: 'Hvordan ble det? Garn, endringer, tips til neste gang …',
    onchange: async (e) => { project.comment = e.target.value; await save(); toast('Kommentar lagret'); },
  });

  const remove = async () => {
    if (await confirmDlg('Slette prosjektet?', 'Prosjektet med fremdrift, bilder og kommentar slettes. Oppskriften beholdes.', 'Slett', true)) {
      await db.del('projects', project.id);
      navigate(`#/oppskrift/${recipe.id}`, { replace: true });
    }
  };

  return h('div', null,
    topbar(recipe.name, { back: '#/prosjekter' }),
    h('div', { class: 'content' },
      seg,
      h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
        `Startet ${fmtDate(project.startedAt)}${project.finishedAt ? ' · ferdig ' + fmtDate(project.finishedAt) : ''}`),
      h('h2', null, 'Mønster'),
      patternLinks,
      h('h2', null, 'Størrelse og pinner'),
      h('label', { class: 'field' }, h('span', null, 'Størrelse'), size),
      h('div', { class: 'field-label' }, 'Pinner'),
      needles,
      h('h2', null, 'Oppskrift'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: `#/oppskrift/${recipe.id}` }, '📖 Åpne oppskriften'),
        files.map((f) => h('a', { class: 'btn small', href: `#/fil/${f.id}` }, f.kind === 'pdf' ? '📄 ' : '🖼️ ', f.name))),
      h('h2', { id: 'resultat' }, 'Ferdig resultat'),
      h('div', { class: 'card' },
        h('div', { class: 'field-label' }, `Bilder (maks ${MAX_PHOTOS})`),
        photos,
        h('label', { class: 'field', style: { marginTop: '14px', marginBottom: 0 } }, h('span', null, 'Kommentar'), comment)),
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { onclick: () => startProjectDialog(recipe.id, project) }, '↻ Strikk på nytt'),
        h('span', { class: 'grow' }),
        h('button', { class: 'danger small', onclick: remove }, 'Slett prosjekt'))));
}
