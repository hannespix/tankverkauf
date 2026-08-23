/**
 * Wem eine Position gerade gehört — als Prüffälle.
 *
 * Jeder Fall hier ist ein Weg, auf dem dieselbe Position an zwei Menschen
 * gehen konnte, oder auf dem eine Zusage still verschwand. Gefunden hat sie
 * die Gegenlesung zur Verknüpfung von Interessent und Angebot; keiner davon
 * war auf Compilerebene sichtbar, und keiner hätte sich beim Durchklicken
 * gezeigt, solange nur ein Interessent im Spiel ist.
 *
 * Laufen mit: npm test
 */

// Browser-Attrappen zuerst — store.ts fasst localStorage schon beim Anlegen an.
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './store'
import { applyProposal, detachTanks, noteOnLead, removeLead, saveReply, setQuoteLinePrice, setQuoteTanks } from './actions'
import { quoteMail } from './mail'
import { openQuotesOf, quoteMetrics, quoteRelation } from './stats'
import type { DB, Deal, Lead, Quote, Tank } from '../types'

const at = (n: number) => `2026-0${n}-01T00:00:00.000Z`
const db = () => store.getSnapshot().db

function tank(id: string, over: Partial<Tank> = {}): Tank {
  return {
    id, category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 1000, dims: null,
    vb: 1000, target: 900, floor: 800, status: 'verfuegbar', leadId: null, dealId: null,
    offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: at(1), ...over,
  }
}
function lead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id, name: id, phone: '', email: '', location: '', source: 'telefon', stage: 'neu',
    tankIds: [], budget: null, lastContact: null, nextFollowUp: null, note: '',
    createdAt: at(1), updatedAt: at(1), ...over,
  }
}
function quote(id: string, over: Partial<Quote> = {}): Quote {
  return {
    id, label: id, leadId: null, portalId: null, tankIds: [], askPrice: 0, buyerOffer: null,
    status: 'gesendet', validUntil: null, note: '', createdAt: at(1), updatedAt: at(1), ...over,
  }
}
function deal(id: string, over: Partial<Deal> = {}): Deal {
  return { id, label: id, leadId: null, tankIds: [], price: 0, date: '2026-01-01', paid: false, pickedUp: false, note: '', ...over }
}

/** Den Store auf einen genauen Stand setzen — ohne Pakete und Staffel, damit Preise glatte Summen sind. */
function setDb(patch: Partial<DB>) {
  store.mutate((d) => {
    d.tanks = patch.tanks ?? []
    d.leads = patch.leads ?? []
    d.quotes = patch.quotes ?? []
    d.deals = patch.deals ?? []
    d.ads = []
    d.activity = []
    d.settings.bundles = []
    d.settings.tiers = []
  })
}

test('B1 · Abhaken gibt nicht frei, was ein Angebot noch führt', () => {
  setDb({
    tanks: [tank('T-1', { status: 'kontakt', leadId: 'L-1' })],
    leads: [lead('L-1', { tankIds: ['T-1'] })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 1000 })],
  })
  detachTanks('L-1', ['T-1'])
  const t = db().tanks[0]!
  // Aus der Auswahl ist sie raus — aber nicht aus dem Bestand des Käufers,
  // solange das Angebot sie nennt und "Als Verkauf buchen" sie verkaufen kann.
  assert.deepEqual(db().leads[0]!.tankIds, [])
  assert.equal(t.status, 'kontakt')
  assert.equal(t.leadId, 'L-1')
})

