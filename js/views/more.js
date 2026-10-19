import { h, topbar, toast, dialog, pickFiles } from '../ui.js';
import { exportAll, importAll } from '../backup.js';
import { getInstallPrompt, clearInstallPrompt, checkForUpdate, APP_VERSION } from '../pwa.js';
import { rerender } from '../router.js';
import { getApiKey, setApiKey } from '../ai.js';

const APP_URL = new URL('./', location.href).href.replace(/#.*$/, '');

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function fmtBytes(n) {
  if (!n && n !== 0) return '?';
  if (n < 1e6) return Math.round(n / 1e3) + ' kB';
  if (n < 1e9) return (n / 1e6).toFixed(1).replace('.', ',') + ' MB';
  return (n / 1e9).toFixed(2).replace('.', ',') + ' GB';
}

export async function moreView() {
  const plat = platform();
  const apiKey = await getApiKey();
  const keyInput = h('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', value: apiKey });
  const saveKey = async () => {
    const v = keyInput.value.trim();
    if (v && !v.startsWith('sk-ant-')) { toast('Nøkkelen skal starte med «sk-ant-»'); return; }
    await setApiKey(v);
    toast(v ? 'API-nøkkelen er lagret på denne enheten' : 'API-nøkkelen er fjernet');
    rerender();
  };

  /* --- lagring --- */
  const storageInfo = h('p', { class: 'muted small' });
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(async ({ usage }) => {
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      storageInfo.textContent = `Bruker ca. ${fmtBytes(usage)} på denne enheten.` +
        (persisted ? ' Lagringen er beskyttet mot automatisk opprydding.' : '');
    });
  }

  const doExport = async (share) => {
    toast('Lager sikkerhetskopi…');
    const file = await exportAll();
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Strikkeglede – sikkerhetskopi' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Sikkerhetskopien er lastet ned');
  };

  const doImport = async () => {
    const [file] = await pickFiles({ accept: 'application/json,.json' });
    if (!file) return;
    const mode = await dialog('Importer data',
      'Vil du erstatte alt som ligger i appen nå, eller slå sammen med dataene du har?', [
        { label: 'Avbryt', value: null },
        { label: 'Slå sammen', value: 'merge' },
        { label: 'Erstatt alt', value: 'replace', danger: true },
      ]);
    if (!mode) return;
    try {
      toast('Importerer…');
      const c = await importAll(file, mode);
      toast(`Importert: ${c.recipes} oppskrifter, ${c.projects} prosjekter`);
      rerender();
    } catch (e) {
      dialog('Kunne ikke importere', e.message);
    }
  };

  const canShareFiles = !!(navigator.canShare && (() => {
    try { return navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }); } catch { return false; }
  })());

  /* --- installasjon --- */
  const prompt = getInstallPrompt();
  const installBtn = prompt ? h('button', {
    class: 'primary', onclick: async () => {
      prompt.prompt();
      await prompt.userChoice;
      clearInstallPrompt();
      rerender();
    },
  }, '⬇ Installer Strikkeglede') : null;

  const guide = (key, title, steps) => h('details', { class: 'card', open: plat === key },
    h('summary', null, title), h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s))));

  return h('div', null,
    topbar('Mer'),
    h('div', { class: 'content' },
      h('div', { class: 'card' },
        h('div', { class: 'about-logo' }, h('img', { src: 'icons/icon-192.png', alt: '' }),
          h('div', null, h('h3', null, 'Strikkeglede'), h('span', { class: 'muted small' }, `Versjon ${APP_VERSION}`))),
        h('p', null, 'Strikkeglede samler strikkeoppskriftene dine på ett sted. Last inn PDF-en du har kjøpt eller ta bilde av en papiroppskrift, og legg inn mønsteret for å hake av rad for rad – radene blir grønne, men du ser fortsatt mønsteret. Repeterende mønstre telles automatisk.'),
        h('p', null, 'Hold styr på aktive prosjekter, størrelser og pinner, strikk en oppskrift på nytt med full historikk, og ta bilder av det ferdige resultatet med en kommentar til neste gang. Under «Pinner» har du oversikt over pinnene du eier.'),
        h('p', { class: 'muted small' }, 'Alt lagres kun på denne enheten – ingenting sendes til nettet, med unntak av bilder du selv velger å få tolket med AI. Appen virker også uten nett, f.eks. på flyet, og skjermen holdes våken mens du ser på et mønster.')),

      h('h2', null, 'Dine data'),
      h('div', { class: 'card' },
        h('p', null, 'Ta sikkerhetskopi av alle oppskrifter, mønstre, bilder og pinner til én fil. Bruk filen til å flytte dataene til en ny telefon eller nettbrett: åpne Strikkeglede der og velg «Importer».'),
        storageInfo,
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => doExport(false) }, '⬇ Eksporter (last ned)'),
          canShareFiles ? h('button', { onclick: () => doExport(true) }, '↗ Del / lagre i Filer') : null,
          h('button', { onclick: doImport }, '⬆ Importer'))),

      h('h2', null, 'AI-tolkning av diagrammer'),
      h('div', { class: 'card' },
        h('p', null, 'Strikkeglede kan gjøre et bilde av et diagram om til et digitalt diagram du kan redigere. Det bruker Claude fra Anthropic og krever nett og en egen API-nøkkel.'),
        h('ol', { class: 'steps small' },
          h('li', null, 'Lag en konto og en API-nøkkel på ', h('a', { href: 'https://platform.claude.com/settings/keys', target: '_blank', rel: 'noopener' }, 'platform.claude.com'), ' og fyll på litt kreditt.'),
          h('li', null, 'Lim inn nøkkelen her og trykk «Lagre».'),
          h('li', null, 'Åpne et mønster, trykk ✎ og velg «Lag digitalt diagram».')),
        h('p', { class: 'muted small' }, 'En tolkning koster typisk noen få kroner, avhengig av hvor stort diagrammet er. Nøkkelen lagres bare på denne enheten (den blir ikke med i eksporten), og bare bildet av mønsteret og tegnforklaringen sendes til Anthropic.'),
        h('label', { class: 'field' }, h('span', null, apiKey ? 'API-nøkkel (lagret)' : 'API-nøkkel'), keyInput),
        h('div', { class: 'row' },
          h('button', { class: 'primary small', onclick: saveKey }, 'Lagre'),
          apiKey ? h('button', { class: 'small', onclick: () => { keyInput.value = ''; saveKey(); } }, 'Fjern nøkkel') : null)),

      h('h2', null, 'Installer på telefon / nettbrett'),
      isInstalled()
        ? h('div', { class: 'card' }, '✅ Strikkeglede er installert og kjører som app.')
        : h('div', null,
          h('p', { class: 'small' }, 'Åpne denne adressen i nettleseren på enheten:'),
          h('p', null, h('a', { href: APP_URL }, h('strong', null, APP_URL))),
          installBtn ? h('p', null, installBtn) : null,
          guide('ios', 'iPhone og iPad (Safari)', [
            'Åpne adressen over i Safari.',
            'Trykk på Del-knappen (firkant med pil opp).',
            'Bla ned og velg «Legg til på Hjem-skjerm».',
            'Kontroller at navnet er «Strikkeglede» og trykk «Legg til».',
          ]),
          guide('android', 'Android (Chrome)', [
            'Åpne adressen over i Chrome.',
            'Trykk på menyen ⋮ øverst til høyre.',
            'Velg «Installer app» eller «Legg til på startsiden».',
            'Bekreft med «Installer».',
          ]),
          guide('desktop', 'PC og Mac (Chrome / Edge)', [
            'Åpne adressen over.',
            'Klikk på installer-ikonet i adressefeltet, eller velg «Installer Strikkeglede» i menyen.',
          ]),
          h('p', { class: 'muted small' }, 'Appen installeres fra adressen som slutter på /Strikkeglede/, slik at den holdes adskilt fra andre apper på samme nettsted. Etter første åpning fungerer den uten nett.')),

      h('h2', null, 'Oppdateringer'),
      h('div', { class: 'card' },
        h('p', { class: 'small muted' }, 'Appen ser selv etter nye versjoner når du er på nett.'),
        h('button', { class: 'small', onclick: checkForUpdate }, 'Se etter oppdatering'))));
}
