# Vodičská časomíra

PWA pro měření času na enduro MTB závodech s intervalovým startem. Funguje **plně offline** (v lese bez signálu) a po návratu na internet se synchronizuje do cloudu (Supabase, druhá fáze).

---

## Rychlý start

Potřebuješ Node.js 18+ a npm.

```bash
npm install         # jednorázově
npm run dev         # spustí dev server na http://localhost:5173
```

Otevři `http://localhost:5173/` v prohlížeči. Na telefonu ve stejné Wi-Fi jde i `http://<ip-noťasu>:5173/`.

Další příkazy:

```bash
npm run build       # produkční build do /dist (ověří i typy přes tsc)
npm run preview     # lokálně naservíruje /dist (PWA test)
npm run typecheck   # jen TypeScript kontrola
```

---

## Jak to používat v praxi

### 1. Vytvoření závodu (`/` Domů)

1. Zadej **název závodu** a datum, klikni **+ Přidat**.
2. Vyber závod v seznamu (zvýrazní se modrým rámečkem).
3. Přidej **úseky (stages)** — pro enduro typicky `SS1`, `SS2`, … Každý úsek má svůj interval startu (default 30 s; můžeš měnit).

### 2. Závodníci (`/racers`)

1. **+ Přidat** → zadej startovní číslo, jméno, kategorii, klub.
2. Závodníky můžeš i zpětně upravovat nebo mazat (soft-delete — data se zachovají pro sync).
3. Checkbox **DNS** skryje závodníka ze startovky.

### 3. Start (`/start`) — plánovaný intervalový start

Flow je **plánovací**, ne „klikací":

1. **Nastav první start** a interval (tlačítko `nastavit` v horní kartě úseku). Např. první start `10:00:00`, interval `30 s`.
2. **Přidej závodníky** do startovky:
   - Dropdown → **+ Přidat jednoho** (zařadí na další slot).
   - Nebo **+ Přidat všechny** (vygeneruje startovku ze všech závodníků v pořadí bibu).
3. Každý závodník dostane automaticky **plánovaný čas** = `první start + pozice × interval`.
4. Karta **„Na řadě"** ukazuje dalšího závodníka + **odpočet**. Když hodiny projdou plánovaný čas, status se automaticky přepne na *odstartoval* (actual_start = scheduled_start). Pokud operátor chce startovat dřív, má tlačítko **Start teď**.
5. V seznamu startovky jde závodníky **posouvat šipkami ↑↓** (jen pending), označit **DNS**, **DNF**, nebo **úplně odebrat** (pořadí pod tím se stáhne nahoru a časy se přepočtou).
6. Sekce **Nouzový start (mimo plán)** dole: okamžitý start zadaným číslem s actual_start = teď (např. pro závodníka, který přijel pozdě). Funguje i pro neexistující čísla — přiřadíš později.

⚠ Změna *prvního startu* nebo *intervalu* přepočte plánované časy všem `pending` závodníkům.

### 4. Cíl (`/finish`)

Dva módy vedle sebe:

- **TAP** — obrovské zelené tlačítko **DOJEL**. Uloží čas s milisekundovou přesností *bez čísla*. Dobré když nestíháš číslo přečíst — přiřadíš později.
- **Číselný** — zadej bib, volitelně ruční čas (`HH:MM:SS.xx`; prázdné = teď), klikni **Uložit cíl**.

V seznamu posledních 20 cílů můžeš **přiřadit číslo** zpětně nebo záznam smazat. Nahoře vidíš počet závodníků, kteří jsou na trati (odstartovali, ale ještě nedojeli).

### 5. Výsledky (`/results`)

- Tabulka **per úsek + celkem** seřazená podle součtu časů. Neúplné výsledky jsou pod kompletními.
- Filtr **kategorie**.
- **Export CSV** (UTF-8 s BOM — otevřeš v Excelu i Google Sheets).
- Pokud existují **konflikty** (dva cíle pro stejného závodníka na stejném úseku, typicky z dvou zařízení), ukáže se oranžovo-červená sekce — vyber správný čas, ostatní smaž.
- **Nezařazené záznamy** (starty/cíle bez závodníka) jde přiřadit přímo v této sekci.

---

## Architektura

Offline-first PWA. Každé zařízení je plnohodnotný klient:

```
┌─ React UI (Vite + TS + Tailwind) ──┐
│   pages/ components/               │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────┐    ┌────────────────────┐
│  Dexie (IndexedDB)  │───▶│  Outbox queue      │
│  lokální zdroj pravdy│    │  (každá mutace)    │
└──────────┬──────────┘    └─────────┬──────────┘
           │                          │  [Iterace 2]
           │                 ┌────────▼─────────┐
           │                 │  Supabase sync   │
           └─── realtime ────┤  (Postgres +     │
                             │   realtime)      │
                             └──────────────────┘
```

