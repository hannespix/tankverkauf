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
import { amountInText } from './ai'
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

// ------------------------------- Befunde der Gegenleser, damit sie bleiben

test('Eine Zahl neben einem Zahlungswort ist noch kein Gebot', () => {
  // Alle sieben sind einmal wirklich als Gebot gebucht worden.
  const keins = [
    'Ich nehme T-23 und T-24, ich zahle bar: 0176 4433221',
    'Ich nehme beide, meine PLZ ist 67435',
    'Ich kaufe alles. Abholung nach 55232 Alzey.',
    'Wir brauchen die Tanks für 2027.',
    'Ich nehme ihn, Abholung um 1400.',
    'Ich nehme die beiden Rundtanks 3700.',
    'Ich nehme den 1650er.',
    'Ich nehme 12 Fässer.',
  ]
  for (const s of keins) assert.equal(read(s).offer, null, s)
})

test('Ein Gebot wird auch ohne Verb davor erkannt', () => {
  for (const s of ['3.600 EUR biete ich Ihnen.', 'Ich würde 3.600 EUR bezahlen.', 'Mehr als 3.600 EUR kann ich nicht zahlen.', 'Wären 3.600 € möglich?']) {
    assert.equal(read(s).offer, 3600, s)
  }
})

test('Gesucht wird auch über den Hersteller', () => {
  assert.ok(read('Was soll die Schneider-Pumpe kosten?').matchedTankIds.length >= 2)
  assert.equal(read('Die beiden Clemens hätte ich gern.').matchedTankIds.length, 2)
})

test('Ein Teilwort zieht nicht die halbe Halle mit', () => {
  // „barrique“ steckt auch in „Barriquefass-Reiniger“ — das hat 29 Fässer mitgezogen.
  const r = read('Was soll der Barriquefass-Reiniger kosten?')
  assert.equal(r.matchedTankIds.length, 1)
  // Umgekehrt muss der Plural den Stamm finden.
  assert.ok(read('Was kosten die Dekofässer?').matchedTankIds.length > 20)
})

test('Vorgang: was nicht mehr frei ist, wird nicht angehängt', () => {
  const belegt: DB = JSON.parse(JSON.stringify(SEED))
  belegt.tanks.find((t) => t.id === 'T-23')!.leadId = 'L-fremd'
  belegt.tanks.find((t) => t.id === 'T-23')!.status = 'kontakt'
  belegt.tanks.find((t) => t.id === 'T-24')!.status = 'reserviert'
  const s = 'Positionen: T-23–T-24\n— — —\nIch nehme beide.\nneu@example.de'
  const p = buildPlan([], parseMessage(s, belegt), belegt, s)
  assert.equal(p.steps.some((x) => x.kind === 'positionen'), false, 'nichts davon ist frei')
  assert.ok(p.notes.some((n) => n.includes('T-23')), 'und das muss dastehen')
})

/** Ein Interessent und ein Angebot, ohne jedes Feld von Hand zu tippen. */
function mitAngebot(ids: string[], askPrice: number, id = 'L-1'): DB {
  const d: DB = JSON.parse(JSON.stringify(SEED))
  d.leads.push({
    id, name: 'Ortlieb', phone: '', email: `${id.toLowerCase()}@example.de`, location: '',
    source: 'kleinanzeigen', stage: 'angebot', tankIds: ids, budget: null,
    lastContact: '2026-08-01', nextFollowUp: null, note: '', createdAt: '', updatedAt: '',
  })
  d.quotes.push({
    id: `Q-${id}`, label: 'Anfrage', leadId: id, portalId: null, tankIds: ids, askPrice,
    buyerOffer: null, status: 'gesendet', validUntil: null, note: '', createdAt: '', updatedAt: '',
  })
  return d
}

test('Vorgang: kein zweites Angebot neben einem offenen', () => {
  const mit = mitAngebot(['F-01'], 175)
  const s = '4.200 sind mir zu viel. Ich biete 3.600 EUR.\nl-1@example.de'
  const p = buildPlan([], parseMessage(s, mit), mit, s)
  assert.equal(p.steps.filter((x) => x.kind === 'angebot').length, 0)
  const gebot = p.steps.find((x) => x.kind === 'gebot')
  assert.ok(gebot, 'das Gebot gehört an das bestehende Angebot')
  assert.equal(gebot!.leadId, 'L-1')
})

test('Vorgang: ein Gebot unter der Untergrenze wird gemeldet', () => {
  const ids = (SEED.tanks as DB['tanks']).filter((t) => t.category === 'fass').map((t) => t.id)
  const mit = mitAngebot(ids, 4200, 'L-2')
  const floor = mit.tanks.filter((t) => ids.includes(t.id)).reduce((a, t) => a + t.floor, 0)
  const s = `Ich biete ${floor - 500} EUR für alles.\nl-2@example.de`
  const gebot = buildPlan([], parseMessage(s, mit), mit, s).steps.find((x) => x.kind === 'gebot')
  assert.ok(gebot, 'das Gebot muss als Schritt entstehen')
  assert.ok(gebot!.warning?.includes('Untergrenze'), 'und die Warnung muss dastehen, bevor jemand zusagt')
})

