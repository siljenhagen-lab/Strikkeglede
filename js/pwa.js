// Installasjon og oppdatering av appen (service worker).
import { toast } from './ui.js';

export const APP_VERSION = '1.1.0';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => { installPrompt = null; });
export const getInstallPrompt = () => installPrompt;
export const clearInstallPrompt = () => { installPrompt = null; };

let registration = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service worker kunne ikke registreres', e);
    return;
  }
  const offer = (worker) => toast('Ny versjon av Strikkeglede er klar.', {
    label: 'Oppdater', run: () => worker.postMessage('skipWaiting'),
  });
  if (registration.waiting && hadController) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  // Be nettleseren om ikke å rydde bort dataene våre ved lite lagringsplass.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

export async function checkForUpdate() {
  if (!registration) { toast('Oppdatering er ikke tilgjengelig her'); return; }
  if (!navigator.onLine) { toast('Du er ikke på nett nå'); return; }
  await registration.update();
  if (!registration.installing && !registration.waiting) toast('Du har nyeste versjon ☀️');
}
