// Små hjelpere for DOM, dialoger, varsler og filvalg.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'accept', 'type', 'min', 'max', 'step', 'placeholder', 'href', 'src', 'alt', 'title', 'name', 'id', 'for', 'rows', 'colSpan']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'for') el.htmlFor = v;
      else if (PROPS.has(k) && k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/* ----- Objekt-URL-er ryddes ved hvert visningsbytte ----- */
let urls = [];
export function objUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.push(u);
  return u;
}
export function takeUrls() {
  const old = urls;
  urls = [];
  return old;
}

/* ----- Toppfelt ----- */
export function topbar(title, { back, actions = [] } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'back', 'aria-label': 'Tilbake', onclick: () => goBack(back) }, '‹') : null,
    h('h1', null, title),
    ...actions);
}

export function goBack(fallback) {
  if (history.length > 1 && sessionStorage.getItem('sg-nav')) history.back();
  else location.hash = fallback;
}

/* ----- Varsel ----- */
let toastTimer;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  el.replaceChildren(msg);
  if (action) el.append(h('button', { onclick: () => { el.hidden = true; action.run(); } }, action.label));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 10000 : 2600);
}

/* ----- Dialoger ----- */
/**
 * Viser en modal dialog. buttons: [{label, value, primary, danger}]
 * Løses med valgt verdi, eller null ved avbryt.
 */
export function dialog(title, body, buttons = [{ label: 'OK', value: true, primary: true }], opts = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: opts.class || '' });
    let result = null;
    const close = (v) => { result = v; dlg.close(); };
    if (opts.raw) {
      dlg.append(body);
      dlg.addEventListener('click', () => close(null));
    } else {
      dlg.append(
        h('div', { class: 'dlg-body' }, title ? h('h3', null, title) : null, typeof body === 'string' ? h('p', null, body) : body),
        h('div', { class: 'dlg-actions' }, buttons.map((b) =>
          h('button', {
            class: [b.primary && 'primary', b.danger && 'danger'].filter(Boolean).join(' '),
            onclick: async () => {
              if (b.validate && !(await b.validate())) return;
              close(typeof b.value === 'function' ? b.value() : b.value);
            },
          }, b.label))),
      );
    }
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('cancel', () => { result = null; });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input, textarea, select');
    if (first && !opts.noFocus) first.focus();
  });
}

export function confirmDlg(title, text, okLabel = 'OK', danger = false) {
  return dialog(title, text, [
    { label: 'Avbryt', value: false },
    { label: okLabel, value: true, primary: !danger, danger },
  ]);
}

export function showPhoto(url) {
  return dialog(null, h('img', { src: url, alt: '' }), [], { raw: true, class: 'photo' });
}

/* ----- Filvalg ----- */
export function pickFiles({ accept = '*/*', multiple = false, capture } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    if (capture) input.setAttribute('capture', capture);
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function statusBadge(status) {
  const labels = { aktiv: 'Aktiv', vent: 'På vent', ferdig: 'Ferdig' };
  return h('span', { class: 'badge ' + (status || '') }, labels[status] || 'Ikke startet');
}

export function emptyState(icon, text, ...extra) {
  return h('div', { class: 'empty' }, h('span', { class: 'big' }, icon), h('p', null, text), ...extra);
}
