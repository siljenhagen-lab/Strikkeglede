import { takeUrls, h } from './ui.js';

const routes = [];
let lastTab = 'prosjekter';
let renderToken = 0;

export function route(pattern, tab, view) {
  routes.push({ pattern, tab, view });
}

export function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/prosjekter';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

export async function render({ keepScroll = false } = {}) {
  const token = ++renderToken;
  const { path, query } = currentPath();
  const match = routes.map((r) => ({ r, m: path.match(r.pattern) })).find((x) => x.m);
  if (!match) { location.replace('#/prosjekter'); return; }
  if (match.r.tab) lastTab = match.r.tab;
  for (const a of document.querySelectorAll('.tabbar a')) a.classList.toggle('on', a.dataset.tab === lastTab);

  const scrollY = window.scrollY;
  const oldUrls = takeUrls();
  let node;
  try {
    node = await match.r.view(match.m, query);
  } catch (err) {
    console.error(err);
    node = h('div', { class: 'content' }, h('div', { class: 'empty' }, h('span', { class: 'big' }, '🧶'),
      h('p', null, 'Noe gikk galt: ' + (err && err.message ? err.message : err)),
      h('a', { class: 'btn', href: '#/prosjekter' }, 'Til forsiden')));
  }
  if (token !== renderToken) return; // en nyere visning tar over
  const view = document.getElementById('view');
  view.replaceChildren(node);
  window.scrollTo(0, keepScroll ? scrollY : 0);
  oldUrls.forEach((u) => URL.revokeObjectURL(u));
}

/** Tegner gjeldende visning på nytt, med samme scroll-posisjon. */
export const rerender = () => render({ keepScroll: true });

export function navigate(hash, { replace = false } = {}) {
  if (replace) { location.replace(hash); return; }
  location.hash = hash;
}

export function startRouter() {
  window.addEventListener('hashchange', () => {
    sessionStorage.setItem('sg-nav', '1');
    render();
  });
  render();
}
