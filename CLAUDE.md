# Arbeitsweise in diesem Projekt

## Multi-agentisch arbeiten

Der Nutzer hat ausdrücklich und dauerhaft angewiesen: **jede Aufgabe multi-agentisch lösen.**
Mehrere Agenten parallel mit unterschiedlichen Rollen, dazu Sub-Agenten, die die Ergebnisse
prüfen, hinterfragen und verbessern.

Bewährtes Muster:
1. **Analyse** — mehrere Rollen prüfen je einen Aspekt parallel, jede Aussage mit Datei:Zeile belegt
2. **Kritik** — je ein Gegenleser prüft eine Analyse am Code nach; er soll widersprechen, nicht zustimmen
3. **Synthese** — ein Agent verdichtet alles zu einem Plan und entscheidet bei Widersprüchen

Umsetzung danach in einem Zug, nicht parallel: mehrere Agenten, die gleichzeitig dieselben
Dateien ändern, erzeugen Konflikte statt Tempo. Nach der Umsetzung wieder mehrere Prüfer
parallel.

## Ausliefern

Nach jeder Änderung selbstständig: committen, pushen, Pull Request eröffnen, mergen, Deploy
auslösen. Ohne Rückfrage — das ist so vereinbart.

## Vor dem Ausliefern

- `npm run typecheck` und `npm run build` müssen sauber sein
- Die geänderte Oberfläche im Browser ansehen, nicht nur die Tests lesen. Mehrere Fehler in
  diesem Projekt waren erst im gerenderten Bild sichtbar (doppelt kodierte Umlaute,
  überlappende Beschriftungen, 29 identische Zeilen zum Ankreuzen).
- Auf doppelt kodierte Umlaute prüfen:
  `grep -rn 'Ã¤\|Ã¶\|Ã¼\|ÃŸ\|â€' src/`

## Daten

Nutzerdaten liegen als `db.json` in einem privaten Repo. `migrate()` in `src/lib/store.ts`
ergänzt beim Laden fehlende Felder — **fügt aber keine neuen Positionen hinzu**. Was dem
Ausgangsbestand später hinzugefügt wird, erreicht bestehende Datenbanken nur über den
sichtbaren Abgleich in den Einstellungen.

## Sprache

Oberfläche, Commit-Nachrichten und Pull Requests auf Deutsch. Kommentare im Code auf Englisch.
