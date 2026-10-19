import { h, topbar, objUrl, emptyState, statusBadge, pickFiles, confirmDlg, toast } from '../ui.js';
import {
  loadOverview, getRecipeBundle, saveRecipe, addFile, deleteRecipe, startProject,
  needleSummary, statusRank, fmtDate, progressOf, STATUS,
} from '../data.js';
import { uid } from '../db.js';
import * as db from '../db.js';
import { resizeImage, isPdf } from '../media.js';
import { rerender, navigate } from '../router.js';
import { needleEditor, startProjectDialog } from './project.js';
import { needleLine } from './projects.js';

/* ================= Liste ================= */
let searchText = '';

export async function recipesView() {
  const items = await loadOverview();
  items.sort((a, b) =>
    statusRank(a.current && a.current.status) - statusRank(b.current && b.current.status) ||
    a.recipe.name.localeCompare(b.recipe.name, 'nb'));

  const tbody = h('tbody');
  const fill = () => {
    const q = searchText.trim().toLowerCase();
    const shown = items.filter((i) => !q || i.recipe.name.toLowerCase().includes(q) ||
      (i.recipe.source || '').toLowerCase().includes(q));
    tbody.replaceChildren(...shown.map(row));
    if (!shown.length) tbody.append(h('tr', null, h('td', { colSpan: 5, class: 'muted' }, 'Ingen treff.')));
  };
  const row = ({ recipe, current }) => {
    const n = needleSummary(current ? current.needles : []);
    return h('tr', {
      class: 'clickable' + (current ? ' is-' + current.status : ''),
      onclick: () => navigate(`#/oppskrift/${recipe.id}`),
    },
      h('td', { class: 'name' }, recipe.name, recipe.source ? h('div', { class: 'muted small' }, recipe.source) : null),
      h('td', { class: 'size' }, current ? current.size : ''),
      h('td', { class: 'needles' }, n.pinne),
      h('td', { class: 'needles' }, n.rundpinne),
      h('td', null, statusBadge(current && current.status)));
  };

  const content = h('div', { class: 'content' });
  if (!items.length) {
    content.append(emptyState('📖', 'Her samles alle oppskriftene dine – en egen oppskriftsbank. Trykk «Ny» for å legge inn den første.',
      h('a', { class: 'btn primary', href: '#/ny' }, '+ Ny oppskrift')));
  } else {
    if (items.length > 5) content.append(h('input', {
        type: 'search', placeholder: 'Søk i oppskrifter…', value: searchText, style: { marginBottom: '12px' },
        oninput: (e) => { searchText = e.target.value; fill(); },
      }));
    content.append(
      h('div', { class: 'table-wrap' }, h('table', { class: 'recipes' },
        h('thead', null, h('tr', null, h('th', null, 'Oppskrift'), h('th', null, 'Str.'),
          h('th', null, 'Pinne'), h('th', null, 'Rundpinne'), h('th', null, 'Status'))),
        tbody)),
      h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Pinnestørrelser i mm. Trykk på en oppskrift for å se mønster, tekst og historikk.'));
    fill();
  }
  return h('div', null,
    topbar('Mine oppskrifter', { actions: [h('a', { class: 'btn primary small', href: '#/ny' }, '+ Ny')] }),
    content);
}

/* ================= Detalj ================= */
export async function addFilesToRecipe(recipeId, files) {
  for (const f of files) {
    if (isPdf(f)) await addFile(recipeId, f, f.name, 'pdf');
    else if (f.type.startsWith('image/')) await addFile(recipeId, await resizeImage(f), f.name || 'Bilde', 'image');
  }
}

export async function recipeView(m) {
  const b = await getRecipeBundle(m[1]);
  if (!b) return notFound();
  const { recipe, files, patterns, projects, current } = b;
  const live = current && current.status !== 'ferdig' ? current : null;

  const addFiles = async (capture) => {
    const picked = await pickFiles(capture
      ? { accept: 'image/*', capture: 'environment' }
      : { accept: 'application/pdf,image/*', multiple: true });
    if (!picked.length) return;
    toast('Lagrer…');
    await addFilesToRecipe(recipe.id, picked);
    toast('Lagt til');
    rerender();
  };

  const projectBox = h('div', { class: 'card' },
    live ? [
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Nåværende prosjekt'), statusBadge(live.status)),
      h('p', { class: 'meta', style: { margin: '6px 0 10px' } },
        [live.size && `Str. ${live.size}`, needleLine(live.needles), `startet ${fmtDate(live.startedAt)}`].filter(Boolean).join(' · ')),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: `#/prosjekt/${live.id}` }, 'Åpne prosjekt'),
        h('button', { onclick: () => startProjectDialog(recipe.id, live) }, '↻ Strikk på nytt')),
    ] : [
      h('p', { class: 'muted' }, projects.length
        ? 'Du har strikket denne før. Vil du strikke den igjen? Det gamle prosjektet blir liggende i historikken.'
        : 'Ikke startet ennå.'),
      h('button', { class: 'primary', onclick: () => startProjectDialog(recipe.id, projects[0]) },
        projects.length ? '↻ Strikk på nytt' : '▶ Start prosjekt'),
    ]);

  const patternSection = [
    h('h2', null, 'Mønster'),
    patterns.length
      ? h('div', { class: 'pgrid' },
        patterns.map((p) => {
          const pr = progressOf(live, p.id);
          return h('a', { href: `#/monster/${p.id}${live ? '?p=' + live.id : ''}` },
            h('img', { src: objUrl(p.imageBlob), alt: '' }),
            h('div', { class: 'cap' }, p.name,
              h('small', null, live ? `Rad ${pr.done}/${p.rows}${p.repeat ? ` · ↻ ${pr.repeats}` : ''}` : `${p.rows} rader${p.repeat ? ' · repeteres' : ''}`)));
        }),
        h('a', { href: `#/oppskrift/${recipe.id}/nytt-monster`, style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '140px', fontWeight: 600, color: 'var(--accent)' } }, '+ Nytt mønster'))
      : h('div', { class: 'card' },
        h('p', { class: 'muted' }, 'Legg inn mønsteret (diagrammet) for å kunne hake av rad for rad. Ta bilde av det, eller velg en side fra PDF-en.'),
        h('a', { class: 'btn primary', href: `#/oppskrift/${recipe.id}/nytt-monster` }, '+ Legg til mønster')),
  ];

  const textSection = [
    h('h2', null, 'Oppskrift'),
    files.length ? h('ul', { class: 'files' }, files.map((f) => h('li', null,
      h('span', { class: 'ico' }, f.kind === 'pdf' ? '📄' : '🖼️'),
      h('a', { class: 'name', href: `#/fil/${f.id}` }, f.name || (f.kind === 'pdf' ? 'PDF' : 'Bilde')),
      h('button', {
        class: 'small ghost', 'aria-label': 'Slett fil',
        onclick: async () => {
          if (await confirmDlg('Slette fil?', `«${f.name}» fjernes fra oppskriften. Mønstre du har laget fra den beholdes.`, 'Slett', true)) {
            await db.del('files', f.id);
            rerender();
          }
        },
      }, '✕')))) : null,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('button', { class: 'small', onclick: () => addFiles(false) }, '+ PDF eller bilde'),
      h('button', { class: 'small', onclick: () => addFiles(true) }, '📷 Ta bilde av oppskrift')),
    recipe.notes
      ? h('div', { class: 'notes' }, recipe.notes)
      : h('p', { class: 'muted small' }, files.length ? '' : 'Ingen oppskriftstekst lagt inn – kun mønster. Du kan legge til PDF, bilder eller skrive tekst under «Rediger».'),
  ];

  const history = projects.length ? [
    h('h2', null, `Historikk (${projects.length})`),
    projects.map((p) => h('div', { class: 'card link', onclick: () => navigate(`#/prosjekt/${p.id}`) },
      h('div', { class: 'history-item' },
        h('div', { class: 'grow' },
          h('div', { class: 'row' }, statusBadge(p.status), h('strong', null, p.size ? `Str. ${p.size}` : 'Uten størrelse')),
          h('div', { class: 'meta' }, needleLine(p.needles)),
          h('div', { class: 'meta small' }, `Startet ${fmtDate(p.startedAt)}${p.finishedAt ? ' · ferdig ' + fmtDate(p.finishedAt) : ''}`),
          p.comment ? h('p', { class: 'small', style: { margin: '6px 0 0', whiteSpace: 'pre-wrap' } }, p.comment) : null),
        p.photos && p.photos.length ? h('div', { class: 'photos' }, p.photos.map((ph) => h('div', { class: 'ph' }, h('img', { src: objUrl(ph), alt: '' })))) : null))),
  ] : null;

  return h('div', null,
    topbar(recipe.name, {
      back: '#/oppskrifter',
      actions: [h('a', { class: 'btn small', href: `#/oppskrift/${recipe.id}/rediger` }, '✎ Rediger')],
    }),
    h('div', { class: 'content' },
      recipe.source ? h('p', { class: 'muted' }, recipe.source) : null,
      projectBox, patternSection, textSection, history));
}

