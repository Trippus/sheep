# Bring the Sheep Home (Få fårene hjem)

Et roligt puslespil fra **Trippus Games**. Træk foldene hen over fårene i samme farve, til alle får er hjemme.
Der er ingen tidsgrænse og ingen blindgyder. Spilbeskrivelsen ligger i
`../trippus-studio/stages/01-ide/output/bring-the-sheep-home.md`.

## Kør
```
npm start          # http://localhost:5182 (også over Wi-Fi)
npm run test:all   # unit-tests + e2e i headless Edge
npm run levels     # byg js/levels.js forfra (deterministisk, ca. 1½ min.)
npm run icons      # tegn app-ikonerne fra tools/icon.html
```

## Opbygning
| Fil | Hvad |
|---|---|
| `js/sheep.js` | Reglerne (ren logik), løseren og banebyggeren |
| `js/levels.js` | 120 baner, lavet af `tools/make-levels.mjs`. Rettes aldrig i hånden |
| `js/app.js` | Brugerflade: træk, fortryd, tip, baner, gem/indlæs. `window.__sheep` er debug-hooket |
| `js/audio.js` | Syntetiserede lyde (inkl. "mæh") |
| `js/ads.js` | Fælles reklamelag fra trippus-studio/shared |

## Sådan laves banerne
Banerne bygges baglæns fra et spillet spil, så de altid kan løses: foldene placeres, et tilfældigt spil
spilles, og fårene lægges kun på felter, som deres egen fold nåede først. Felter, ingen fold rørte,
bliver til hække. Derefter måles sværhedsgraden: antal folde, får, rækkefølge-afhængigheder og (når
løseren kan nå det) det mindste antal træk. Banerne sorteres fra let til svær.

Gemmes i `localStorage` under `sheep.v1`.