test('B2 · ein Angebot nimmt keine verkaufte Position auf', () => {
  setDb({
    tanks: [tank('T-1', { status: 'verkauft', leadId: 'L-1', dealId: 'D-1' }), tank('T-2')],
    leads: [lead('L-1', { tankIds: ['T-1', 'T-2'] })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-2'], askPrice: 1000 })],
  })
  setQuoteTanks('Q-1', ['T-1', 'T-2'])
  assert.deepEqual(db().quotes[0]!.tankIds, ['T-2'])
})

test('B3 · ein Angebot nimmt nicht, was einem anderen versprochen ist', () => {
  setDb({
    tanks: [tank('T-1', { status: 'reserviert', leadId: 'L-1' }), tank('T-2')],
    leads: [lead('L-1', { tankIds: ['T-1'] }), lead('L-2', { tankIds: ['T-2'] })],
    quotes: [quote('Q-2', { leadId: 'L-2', tankIds: ['T-2'], askPrice: 1000 })],
  })
  setQuoteTanks('Q-2', ['T-1', 'T-2'])
  assert.deepEqual(db().quotes[0]!.tankIds, ['T-2'])
  assert.equal(db().tanks[0]!.leadId, 'L-1', 'die Reservierung bleibt, wo sie war')
})

test('B4 · ein Angebot über nichts entsteht nicht', () => {
  setDb({
    tanks: [tank('T-1', { status: 'kontakt', leadId: 'L-1' })],
    leads: [lead('L-1', { tankIds: ['T-1'] })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 1000 })],
  })
  setQuoteTanks('Q-1', [])
  // Sonst stünde es mit 0 € da und ließe sich trotzdem als Verkauf buchen.
  assert.deepEqual(db().quotes[0]!.tankIds, ['T-1'])
  assert.equal(db().quotes[0]!.askPrice, 1000)
})

test('B5 · das jüngste offene Angebot gilt, auch nach einem Statuswechsel', () => {
  setDb({
    tanks: [tank('T-1'), tank('T-2')],
    leads: [lead('L-1')],
    quotes: [
      quote('Q-neu', { leadId: 'L-1', tankIds: ['T-2'], createdAt: at(3) }),
      quote('Q-alt', { leadId: 'L-1', tankIds: ['T-1'], createdAt: at(2) }),
    ],
  })
  assert.equal(openQuotesOf(db(), 'L-1')[0]!.id, 'Q-neu')
  assert.equal(openQuotesOf(db(), 'L-1').length, 2)
  // Reihenfolge kommt aus dem Datum, nicht daraus, wie die Liste gefüllt wurde.
  store.mutate((d) => { d.quotes.reverse() })
  assert.equal(openQuotesOf(db(), 'L-1')[0]!.id, 'Q-neu')
})

test('B6 · ein gelöschter Interessent lässt keine toten Verweise zurück', () => {
  setDb({
    tanks: [tank('T-1', { status: 'verkauft', leadId: 'L-1', dealId: 'D-1' })],
    leads: [lead('L-1', { name: 'Ortlieb', email: 'o@example.org' })],
    deals: [deal('D-1', { leadId: 'L-1', tankIds: ['T-1'], price: 900 })],
  })
  removeLead(db().leads[0]!)
  assert.equal(db().tanks[0]!.leadId, null)
  assert.equal(db().deals[0]!.leadId, null)
  // Deal kennt kein Käuferfeld — ohne diese Zeile verlöre der Verkauf seinen
  // Menschen ganz, während die Position noch auf ihn zeigte.
  assert.match(db().deals[0]!.note, /Ortlieb/)
  assert.match(db().deals[0]!.note, /o@example\.org/)
})

test('B7 · Auswahl und Angebot: die Beziehung stimmt in beide Richtungen', () => {
  assert.equal(quoteRelation(['T-1'], ['T-1']), 'deckungsgleich')
  assert.equal(quoteRelation(['T-1'], ['T-1', 'T-2']), '1 von 2 Positionen im Angebot')
  // Das Angebot ist keine Teilmenge der Auswahl: über setQuoteTanks kommt eine
  // Position hinein, ohne je angehakt gewesen zu sein. "2 von 1 Position" stand
  // hier, solange die Rechnung das Gegenteil unterstellte.
  assert.equal(quoteRelation(['T-1', 'T-2'], ['T-1']), '1 nur im Angebot')
  assert.equal(quoteRelation(['T-2'], ['T-1']), '1 nur im Angebot, 1 nur in der Auswahl')
})

