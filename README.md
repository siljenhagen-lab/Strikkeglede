# Strikkeglede ☀️🧶

En app for deg som strikker. Den installeres fra nettleseren (PWA) og virker uten nett, f.eks. på flyet.

**Adresse:** https://siljenhagen-lab.github.io/Strikkeglede/

## Funksjoner

- **Prosjekter**: det du strikker nå (aktive øverst) og prosjekter på vent.
- **Oppskrifter**: oppskriftsbanken din som tabell med navn, størrelse (store bokstaver), pinner og rundpinner, og status. Hver oppskrift kan ha PDF, bilder, tekst og/eller bare mønster.
- **Automatisk rutenett**: appen finner rutene i bildet av diagrammet, retter opp skjeve bilder og teller rader og masker, slik at radlinjene treffer.
- **Tegnforklaring**: velg et utsnitt av bildet (eller et eget bilde) og/eller skriv forklaringen. Den vises over mønsteret mens du strikker.
- **Mønster med radteller**: trykk på en rad for å hake den av. Ferdige rader blir gjennomsiktig grønne, så du ser mønsteret bak. Mønstre som repeteres får en kolonne som teller hvor mange ganger du har strikket dem, og «Ny runde» blanker ut radene. Skjermen holdes våken.
- **Strikk på nytt**: starter et nytt aktivt prosjekt; de gamle ligger i historikken med 1–3 bilder av resultatet og en kommentar.
- **Pinner**: oversikt over alle pinnestørrelser, pinner/rundpinner, T (tre) og M (metall).
- **Mer**: om appen, eksport/import av alle data (bytte av enhet) og hvordan appen installeres.

Alle data lagres lokalt på enheten (IndexedDB). Ingenting sendes til noen server.

## Publisering (GitHub Pages)

1. Slå sammen endringene til `main`.
2. I repoet: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, velg `main` og `/ (root)`.
3. Appen ligger da på `https://siljenhagen-lab.github.io/Strikkeglede/`.

Manifestet har `id`, `start_url` og `scope` satt til `/Strikkeglede/`, og service workeren og cachen er avgrenset til denne stien, så telefonen skiller appen fra andre repoer på samme domene.

## Oppdatere appen

Ingen byggesteg – rene HTML/CSS/JS-filer. Ved endringer: øk `VERSION` i `sw.js` (og `APP_VERSION` i `js/pwa.js`). Brukerne får da beskjed om ny versjon. Nye filer må legges til i `ASSETS` i `sw.js` for å virke offline.

Lokal test: server mappen slik at den ligger under `/Strikkeglede/`, f.eks. med en mappe som inneholder en lenke `Strikkeglede -> repoet` og `python3 -m http.server`.

PDF-visning bruker [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), lagt i `vendor/pdfjs/`.
