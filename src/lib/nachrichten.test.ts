/**
 * Die zehn Nachrichten aus dem echten Geschäft, als Prüffälle.
 *
 * Sie standen bisher nur in einer Notizdatei neben dem Projekt. Was hier geprüft
 * wird, ist nicht die KI — die kostet Geld und ist nicht wiederholbar —, sondern
 * die Extraktion ohne sie: was `parseMessage` aus einem Text holt, und vor allem,
 * was es NICHT holen darf. Jede Falle in dieser Datei ist einmal wirklich
 * passiert oder wäre beinahe passiert.
 *
 * Laufen mit: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMessage } from './ads'
import { SEED } from './seed'
import type { DB } from '../types'

const db = SEED as unknown as DB
const read = (s: string) => parseMessage(s, db)

test('N1 · eine Anfrage, drei gleich große Tanks', () => {
  const r = read('Hallo, ist der 1650 Liter Tank noch zu haben?\nGruß, Peter Schmitt\n0176 4433221')
  assert.equal(r.name, 'Peter Schmitt')
  assert.equal(r.phone.replace(/\D/g, ''), '01764433221')
  // Drei Tanks haben 1.650 l. Alle drei sind Kandidaten, keiner ist belegt.
  assert.equal(r.matchedTankIds.length, 3)
  assert.equal(r.exact, false)
  assert.equal(r.offer, null)
})

test('N2 · Anfrage aus der Käuferliste: exakt, und unser Preis ist kein Gebot', () => {
  const r = read(
    'Positionen: F-01–F-31\nPaketpreis: 4200\n(Bitte stehen lassen.)\n— — —\n' +
    'Guten Tag, ich hätte Interesse an allen Fässern für den Hof.\nFamilie Ortlieb\nortlieb@example.de',
  )
  assert.equal(r.exact, true)
  assert.equal(r.matchedTankIds.length, 31)
  assert.equal(r.email, 'ortlieb@example.de')
  assert.equal(r.packagePrice, 4200)
  // Die Falle: 4.200 € ist UNSER Preis. Als Gebot des Käufers wäre er falsch.
  assert.equal(r.offer, null)
})

test('N3 · Gegenangebot ohne Währungszeichen, und der erste Betrag ist unserer', () => {
  const r = read('Hallo Herr Pix, 4.200 sind mir zu viel. Ich biete 3.600 für die 31 Fässer.\nOrtlieb')
  assert.equal(r.offer, 3600)
})

test('N4 · Zusage über eine Bauart, ohne Nummer', () => {
  const r = read('Passt, ich nehme die beiden Rundtanks 3700 l zu Ihrem Preis. Bin Mittwoch da.')
  const litres = r.matchedTankIds.map((id) => db.tanks.find((t) => t.id === id)!.litres)
  assert.deepEqual([...new Set(litres)], [3700])
  // "zu Ihrem Preis" nennt keinen Betrag — es darf keiner geraten werden.
  assert.equal(r.offer, null)
})

test('N5 · Abholung gemeldet, ohne Bezug — nichts daraus buchen', () => {
  const r = read('Geld ist überwiesen, die Fässer habe ich gestern abgeholt. Vielen Dank!')
  assert.equal(r.matchedTankIds.length, 0)
  assert.equal(r.offer, null)
})

test('N7 · reine Frage: kein Kontakt, keine Position', () => {
  const r = read('Haben die Koffertanks einen Kühlmantel? Und wie dick ist das Blech?')
  assert.equal(r.email, '')
  assert.equal(r.offer, null)
})

test('N8 · weitergeleitete Portalmail: Robot-Adresse und Datum sind keine Kontaktdaten', () => {
  const r = read(
    'Von: noreply@kleinanzeigen.de\nGesendet: Montag, 8. September 2026 19:42\nAn: verkauf@pix-el.de\n' +
    'Betreff: Neue Nachricht\n\nSie haben eine neue Nachricht von Markus B.:\n' +
    '"Was wollen Sie für den 3100 l? Ich zahle bar."',
  )
  assert.equal(r.email, '', 'noreply@ darf nie als Käuferadresse durchgehen')
  assert.notEqual(r.phone.replace(/\D/g, ''), '08092026')
  // 3.100 l gibt es genau einmal.
  assert.deepEqual(r.matchedTankIds, ['T-22'])
})

test('N9 · zwei Dinge in einer Nachricht, Betrag ohne Währung', () => {
  const r = read('Die Impellerpumpe nehme ich für 900. Die Exzenterschneckenpumpe ist mir zu teuer.')
  assert.equal(r.offer, 900)
  // Über den Typnamen gefunden, nicht über Liter — die Pumpe hat keine.
  assert.ok(r.matchedTankIds.length > 0, 'die Impellerpumpe muss gefunden werden')
})

test('Positionsnummern im Fließtext werden gelesen', () => {
  const r = read('Ich nehme T-23 und T-24, wann kann ich kommen?')
  assert.deepEqual(r.matchedTankIds.sort(), ['T-23', 'T-24'])
  assert.equal(r.exact, true)
})

test('Eine Literzahl ohne Einheit ist kein Gebot', () => {
  const r = read('Die beiden Rundtanks 3700 hätte ich gern.')
  assert.equal(r.offer, null, 'sonst wären 3.700 l ein Gebot über 3.700 €')
})

test('Eine ganze Warengruppe wird als zu weiter Treffer gemeldet', () => {
  const r = read('Was kosten die 225 l Fässer?')
  assert.equal(r.broadMatch, true)
})

// ------------------------------------------------------------------ Vorgang

import { buildPlan, collapseIds, countCue } from './inbox'

const plan = (s: string) => buildPlan([], parseMessage(s, db), db, s)
const kinds = (s: string) => plan(s).steps.map((p) => p.kind)

test('Vorgang: aus der Käuferliste wird angelegt, angehängt, angeboten', () => {
  const p = plan('Positionen: F-01–F-31\nPaketpreis: 4200\n— — —\nInteresse an allen Fässern.\nortlieb@example.de')
  assert.deepEqual(p.steps.map((x) => x.kind), ['lead.neu', 'positionen', 'angebot'])
  // Die Falle: unser Paketpreis darf kein Gebot werden.
  assert.equal(p.steps.some((x) => x.kind === 'gebot'), false)
})

test('Vorgang: ohne Kontaktweg entsteht kein Schritt, sondern ein Hinweis', () => {
  const p = plan('Von: noreply@kleinanzeigen.de\nBetreff: Neue Nachricht\n\nNachricht von Markus B.:\n"Was wollen Sie für den 3100 l?"')
  assert.deepEqual(p.steps, [], 'ohne Interessent liefe jeder Schritt ins Leere')
  assert.ok(p.notes.length > 0, 'und das muss dastehen')
})

test('Vorgang: ein Gebot ohne Angebot wird zum Hinweis, nicht zum Schritt', () => {
  const p = plan('4.200 sind mir zu viel. Ich biete 3.600 für die Fässer.\nOrtlieb\nortlieb@example.de')
  assert.equal(p.steps.some((x) => x.kind === 'gebot'), false)
  assert.ok(p.notes.some((n) => n.includes('3.600')))
})

test('Vorgang: baugleiche Ware — einer, wenn einer gemeint ist', () => {
  const p = plan('Ist der 1650 Liter Tank noch zu haben?\n0176 4433221')
  const pos = p.steps.find((x) => x.kind === 'positionen')
  assert.equal(pos?.tankIds.length, 1, 'drei gleiche Tanks, gefragt war einer')
})

test('Vorgang: „die beiden“ meint zwei', () => {
  const p = plan('Ich nehme die beiden Rundtanks 3700 l.\n0151 9998887')
  const pos = p.steps.find((x) => x.kind === 'positionen')
  assert.equal(pos?.tankIds.length, 2)
})

test('Vorgang: verschiedene Ware wird nicht geraten', () => {
  const p = plan('Die Impellerpumpe nehme ich, die Exzenterschneckenpumpe ist mir zu teuer.\n0170 1234567')
  assert.equal(p.steps.some((x) => x.kind === 'positionen'), false)
  assert.ok(p.notes.some((n) => n.includes('verschiedene')))
})

test('Vorgang: reservieren und Verkauf sind nie Teil des Zuges', () => {
  for (const s of ['Positionen: T-23–T-24\n— — —\nIch nehme beide.\na@b.de', 'Geld ist da, habe abgeholt.\na@b.de']) {
    assert.equal(kinds(s).some((k) => k === 'reservieren' || k === 'verkauf.vorbereiten'), false)
  }
})

test('Mengenwörter', () => {
  assert.equal(countCue('ich nehme die beiden'), 2)
  assert.equal(countCue('alle Fässer bitte'), Infinity)
  assert.equal(countCue('ist der Tank noch da'), null)
  assert.equal(countCue('drei Stück hätte ich gern'), 3)
})

test('Nummernbereiche werden zusammengefasst', () => {
  assert.equal(collapseIds(['F-01', 'F-02', 'F-03', 'F-07']), 'F-01–F-03, F-07')
  assert.equal(collapseIds(['T-23', 'T-24']), 'T-23, T-24')
  assert.equal(collapseIds([]), '')
})
