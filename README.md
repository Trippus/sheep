# Bring the Sheep Home (Få fårene hjem)

Et puslespil fra **Trippus Games**. Få foldene forbi hinanden, og få fårene hjem – fra engen og fra køerne ved kanten –
i folden med samme farve. Folde kan skifte farve og være låst. Ingen tidsgrænse, men stjerner for få træk. Spilbeskrivelsen ligger i
`../trippus-studio/stages/01-ide/output/bring-the-sheep-home.md`.

## Kør
```
npm start          # http://localhost:5182 (også over Wi-Fi)
npm run test:all   # unit-tests + e2e i headless Edge
npm run levels     # byg js/levels.js forfra (deterministisk, ca. 15-30 min.)
npm run icons      # tegn app-ikonerne fra tools/icon.html
```

## Opbygning
| Fil | Hvad |
|---|---|
| `js/sheep.js` | Reglerne (ren logik), eksakt løser, hurtig søgning og banebyggeren |
| `js/levels.js` | 120 baner, lavet af `tools/make-levels.mjs`. Rettes aldrig i hånden |
| `js/app.js` | Brugerflade: træk, fortryd, tip, baner, gem/indlæs. `window.__sheep` er debug-hooket |
| `js/audio.js` | Syntetiserede lyde (inkl. "mæh") |
| `js/ads.js` | Fælles reklamelag fra trippus-studio/shared |

## Sådan laves banerne
Banerne bygges ved at spille et spil baglæns: foldene dukker op, hvor de lukker (ved kanten), kører rundt og
lægger deres får tilbage på engen og forrest i køerne. Til sidst bliver der rodet lidt mere i foldene, så de står
i vejen for hinanden. Hver bane løses derefter forlæns for at sikre, at den kan klares, og for at sætte par
(færrest træk = ★★★). Banerne sorteres fra let til svær.

Gemmes i `localStorage` under `sheep.v2`.