test('Mengenwörter: Zeitangaben und „komplett“ sind keine Mengen', () => {
  assert.equal(countCue('Ist der 1650 Liter Tank komplett dicht?'), null)
  assert.equal(countCue('Ich melde mich in zwei Wochen'), null)
  assert.equal(countCue('dreißig Fässer'), null)
  assert.equal(countCue('drei Fässer und zwei Tanks'), 3, 'das zuerst genannte Wort gilt')
})

test('Vorgang: dieselbe Nachricht zweimal verdoppelt nichts', () => {
  const d: DB = JSON.parse(JSON.stringify(SEED))
  const s = 'Positionen: T-23–T-24\n— — —\nIch nehme beide, biete 3.900 EUR.\nk@example.de'
  // Zustand nach dem ersten Lauf von Hand nachstellen
  d.leads.push({
    id: 'L-9', name: 'K', phone: '', email: 'k@example.de', location: '', source: 'kleinanzeigen',
    stage: 'angebot', tankIds: ['T-23', 'T-24'], budget: null, lastContact: null, nextFollowUp: null,
    note: '', createdAt: '', updatedAt: '',
  })
  for (const id of ['T-23', 'T-24']) {
    const t = d.tanks.find((x) => x.id === id)!
    t.status = 'kontakt'
    t.leadId = 'L-9'
  }
  d.quotes.push({
    id: 'Q-9', label: 'Anfrage K', leadId: 'L-9', portalId: null, tankIds: ['T-23', 'T-24'],
    askPrice: 4200, buyerOffer: 3900, status: 'gesendet', validUntil: null, note: '', createdAt: '', updatedAt: '',
  })
  const p = buildPlan([], parseMessage(s, d), d, s)
  assert.equal(p.steps.some((x) => x.kind === 'angebot'), false, 'kein zweites Angebot')
  assert.equal(p.steps.some((x) => x.kind === 'positionen'), false, 'hängt schon bei ihm')
  assert.equal(p.notes.length, 0, 'und keine Meldung über die eigene Ware')
})

test('Vorgang: ein angenommenes Angebot ist erledigt', () => {
  const d = mitAngebot(['F-01'], 175, 'L-3')
  d.quotes.find((q) => q.id === 'Q-L-3')!.status = 'angenommen'
  const s = 'Hätten Sie noch etwas Passendes?\nl-3@example.de'
  const p = buildPlan([], parseMessage(s, d), d, s)
  // Kein Gebot an ein abgeschlossenes Geschäft, und das Angebot zählt nicht mehr als offen.
  assert.equal(p.steps.some((x) => x.kind === 'gebot'), false)
})

test('N31 · Abholung und Ort fallen nicht durch', () => {
  const r = read('Ich nehme T-23. Abholung könnte ich Freitag machen.\nGruß, Martin Weber\n55232 Alzey')
  // Kein Datum geraten — der Satz selbst ist die Information.
  assert.equal(r.pickupHints.length, 1)
  assert.match(r.pickupHints[0], /Abholung könnte ich Freitag machen/)
  assert.equal(r.place, '55232 Alzey')
})

test('N32 · kein Abholsatz, keine erfundene Notiz', () => {
  const r = read('Ist der 1650er noch zu haben?\nGruß, Peter Schmitt\n0176 4433221')
  assert.deepEqual(r.pickupHints, [])
  assert.equal(r.place, '')
})

test('N33 · eine Preisliste ist kein Gebot', () => {
  // Wallhäuser, echter Fall: er zitiert unsere Listenpreise für T-14 bis T-19
  // zurück, zusammen 5.400 €. Gebucht wurde daraus „Gebot 1.050 €" — nicht weil
  // die Zahl etwas bedeutet, sondern weil sie unten steht. Stünde die Liste
  // andersherum, hieße es 650 €.
  const r = read('1 x 800 l für 650 €\n1 x 1.000 l für 750 €\n1 x 1.250 l für 850 €\n3 x 1.650 l für je 1.050 €')
  assert.equal(r.offer, null)
  assert.equal(r.priceList, true)
  // Verschwiegen wird nichts: die Beträge stehen weiter zur Verfügung.
  assert.deepEqual(r.amounts, [650, 750, 850, 1050])
})

test('N34 · in einer Verhandlung gilt weiter der letzte Betrag', () => {
  // Der Fall, für den die „letzter Treffer"-Regel einmal gebaut wurde — und der
  // seither nie geprüft war. Ein Satz, eine Zeile: das ist keine Preisliste.
  assert.equal(read('4.200 EUR sind mir zu viel. Ich biete 3.600 EUR.').offer, 3600)
  assert.equal(read('Ich biete 3.600 EUR für die Fässer.').offer, 3600)
  // Und eine Zusage zum Listenpreis bleibt ein Gebot.
  assert.equal(read('Einverstanden, ich zahle die 1.050 € für den Koffertank.').offer, 1050)
})