test('B8 · was aus einer Nachricht gelesen wird, landet in der Notiz', () => {
  setDb({ tanks: [tank('T-1')], leads: [lead('L-1', { name: 'Ortlieb' })] })
  noteOnLead('L-1', 'Ich nehme den 1000er. Abholung Freitag.', ['Positionen anhängen'], false, {
    summary: 'Fester Kauf, eine Position.',
    notes: ['Abholung: Freitag', 'Gebot 900 € — dafür fehlt noch ein Angebot.'],
    steps: ['Nachricht vermerken', 'Positionen anhängen'],
    fromImage: false,
  })
  const l = db().leads[0]!
  // Der Wortlaut liegt in der Nachrichtenliste …
  assert.equal(l.messages?.length, 1)
  assert.match(l.messages![0]!.text, /Abholung Freitag/)
  // … das Gelesene in der Notiz, die ungedeckelt ist und auf der Karte steht.
  assert.match(l.note, /Fester Kauf, eine Position\./)
  assert.match(l.note, /· Abholung: Freitag/)
  assert.match(l.note, /· Gebot 900 €/)
  // Und das Protokoll nennt den ganzen Zug, nicht nur den ersten Schritt.
  assert.deepEqual(l.messages![0]!.applied, ['Positionen anhängen'])
})

test('B9 · dieselbe Nachricht zweimal legt keinen zweiten Eintrag an', () => {
  setDb({ tanks: [tank('T-1')], leads: [lead('L-1')] })
  const ctx = { summary: 'Anfrage.', notes: [], steps: ['Nachricht vermerken'], fromImage: false }
  noteOnLead('L-1', 'Ist der noch da?', ['Nachricht vermerken'], false, ctx)
  noteOnLead('L-1', 'Ist der noch da?', ['Positionen anhängen'], false, ctx)
  const l = db().leads[0]!
  assert.equal(l.messages?.length, 1)
  assert.deepEqual(l.messages![0]!.applied, ['Nachricht vermerken', 'Positionen anhängen'])
  // Und der Notizblock steht auch nur einmal da.
  assert.equal(l.note.match(/Anfrage\./g)?.length, 1)
})

test('B10 · eine Folgenachricht trägt den fehlenden Kontaktweg nach', () => {
  setDb({ tanks: [tank('T-1')], leads: [lead('L-1', { name: 'Ortlieb', email: 'o@example.org' })] })
  const p = {
    id: 'P-1', kind: 'lead.notiz' as const, title: 'Nachricht bei Ortlieb vermerken', effect: '', quote: '',
    proven: true, publishes: false, leadId: 'L-1', name: 'Ortlieb', email: 'o@example.org',
    phone: '0176 4433221', stage: null, amount: null, tankIds: [], pick: null, warning: '',
  }
  applyProposal(p, null, 'Ok, ich nehme die beiden. 0176 4433221')
  // Gefunden wurde er über die E-Mail, unterschrieben hat er mit Telefonnummer.
  assert.equal(db().leads[0]!.phone, '0176 4433221')
  assert.equal(db().leads[0]!.email, 'o@example.org')
})

test('B11 · eine Antwort landet im Verlauf, nicht nur in der Zwischenablage', () => {
  setDb({ tanks: [tank('T-1')], leads: [lead('L-1', { name: 'Weber' })] })
  noteOnLead('L-1', 'Was kostet der 1000er?', ['Nachricht vermerken'])
  saveReply('L-1', 'Der kostet 1.000 €.', 'Ihre Anfrage', 'Q-1')
  const m = db().leads[0]!.messages ?? []
  assert.equal(m.length, 2)
  // Neueste zuerst: die Antwort steht oben und ist als ausgehend erkennbar.
  assert.equal(m[0]!.dir, 'aus')
  assert.equal(m[0]!.subject, 'Ihre Anfrage')
  assert.equal(m[0]!.quoteId, 'Q-1')
  // Die eingegangene bleibt unverändert und ohne Richtung — so lagen sie schon
  // vor der Antwortfunktion in der Datenbank.
  assert.equal(m[1]!.dir, undefined)
  assert.match(m[1]!.text, /Was kostet/)
})