**Klíčové vlastnosti:**

- **UUIDv7** jako primární klíče (generované klientem, offline-safe, časově řazené).
- **Soft delete** (`deleted_at`) — sync-safe mazání.
- **`device_id`** na každém zápisu — audit trail, rozlišení paralelních cílových kliků z různých zařízení.
- **Outbox queue** v Dexie — každá mutace se zapíše i do fronty. Sync worker (Iterace 2) ji bude posílat na Supabase s retry.
- **Nullable `racer_id`** na `StartEntry`/`FinishEntry` — start i cíl umí fungovat nezávisle, merge se dělá zpětně na Results.

### Datový model

```
Event       id, name, date, timestamps
Stage       id, event_id, name, order_index, default_interval_seconds, first_start_at?
Racer       id, event_id, bib_number, name, category, club, dns, …
StartEntry  id, stage_id, racer_id?, bib_guess?, order_index,
            scheduled_start?, actual_start?, status (pending|started|dns|dnf),
            device_id
FinishEntry id, stage_id, racer_id?, bib_guess?, finish_time, device_id, note
```

Všechny mají `created_at` / `updated_at` / `deleted_at`.

### Struktura zdrojáků

```
src/
├── main.tsx              — vstupní bod, StrictMode + device_id init
├── App.tsx               — router + layout
├── index.css             — Tailwind + globální styly
├── db/
│   ├── schema.ts         — Dexie DB + indexy
│   ├── models.ts         — TypeScript typy entit
│   ├── repo.ts           — CRUD funkce (zapisují do Dexie i outboxu)
│   └── outbox.ts         — queue helper
├── sync/
│   └── deviceId.ts       — persistentní UUID zařízení v localStorage
├── store/
│   └── session.ts        — zustand (aktivní event + stage, persist)
├── hooks/
│   ├── useClock.ts       — tikající hodiny
│   └── useOnline.ts      — navigator.onLine
├── components/
│   ├── Nav.tsx           — spodní navigace + online indikátor + počet ve frontě
│   ├── Clock.tsx         — digitální hodiny (3 velikosti)
│   └── BigButton.tsx     — velké tlačítko pro rukavice
├── pages/
│   ├── HomePage.tsx      — výběr závodu + správa stages
│   ├── RacersPage.tsx    — CRUD závodníků
│   ├── StartPage.tsx     — startovní obrazovka
│   ├── FinishPage.tsx    — cílová obrazovka
│   └── ResultsPage.tsx   — výsledky, merge, export
└── utils/
    ├── uuid.ts           — UUIDv7 + nowIso
    ├── time.ts           — format/parse času, HH:MM:SS.xx
    └── results.ts        — výpočty per-stage, total, duplicity
```

---

## Instalace jako PWA

Na Androidu v Chrome: menu `⋮ → Nainstalovat aplikaci`. Na iOS v Safari: `Sdílet → Přidat na plochu`. Po instalaci funguje bez adresního řádku a **offline po prvním načtení**.

⚠ Instalace z lokálního `localhost` vs. Wi-Fi IP: některé prohlížeče odmítnou PWA instalovat mimo `https://` nebo `localhost`. Pro ostrý test z telefonu je nejlepší deploynout build (třeba na Vercel / Netlify) nebo použít `npm run preview -- --host` s tunelem (ngrok).

---

## Stav vývoje

### ✅ Iterace 1 — Offline MVP (hotovo)

- 4 obrazovky (Domů, Závodníci, Start, Cíl, Výsledky)
- Plně offline: IndexedDB + Dexie, soft delete, UUIDv7
- CRUD závodníků a úseků
- Startování (ruční i pořadím), DNF/DNS, ruční posun startu
- Cílování TAP + číselný mód, ruční čas
- Výpočet výsledků per-stage + celkem, filtr kategorie, CSV export
- Merge nezařazených startů/cílů, detekce konfliktů (duplicitní cíle)
- PWA manifest + service worker

### ✅ Iterace 2 — Cloud sync (hotovo)

- `supabase/schema.sql` s tabulkami, indexy, `allow all` RLS, realtime publication, `lww_guard` trigger
- Supabase klient (anon, bez auth pro test mode)
- Push worker: čte `outbox`, batchuje per tabulka, posílá `upsert`, retry s počítadlem pokusů
- Pull: initial bootstrap (select \*) + realtime subscriptions per tabulka, LWW merge do Dexie podle `updated_at`
- UI: stavová lišta v navigaci: *sync vypnutý / stahování / sync / synced / offline / chyba*, klikatelná pro vynucení push, tooltip s časem posledního syncu

### 🎯 Iterace 3 — Polish (nápady)

