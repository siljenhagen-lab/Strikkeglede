import { h, topbar, objUrl, emptyState, statusBadge } from '../ui.js';
import { loadOverview, needleSummary, progressOf, fmtDate } from '../data.js';

export function recipeThumb({ patterns, current, projects }) {
  const photo = (current && current.photos && current.photos[0]) ||
    projects.map((p) => p.photos && p.photos[0]).find(Boolean);
  const blob = (patterns[0] && patterns[0].imageBlob) || photo;
  return h('div', { class: 'thumb' }, blob ? h('img', { src: objUrl(blob), alt: '' }) : '🧶');
}

export function needleLine(needles) {
  const s = needleSummary(needles);
  return [s.pinne && `Pinne ${s.pinne}`, s.rundpinne && `Rundpinne ${s.rundpinne}`].filter(Boolean).join(' · ');
}

function projectCard(item) {
  const { recipe, current: p, patterns } = item;
  const meta = [p.size && `Str. ${p.size}`, needleLine(p.needles)].filter(Boolean).join(' · ');
  return h('div', { class: 'card link proj-card', onclick: () => { location.hash = `#/prosjekt/${p.id}`; } },
    recipeThumb(item),
    h('div', null,
      h('h3', null, recipe.name, ' ', statusBadge(p.status)),
      h('div', { class: 'meta' }, meta || 'Ingen størrelse eller pinner valgt ennå'),
      h('div', { class: 'meta small' }, `Startet ${fmtDate(p.startedAt)}`),
      patterns.length ? h('div', { class: 'chips' }, patterns.map((pat) => {
        const pr = progressOf(p, pat.id);
        return h('a', {
          class: 'chip pattern', href: `#/monster/${pat.id}?p=${p.id}`,
          onclick: (e) => e.stopPropagation(),
        }, '▦ ', pat.name, ' ', h('strong', null, `${pr.done}/${pat.rows}`), pat.repeat ? ` ↻${pr.repeats}` : '');
      })) : null));
}

export async function projectsView() {
  const items = (await loadOverview()).filter((i) => i.current && i.current.status !== 'ferdig');
  const sortFn = (a, b) => (b.current.updatedAt || b.current.createdAt) - (a.current.updatedAt || a.current.createdAt);
  const active = items.filter((i) => i.current.status === 'aktiv').sort(sortFn);
  const waiting = items.filter((i) => i.current.status === 'vent').sort(sortFn);

  return h('div', null,
    topbar('Mine prosjekter', { actions: [h('a', { class: 'btn primary small', href: '#/ny' }, '+ Ny')] }),
    h('div', { class: 'content' },
      !items.length ? emptyState('☀️', 'Du har ingen prosjekter på pinnene nå. Legg inn en ny oppskrift, eller start et prosjekt fra «Oppskrifter».',
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('a', { class: 'btn primary', href: '#/ny' }, '+ Ny oppskrift'),
          h('a', { class: 'btn', href: '#/oppskrifter' }, 'Mine oppskrifter'))) : null,
      active.length ? [h('h2', null, 'Strikker nå'), active.map(projectCard)] : null,
      waiting.length ? [h('h2', null, 'På vent'), waiting.map(projectCard)] : null,
    ));
}