test('B12 · die Angebots-E-Mail nennt nichts Internes', () => {
  // Sie geht an einen Käufer. Zielpreis, Untergrenze, das Gebot, die interne
  // Notiz und jeder andere Interessent haben darin nichts verloren.
  setDb({
    tanks: [
      tank('T-1', { litres: 800, vb: 650, target: 559, floor: 468 }),
      tank('T-2', { litres: 1000, vb: 750, target: 645, floor: 540, status: 'reserviert', leadId: 'L-2' }),
    ],
    leads: [lead('L-1', { name: 'Weber' }), lead('L-2', { name: 'Berger' })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 1200, buyerOffer: 1100, note: 'nicht unter 1.150' })],
  })
  const m = quoteMail(db(), db().quotes[0]!)
  const alles = `${m.subject}\n${m.text}`
  for (const nadel of ['559', '468', '645', '540', 'Berger', 'reserviert', 'nicht unter', '1.100']) {
    assert.ok(!alles.includes(nadel), `„${nadel}" darf nicht in der Angebots-E-Mail stehen`)
  }
  // Was hineingehört, steht drin.
  assert.match(alles, /Weber/)
  // Ohne das Leerzeichen im Muster: eur() setzt ein geschütztes (U+00A0).
  assert.match(alles, /1\.200/)
  assert.match(alles, /T-1/)
})

/*
 * B13 bis B19 — Einzelpreise je Position im Angebot.
 *
 * Ein Angebot forderte bisher eine einzige Zahl für alles. Wer bei einer von
 * sechs Positionen nachließ, konnte nur die Gesamtsumme drücken; welche Position
 * den Nachlass trug, wusste danach niemand mehr.
 *
 * Die Fälle hier nageln die zwei Regeln fest, an denen still Geld hängt: was
 * eine unangetastete Zeile kostet, und wann der geforderte Gesamtpreis
 * mitrechnet und wann nicht.
 */

test('B13 · eine unangetastete Zeile kostet die VB aus dem Bestand', () => {
  setDb({
    tanks: [tank('T-1', { vb: 650 }), tank('T-2', { vb: 750 })],
    quotes: [quote('Q-1', { tankIds: ['T-1', 'T-2'], askPrice: 1400 })],
  })
  const m = quoteMetrics(db(), ['T-1', 'T-2'], 1400, null, db().quotes[0]!.prices)
  assert.equal(m.lines, 1400, 'ohne gesetzte Preise ist die Zeilensumme die Summe der VB')
  assert.equal(m.lines, m.vb, 'und deckt sich mit dem, was vorher schon gerechnet wurde')
})

test('B14 · ein gesetzter Preis schlägt die VB, der Rest bleibt', () => {
  setDb({
    tanks: [tank('T-1', { vb: 650 }), tank('T-2', { vb: 750 })],
    quotes: [quote('Q-1', { tankIds: ['T-1', 'T-2'], askPrice: 1400 })],
  })
  setQuoteLinePrice('Q-1', 'T-1', 500)
  const q = db().quotes[0]!
  assert.deepEqual(q.prices, { 'T-1': 500 }, 'nur die angefasste Zeile wird gespeichert')
  const m = quoteMetrics(db(), q.tankIds, q.askPrice, null, q.prices)
  assert.equal(m.lines, 1250)
  assert.equal(m.vb, 1400, 'die Bestands-VB bleibt davon unberührt')
})

test('B15 · zurück auf die VB löscht den Eintrag, statt ihn festzufrieren', () => {
  // Bliebe 650 als Zahl stehen, liefe die Zeile bei der nächsten Preisrunde
  // still neben dem Bestand her.
  setDb({
    tanks: [tank('T-1', { vb: 650 })],
    quotes: [quote('Q-1', { tankIds: ['T-1'], askPrice: 650 })],
  })
  setQuoteLinePrice('Q-1', 'T-1', 500)
  setQuoteLinePrice('Q-1', 'T-1', 650)
  assert.equal(db().quotes[0]!.prices, undefined, 'die leere Karte verschwindet ganz')
})

test('B16 · der geforderte Preis rechnet mit, solange er die Zeilensumme war', () => {
  setDb({
    tanks: [tank('T-1', { vb: 650 }), tank('T-2', { vb: 750 })],
    quotes: [quote('Q-1', { tankIds: ['T-1', 'T-2'], askPrice: 1400 })],
  })
  setQuoteLinePrice('Q-1', 'T-1', 500)
  assert.equal(db().quotes[0]!.askPrice, 1250, 'die Summe zieht nach')
})