- Import závodníků z CSV
- Zvukový signál při startu (odpočet 5-4-3-2-1-START)
- Offline-ready PDF export startovky a výsledků
- Přidávání ad-hoc závodníků přímo na startu (bez návratu na Racers)
- Přeházení startovního pořadí drag&drop
- Vícejazyčnost (cs/en)

---

## Vývoj

### TypeScript

Strict mode. `npm run typecheck` musí projít.

### Styling

Tailwind CSS s tmavým tématem (`color-scheme: dark`). Záměrně **velká tlačítka** a **tabular numerals** pro hodiny/časy.

### Testování offline

V Chrome DevTools: **Network → Throttling → Offline**. Ověř, že:

1. CRUD funguje dál (data se ukládají do IndexedDB).
2. Nav ukazuje `● offline`.
3. Po zapnutí sítě (Iterace 2) se fronta vyprázdní.

### Dexie reset (smazání všech dat)

V DevTools konzoli:

```js
indexedDB.deleteDatabase('vodicka'); location.reload();
```

### Supabase — cloud sync setup

Sync mezi zařízeními používá Supabase (Postgres + Realtime). Dokud nejsou env proměnné nastavené, appka běží 100% lokálně — sync je prostě vypnutý a v navigaci to říká *„sync vypnutý"*.

**Krok za krokem (5 minut):**

1. Běž na <https://supabase.com> → *New project*. Pojmenuj ho např. `vodicka`, zvol region (Europe), zvol si heslo pro databázi (stačí jen pro admin, appka ho nepoužívá).
2. Počkej ~1 minutu, než se projekt spustí.
3. V projektu jdi na **SQL Editor** → *New query*. Nakopíruj obsah [`supabase/schema.sql`](supabase/schema.sql), klikni **Run**. Měly by se vytvořit tabulky + policies + realtime publication.
4. V projektu jdi na **Settings → API**. Zkopíruj:
   - `Project URL` → to je `VITE_SUPABASE_URL`
   - `anon` klíč (public) → to je `VITE_SUPABASE_ANON_KEY`
5. V kořeni repa vytvoř `.env` (ručně, nemám na něj permission):

   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
6. Restartuj dev server (`Ctrl+C` a `npm run dev`). Podívej se do navigace dole — mělo by tam být *„stahování…"* → *„● synced"*.

**Jak to funguje:**

- Každá mutace v appce se zapíše do lokální IndexedDB a zároveň do `outbox` fronty.
- Push worker pravidelně (každých ~1,5 s při aktivitě, 10 s keep-alive) odesílá frontu do Supabase jako `upsert`. Po úspěchu smaže z fronty.
- Pull přes Supabase Realtime — jiné zařízení dělá změnu → tvoje dostane WebSocket event → aplikuje do IndexedDB.
- **LWW (last-write-wins)** na úrovni řádku podle `updated_at`. Server má trigger `lww_guard`, který zahazuje starší UPDATE — takže offline zařízení po návratu nepřepíše čerstvější změny.
- Offline detekce: při ztrátě signálu se push pozastaví, fronta roste. Při návratu se fronta automaticky odešle.

**Stav syncu v UI** — spodní lišta, klikatelné:

- `sync vypnutý` — env vars nejsou nastavené
- `stahování…` — initial bootstrap po připojení
- `sync…` — odesílá se fronta nebo se aplikuje něco z realtime
- `● synced` — vše v pořádku
- `● offline` — bez signálu
- `● chyba sync` — HTTP / DB error, detail v tooltip; příští tik zkusí znovu
- `· N ve frontě` — čeká N mutací

**Bezpečnost:** MVP běží v test módu — RLS policies jsou `allow all`, kdokoliv s anon klíčem vidí a mění vše. Anon klíč JE veřejný (klidně ho dej do buildu), ale URL Supabase projektu by neměla být jednoduše zjistitelná. Pro ostrý provoz bychom přidali event kódy / auth.

**Reset databáze:** v Supabase SQL editoru:
```sql
truncate public.finish_entries, public.start_entries, public.racers, public.stages, public.events;
```
Plus v prohlížeči: `indexedDB.deleteDatabase('vodicka'); location.reload();`

---

## Licence

Tento projekt je uvolněn pod **[European Union Public Licence v. 1.2](LICENSE)** (EUPL-1.2) — oficiální volná licence Evropské unie, kompatibilní s GPL, AGPL, MPL a dalšími copyleft licencemi.

V zásadě:
- Můžeš kód **používat, kopírovat, upravovat, distribuovat** (včetně komerčně).
- Musíš **zachovat licenční oznámení** a odkaz na zdrojové kódy.
- Deriváty (upravené verze) se šíří pod stejnou (nebo kompatibilní) licencí.
- Kód jde **bez záruky** — použití na vlastní odpovědnost.

Plný text licence v 23 jazycích (včetně češtiny) najdeš na <https://joinup.ec.europa.eu/collection/eupl>.