test('N35 · ein Nachname in Versalien mit Umlaut zerbricht nicht', () => {
  // `[\wäöüß-]` kannte keine großen Umlaute: „MÜLLER" traf gar nicht,
  // „SCHRÖDER" wurde zu „SCHR", „WALLHÄUSER" zu „WALLH".
  assert.equal(read('Ist der noch da?\nViele Grüße HANS MÜLLER').name, 'HANS MÜLLER')
  assert.equal(read('Ist der noch da?\nGruß, Jürgen Schröder').name, 'Jürgen Schröder')
})

test('N36 · die Grußformel reicht nicht in den Briefkopf', () => {
  // Über `[,\s]+` griff die Regel über die Leerzeile hinweg und nahm die erste
  // Zeile des Briefkopfs — ein Naturschutz-Siegel — als Absendernamen.
  const r = read('Ich hätte Interesse.\n\nMit freundlichen Grüßen\n\nPartnerbetrieb Naturschutz\n\nWINZERHOF WALLHÄUSER')
  assert.notEqual(r.name, 'Partnerbetrieb Naturschutz')
})

test('N37 · echte Geschäftsmail von der Nahe', () => {
  // Die Mail, an der das Werkzeug vorgeführt wurde. Zwei Fallen darin:
  // „Viele Grüße von der Nahe" — unter dem i-Flag faltet JavaScript auch
  // `\p{Lu}`, die Klasse trifft dann jeden Buchstaben, und „von der Nahe" wurde
  // zum Absendernamen. Und: der Kopfblock einer weitergeleiteten Mail wird
  // abgeschnitten, hier stand dort aber der Käufer selbst.
  const r = read([
    '---------- Weitergeleitete Nachricht ----------',
    'Von: weingut-wallhaeuser@web.de',
    'Datum: 22. Aug. 2026, 14:25 +0200',
    'An: info@weingut-pix.de',
    'Betreff: Weintanks',
    '',
    'Hallo Frau Pix,',
    '',
    'ich hätte unter Umständen Interesse an den Stapeltanks von Möschle in der Bildmitte.',
    '1 × 800 l – 650 € VB',
    '1 × 1.000 l – 750 € VB',
    '1 × 1.250 l – 850 € VB',
    '3 × 1.650 l – je 1.050 € VB',
    '',
    'Viele Grüße von der Nahe',
    'Alexander Wallhäuser',
  ].join('\n'))
  assert.equal(r.name, 'Alexander Wallhäuser')
  assert.equal(r.email, 'weingut-wallhaeuser@web.de')
  // Vier Preise auf vier Zeilen: eine Preisliste, kein Gebot.
  assert.equal(r.offer, null)
  assert.equal(r.priceList, true)
})

test('N38 · eine Roboteradresse im Kopf bleibt draußen', () => {
  // Die Ausnahme zu N37: bei einer Portalmail gehört der Kopf dem Roboter.
  const r = read([
    '---------- Weitergeleitete Nachricht ----------',
    'Von: noreply@kleinanzeigen.de',
    'An: info@weingut-pix.de',
    '',
    'Ist der 1650er noch da?',
    'Gruß, Peter Schmitt',
  ].join('\n'))
  assert.equal(r.email, '')
  assert.equal(r.name, 'Peter Schmitt')
})

test('N39 · ein Stückpreis mit Multiplikator ist kein Gebot', () => {
  // „3 × 1.650 l – je 1.050 € VB": ein Betrag, aber drei Stück gemeint. Als
  // Gebot gelesen wären das 1.050 statt 3.150 €. Die Preislisten-Regel griff
  // hier nicht, weil nur ein verschiedener Betrag dasteht.
  assert.equal(read('Ich nehme die drei Stapeltanks:\n3 × 1.650 l – je 1.050 € VB').offer, null)
  assert.equal(read('2 x Rundtank 3700 l, je 2.100 EUR').offer, null)
  // Ein einzelner, klar gebotener Betrag bleibt unberührt.
  assert.equal(read('Ich biete 3.600 EUR für die Fässer.').offer, 3600)
})

test('N40 · eine Literzahl auf einer Preiszeile ist kein Geldbetrag', () => {
  // amountInText prüfte das Währungszeichen zeilenweise, die Zahl aber
  // zeichenweise: auf „3 × 1.650 l – je 1.050 € VB" galt damit auch 1.650 als
  // Betrag — zufällig der Preis zweier Rundtanks, die nirgends vorkommen.
  const zeile = '3 × 1.650 l – je 1.050 € VB'
  assert.equal(amountInText(1050, zeile), true, 'der echte Preis zählt')
  assert.equal(amountInText(1650, zeile), false, 'die Literzahl nicht')
})