test('B17 · ein von Hand gesetzter Gesamtpreis bleibt stehen', () => {
  // Das ist der Paketnachlass. Er darf nicht verschwinden, nur weil jemand
  // danach noch eine Zeile bewegt.
  setDb({
    tanks: [tank('T-1', { vb: 650 }), tank('T-2', { vb: 750 })],
    quotes: [quote('Q-1', { tankIds: ['T-1', 'T-2'], askPrice: 1200 })],
  })
  setQuoteLinePrice('Q-1', 'T-1', 500)
  const q = db().quotes[0]!
  assert.equal(q.askPrice, 1200, 'der Paketpreis gehört dem Verkäufer')
  assert.equal(quoteMetrics(db(), q.tankIds, q.askPrice, null, q.prices).bundleOff, 50)
})

test('B18 · eine entfernte Position nimmt ihren Preis mit', () => {
  // Bliebe der Eintrag liegen, tauchte er beim Wiederhinzufügen still wieder
  // auf — ein Preis, den in dieser Runde niemand gesetzt hat.
  setDb({
    tanks: [tank('T-1', { vb: 650 }), tank('T-2', { vb: 750 })],
    quotes: [quote('Q-1', { tankIds: ['T-1', 'T-2'], askPrice: 1400 })],
  })
  setQuoteLinePrice('Q-1', 'T-2', 700)
  setQuoteTanks('Q-1', ['T-1'])
  assert.equal(db().quotes[0]!.prices?.['T-2'], undefined)
  setQuoteTanks('Q-1', ['T-1', 'T-2'])
  const q = db().quotes[0]!
  assert.equal(quoteMetrics(db(), q.tankIds, q.askPrice, null, q.prices).lines, 1400, 'T-2 steht wieder auf seiner VB')
})

test('B19 · unter der eigenen Untergrenze wird je Position gemeldet', () => {
  // Genau das Loch, das Einzelpreise aufreißen: die geforderten 1.400 liegen
  // weit über der Summe der Untergrenzen (468 + 540 = 1.008), das Angebot ist
  // also unauffällig — während T-1 mit 400 unter seinen eigenen 468 verschenkt
  // wird. Die Gesamtwarnung kann das nicht sehen, sie kennt nur eine Summe.
  setDb({
    tanks: [tank('T-1', { vb: 650, target: 559, floor: 468 }), tank('T-2', { vb: 750, target: 645, floor: 540 })],
    quotes: [quote('Q-1', { tankIds: ['T-1', 'T-2'], askPrice: 1400 })],
  })
  setQuoteLinePrice('Q-1', 'T-1', 400)
  const q = db().quotes[0]!
  const m = quoteMetrics(db(), q.tankIds, q.askPrice, null, q.prices)
  assert.deepEqual(m.underFloor, ['T-1'])
  assert.notEqual(m.verdict, 'unter-limit', 'das Angebot insgesamt ist nicht das Problem')
})

test('B20 · die Angebots-E-Mail zeigt Einzelpreise nur, wenn welche gesetzt sind', () => {
  setDb({
    tanks: [tank('T-1', { litres: 800, vb: 650, floor: 468 }), tank('T-2', { litres: 1000, vb: 750, floor: 540 })],
    leads: [lead('L-1', { name: 'Weber' })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 1200 })],
  })
  // Ohne gesetzte Preise bleibt die Mail wie bisher: keine Zahl je Zeile.
  const ohne = quoteMail(db(), db().quotes[0]!).text
  assert.ok(!/T-1.*650/.test(ohne), 'kein Preis an der Position, solange nichts verhandelt wurde')

  setQuoteLinePrice('Q-1', 'T-1', 500)
  const mit = quoteMail(db(), db().quotes[0]!).text
  assert.match(mit, /T-1.*500/, 'die verhandelte Zeile trägt ihren Preis')
  assert.match(mit, /T-2.*750/, 'und die übrigen ihren — alles oder nichts')
  // Der Schlusssatz muss sich auf die Zeilen darüber addieren.
  assert.match(mit, /1\.250/, 'Summe der Einzelpreise')
  // Und nichts Internes, auch jetzt nicht.
  for (const nadel of ['468', '540']) {
    assert.ok(!mit.includes(nadel), `„${nadel}" darf nicht in der Angebots-E-Mail stehen`)
  }
})
