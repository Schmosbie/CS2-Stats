# CS2 Stats

Meine persönliche CS2-Statistik-Seite mit Daten von [Leetify](https://leetify.com).
Sie aktualisiert sich jeden Montag früh automatisch, zeigt meinen Verlauf und gibt mir Trainingstipps.

**Seite:** https://schmosbie.github.io/CS2-Stats/

## So funktioniert es

```
Jeden Montag (oder per Knopfdruck)
  └─ GitHub Action "Stats aktualisieren"
       ├─ scripts/fetch.mjs holt Profil + Matchverlauf von der Leetify Public API
       ├─ speichert einen Snapshot + neue Matches in data/history.json (Commit ins Repo)
       └─ veröffentlicht die Seite auf GitHub Pages
```

| Datei | Wofür |
|---|---|
| `index.html`, `style.css`, `app.js` | Die Seite selbst (kein Build-Schritt nötig) |
| `data/history.json` | Alle gespeicherten Snapshots und Matches. **Nicht von Hand bearbeiten.** |
| `data/stats.json` | Welche Stats angezeigt werden (Name, Reiter, Format) |
| `data/tips.json` | Die Trainingstipps |
| `scripts/fetch.mjs` | Holt die Daten von Leetify |
| `.github/workflows/update.yml` | Der wöchentliche Zeitplan |

Der API-Key steht **nirgends im Repository**. Er liegt nur als GitHub-Secret `LEETIFY_API_KEY` vor.

## Manuelles Update starten

1. Öffne das Repository auf GitHub und klicke oben auf **Actions**.
2. Klicke links auf **Stats aktualisieren**.
3. Klicke rechts auf **Run workflow** und dann auf den grünen Knopf **Run workflow**.
4. Nach etwa 1 Minute erscheint ein grüner Haken. Lade die Seite neu (am Handy eventuell zweimal).

Bei einem roten X ist der Abruf fehlgeschlagen. Die alte Version der Seite bleibt online, und oben auf der Seite steht der Grund.
- **„API-Key ungültig“**: Erstelle unter https://leetify.com/app/developer einen neuen Key. Dann auf GitHub **Settings → Secrets and variables → Actions → LEETIFY_API_KEY → Update** den neuen Key einfügen.
- **„Profil nicht gefunden“**: Prüfe in Leetify, ob dein Profil öffentlich ist.
- **„Rate-Limit“**: Einfach später noch mal starten.

## Pausiert GitHub den Zeitplan?

GitHub schaltet geplante Actions ab, wenn in einem Repository **60 Tage lang nichts passiert**.
Diese Action speichert bei jedem Lauf einen Commit, auch wenn der Abruf scheitert. Deshalb sollte das nicht passieren.

Falls doch (Mail von GitHub oder die Seite zeigt „Daten älter als 10 Tage“):
**Actions → Stats aktualisieren**. Oben erscheint ein gelber Hinweis mit dem Knopf **Enable workflow**. Danach einmal manuell starten (siehe oben).

## Tipps ergänzen

Öffne `data/tips.json` auf GitHub und klicke auf das Stift-Symbol (✏️ „Edit“).
Jeder Eintrag hat den Namen eines Stats als Schlüssel und eine Liste mit Tipps:

```json
"spray": [
  "Workshop-Map 'Recoil Master – Spray Training': AK- und M4-Spray jeden Tag 5 Minuten.",
  "Mein neuer Tipp steht hier."
],
```

- Die Namen (`spray`, `preaim` …) findest du in `data/stats.json`.
- Die Seite zeigt die ersten 3 Tipps. Wichtige Tipps also nach oben.
- Achte auf Anführungszeichen und Kommas: Nach jedem Tipp außer dem letzten kommt ein Komma.
- Unten auf **Commit changes** klicken. Nach etwa 1 Minute ist die Seite aktualisiert.

## Einen Stat hinzufügen

Die Felder, die die API aktuell liefert, stehen in `data/history.json` unter `"apiFields"`:
- `match_player`: Werte pro Match (Verlauf vom ersten Tag an)
- `profile_stats`, `profile_rating`, `profile_ranks`: aktuelle Leetify-Profilwerte (Verlauf ab dem ersten Snapshot)

Füge in `data/stats.json` unter `"stats"` eine neue Zeile hinzu, zum Beispiel:

```json
"multikills_3k": { "label": "3er-Kills pro Match", "group": "aim", "format": "dec2", "better": "high", "match": "multi3k" },
```

| Feld | Bedeutung |
|---|---|
| Schlüssel (`"multikills_3k"`) | eigener, eindeutiger Name, auch für die Tipps |
| `label` | Anzeigename |
| `group` | Reiter/Bereich: `overview`, `core`, `aim`, `utility`, `teamplay`, `positioning` |
| `format` | `int`, `dec1`, `dec2`, `pct` (Prozent), `ms`, `sec`, `deg` (Grad), `rating` (±) |
| `better` | `high` = höher ist besser, `low` = niedriger ist besser |
| `match` | Feld aus `match_player`. Oder als Anteil: `{ "num": "zähler_feld", "den": "nenner_feld" }` |
| `profile` | Pfad zum Leetify-Profilwert, z. B. `"stats.preaim"` oder `"rating.aim"` |
| `desc` | optionale kurze Erklärung unter dem Titel |

Mit `match` gibt es einen Wochenverlauf aus deinen Matches, und der Stat kann bei den Tipps auftauchen.
Mit nur `profile` entsteht der Verlauf aus den wöchentlichen Snapshots.
Neue Kacheln in der Übersicht trägst du oben in `"overview"` ein.

## Welche Spielmodi zählen?

Wingman (2v2) ist ausgeklammert, weil es Werte wie ADR und K/D verzerrt. Premier und Competitive zählen mit.
Ändern kannst du das in `data/stats.json` unter `"excludeSources"`.

## Wie werden „schwach“ und „gefallen“ berechnet?

- Die Leetify-API liefert **keine Vergleichswerte** (z. B. einen Durchschnitt für deinen Rang). Verglichen wird deshalb mit **deinem eigenen Durchschnitt** über alle gespeicherten Matches.
- **Schwächste Werte**: Wo liegen deine letzten 10 Matches am weitesten unter deinem eigenen Durchschnitt? Gemessen wird das an deiner normalen Schwankung von Match zu Match, damit Werte mit verschiedenen Einheiten vergleichbar sind.
- **Am stärksten gefallen**: letzte 7 Tage im Vergleich zur Woche davor. Gibt es weniger als 2 Matches pro Woche, werden stattdessen die letzten 5 Matches mit den 5 davor verglichen.
- **Veränderung zur Vorwoche** (Pfeile): Match-Werte vergleichen die letzten 7 Tage mit den 7 Tagen davor. Reine Leetify-Profilwerte vergleichen den neuesten Snapshot mit dem Snapshot von vor etwa einer Woche.

## Was die API nicht liefert

- Gesamten Utility-Schaden (nur HE-Schaden, kein Molotov-Schaden)
- Vergleichswerte von Leetify für deinen Rang
- Premier-Rating gibt es nur für die letzten 100 Matches. Ältere Werte bleiben erhalten, weil jeder Snapshot sie speichert.

## Lokal ansehen (optional)

```bash
python3 -m http.server 8000   # dann http://localhost:8000 im Browser öffnen
LEETIFY_API_KEY=dein_key node scripts/fetch.mjs   # Daten lokal abrufen (Node 18+)
```

---
Daten: [Leetify](https://leetify.com) Public API.