function notFound() {
  return h('div', null, topbar('Fant ikke', { back: '#/oppskrifter' }),
    h('div', { class: 'content' }, emptyState('🔍', 'Denne finnes ikke lenger.')));
}

/* ================= Ny / rediger ================= */
export async function recipeFormView(m) {
  const editing = m && m[1] ? await db.get('recipes', m[1]) : null;
  if (m && m[1] && !editing) return notFound();
  const recipe = editing || { id: uid(), name: '', source: '', notes: '', createdAt: Date.now() };
  const pending = [];
  const project = { size: '', needles: [] };

  const name = h('input', { type: 'text', value: recipe.name, placeholder: 'F.eks. Fana-kofte', required: true });
  const source = h('input', { type: 'text', value: recipe.source || '', placeholder: 'Designer, bok eller nettbutikk (valgfritt)' });
  const notes = h('textarea', { value: recipe.notes || '', placeholder: 'Lim inn eller skriv oppskriftsteksten her, eller egne notater (valgfritt).' });
  const fileList = h('ul', { class: 'files' });
  const drawFiles = () => fileList.replaceChildren(...pending.map((f, i) => h('li', null,
    h('span', { class: 'ico' }, isPdf(f) ? '📄' : '🖼️'), h('span', { class: 'name' }, f.name || 'Bilde'),
    h('button', { class: 'small ghost', onclick: () => { pending.splice(i, 1); drawFiles(); } }, '✕'))));

  const pick = async (capture) => {
    const files = await pickFiles(capture ? { accept: 'image/*', capture: 'environment' } : { accept: 'application/pdf,image/*', multiple: true });
    pending.push(...files);
    drawFiles();
  };

  const startNow = h('input', { type: 'checkbox', checked: true, id: 'startnow' });
  const sizeInput = h('input', { type: 'text', class: 'upper', placeholder: 'F.eks. M, 6 ÅR, 38/40', oninput: (e) => { project.size = e.target.value; } });
  const projectFields = h('div', null,
    h('label', { class: 'field' }, h('span', null, 'Størrelse jeg strikker'), sizeInput),
    h('div', { class: 'field-label' }, 'Pinner'),
    await needleEditor(project.needles, (n) => { project.needles = n; }));
  startNow.addEventListener('change', () => projectFields.classList.toggle('hidden', !startNow.checked));

  const save = async () => {
    if (!name.value.trim()) { name.focus(); toast('Gi oppskriften et navn'); return; }
    recipe.name = name.value.trim();
    recipe.source = source.value.trim();
    recipe.notes = notes.value;
    await saveRecipe(recipe);
    if (pending.length) { toast('Lagrer filer…'); await addFilesToRecipe(recipe.id, pending); }
    if (!editing && startNow.checked) await startProject(recipe.id, project);
    navigate(`#/oppskrift/${recipe.id}`, { replace: true });
  };

  const remove = async () => {
    if (await confirmDlg('Slette oppskriften?', `«${recipe.name}» med alle filer, mønstre, prosjekter og bilder slettes for godt.`, 'Slett', true)) {
      await deleteRecipe(recipe.id);
      toast('Oppskriften er slettet');
      navigate('#/oppskrifter', { replace: true });
    }
  };

  return h('div', null,
    topbar(editing ? 'Rediger oppskrift' : 'Ny oppskrift', {
      back: editing ? `#/oppskrift/${recipe.id}` : '#/oppskrifter',
      actions: [h('button', { class: 'primary small', onclick: save }, 'Lagre')],
    }),
    h('div', { class: 'content' },
      h('label', { class: 'field' }, h('span', null, 'Navn på oppskriften'), name),
      h('label', { class: 'field' }, h('span', null, 'Kilde'), source),
      !editing ? [
        h('h2', null, 'Oppskrift (valgfritt)'),
        h('p', { class: 'muted small' }, 'Last opp PDF-en du har kjøpt, eller ta bilde av papiroppskriften. Vil du bare bruke mønsteret, kan du hoppe over dette og legge til mønsteret etterpå.'),
        fileList,
        h('div', { class: 'row', style: { marginBottom: '14px' } },
          h('button', { onclick: () => pick(false) }, '+ PDF eller bilde'),
          h('button', { onclick: () => pick(true) }, '📷 Ta bilde')),
      ] : null,
      h('label', { class: 'field' }, h('span', null, 'Tekst / notater'), notes),
      !editing ? [
        h('h2', null, 'Prosjekt'),
        h('label', { class: 'check', for: 'startnow' }, startNow, 'Jeg begynner å strikke denne nå (aktivt prosjekt)'),
        projectFields,
      ] : null,
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { class: 'primary grow', onclick: save }, editing ? 'Lagre endringer' : 'Lagre oppskrift'),
        editing ? h('button', { class: 'danger', onclick: remove }, 'Slett oppskrift') : null),
      !editing ? h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Etter lagring kan du legge til mønster med radteller.') : null,
    ));
}

