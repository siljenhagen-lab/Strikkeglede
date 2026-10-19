import { h, topbar, toast, dialog } from '../ui.js';
import {
  getNeedleInventory, saveNeedleInventory, allNeedleSizes, getCustomSizes, saveCustomSizes,
  fmtMm, parseMm, NEEDLE_TYPES,
} from '../data.js';
import { rerender } from '../router.js';

export async function needlesView() {
  const [inv, sizes] = await Promise.all([getNeedleInventory(), allNeedleSizes()]);
  const save = () => saveNeedleInventory(inv);
  const slot = (mm, type) => ((inv[mm] ||= {})[type] ||= { has: false, T: false, M: false });

  const cell = (mm, type, tr) => {
    const s = slot(mm, type);
    const wrap = h('div', { class: 'ncell' });
    const draw = () => {
      const box = h('input', {
        type: 'checkbox', checked: s.has, 'aria-label': `${NEEDLE_TYPES[type]} ${fmtMm(mm)} mm`,
        onchange: (e) => { s.has = e.target.checked; if (!s.has) { s.T = false; s.M = false; } save(); draw(); },
      });
      const tm = (k, title) => h('button', {
        class: 'tm' + (s[k] ? ' on' : ''), title, 'aria-pressed': String(s[k]),
        onclick: () => { s[k] = !s[k]; save(); draw(); },
      }, k);
      wrap.replaceChildren(...[box, s.has && tm('T', 'Tre'), s.has && tm('M', 'Metall')].filter(Boolean));
      tr.classList.toggle('owned', Object.values(inv[mm] || {}).some((x) => x.has));
    };
    draw();
    return wrap;
  };

  const rows = sizes.map((mm) => {
    const tr = h('tr');
    tr.append(h('td', { class: 'mm' }, `${fmtMm(mm)} mm`),
      h('td', null, cell(mm, 'pinne', tr)),
      h('td', null, cell(mm, 'rundpinne', tr)));
    return tr;
  });

  const ownedCount = Object.values(inv).reduce((n, t) => n + Object.values(t).filter((x) => x.has).length, 0);

  const addSize = async () => {
    const input = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'F.eks. 1,75' });
    const ok = await dialog('Legg til pinnestørrelse', h('label', { class: 'field' }, h('span', null, 'Størrelse i mm'), input), [
      { label: 'Avbryt', value: false }, { label: 'Legg til', value: true, primary: true },
    ]);
    const mm = parseMm(input.value);
    if (!ok || !(mm > 0 && mm < 100)) return;
    const custom = await getCustomSizes();
    if (!sizes.includes(mm)) { await saveCustomSizes([...custom, mm]); toast(`${fmtMm(mm)} mm lagt til`); }
    rerender();
  };

  return h('div', null,
    topbar('Pinneoversikt'),
    h('div', { class: 'content' },
      h('p', { class: 'muted small' },
        'Huk av pinnene du har. Velg deretter ', h('strong', null, 'T'), ' for trepinner og ', h('strong', null, 'M'),
        ' for metallpinner – har du begge, velger du begge.',
        ownedCount ? ` Du har registrert ${ownedCount} ${ownedCount === 1 ? 'størrelse/type' : 'størrelser/typer'}.` : ''),
      h('table', { class: 'needles' },
        h('thead', null, h('tr', null, h('th', { style: { textAlign: 'left', paddingLeft: '12px' } }, 'Str.'), h('th', null, 'Pinner'), h('th', null, 'Rundpinner'))),
        h('tbody', null, rows)),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'small', onclick: addSize }, '+ Annen størrelse'))));
}
