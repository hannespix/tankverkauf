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
import { applyProposal, createAd, createDeal, createQuote, detachTanks, noteOnLead, refreshAd, releaseQuoteTanks, removeLead, removeQuote, saveReply, setQuoteLinePrice, setQuoteReserved, setQuoteTanks } from './actions'
import { quoteMail } from './mail'
import { resolveBundle } from './bundles'
import { adDrift, generateAd } from './ads'
import { buildCatalog, catalogPhotos, catalogStamp, photoStamp, photoStampOf } from './catalog'
import { openQuotesOf, quoteMetrics, quoteRelation } from './stats'
import type { AdScope, DB, Deal, Lead, Quote, Tank } from '../types'

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

/*
 * B21 bis B27 — Reservieren aus dem Angebot.
 *
 * „Reserviert" war eine Einbahnstraße: gesetzt wurde es nur über den KI-Vorgang
 * oder von Hand in der Bestandsliste, und kein Angebotsvorgang löste es je
 * wieder auf. Die Fälle hier nageln beide Richtungen fest — und die drei
 * Schranken, an denen es sonst still Ware verschöbe.
 */

test('B21 · reservieren setzt Status UND Namen', () => {
  // Der bestehende KI-Weg setzt nur den Status. Eine so reservierte Position ist
  // für niemanden reserviert — und genau deshalb greift die Schutzsperre gegen
  // fremde Zugriffe bei ihr nicht.
  setDb({
    tanks: [tank('T-1'), tank('T-2')],
    leads: [lead('L-1', { name: 'Weber', stage: 'angebot' })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 2000 })],
  })
  setQuoteReserved('Q-1', ['T-1', 'T-2'], true)
  for (const t of db().tanks) {
    assert.equal(t.status, 'reserviert')
    assert.equal(t.leadId, 'L-1')
  }
  assert.equal(db().leads[0]!.stage, 'reserviert', 'die Phase zieht mit')
})

test('B22 · Verkauftes bleibt verkauft', () => {
  // Ein Rückschritt auf „reserviert" würde die Position über isOpen wieder in
  // den öffentlichen Katalog heben — der einzige wirklich zerstörerische Fehlgriff.
  setDb({
    tanks: [tank('T-1', { status: 'verkauft', dealId: 'D-1' }), tank('T-2')],
    leads: [lead('L-1')],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 2000 })],
  })
  setQuoteReserved('Q-1', ['T-1', 'T-2'], true)
  assert.equal(db().tanks[0]!.status, 'verkauft')
  assert.equal(db().tanks[1]!.status, 'reserviert')
})

test('B23 · was einem anderen zugesagt ist, wird nicht umgehängt', () => {
  setDb({
    tanks: [tank('T-1', { status: 'reserviert', leadId: 'L-2' }), tank('T-2')],
    leads: [lead('L-1'), lead('L-2')],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 2000 })],
  })
  setQuoteReserved('Q-1', ['T-1', 'T-2'], true)
  assert.equal(db().tanks[0]!.leadId, 'L-2', 'die fremde Zusage bleibt stehen')
  assert.equal(db().tanks[1]!.leadId, 'L-1')
})

test('B24 · lösen gibt ganz frei, wenn kein Angebot die Position mehr hält', () => {
  // Der Handweg über die Bestandsliste patcht nur den Status und lässt leadId
  // stehen; die Position gilt danach für buildPlan weiter als belegt.
  setDb({
    tanks: [tank('T-1', { status: 'reserviert', leadId: 'L-1' })],
    leads: [lead('L-1', { stage: 'reserviert' })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 1000, status: 'abgelehnt' })],
  })
  setQuoteReserved('Q-1', ['T-1'], false)
  const t = db().tanks[0]!
  assert.equal(t.status, 'verfuegbar')
  assert.equal(t.leadId, null, 'kein Schutt, den buildPlan später für eine Zusage hält')
  assert.equal(db().leads[0]!.stage, 'angebot', 'die Phase geht mit zurück')
})

test('B25 · lösen lässt „im Kontakt" stehen, solange ein Angebot sie führt', () => {
  setDb({
    tanks: [tank('T-1', { status: 'reserviert', leadId: 'L-1' })],
    leads: [lead('L-1')],
    quotes: [
      quote('Q-1', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 1000 }),
      quote('Q-2', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 900 }),
    ],
  })
  setQuoteReserved('Q-1', ['T-1'], false)
  const t = db().tanks[0]!
  assert.equal(t.status, 'kontakt', 'Q-2 führt sie noch')
  assert.equal(t.leadId, 'L-1')
})

test('B26 · nur Positionen dieses Angebots', () => {
  // Sonst wäre die Funktion ein Weg, über eine fremde Id beliebige Ware zu binden.
  setDb({
    tanks: [tank('T-1'), tank('T-9')],
    leads: [lead('L-1')],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 1000 })],
  })
  setQuoteReserved('Q-1', ['T-1', 'T-9'], true)
  assert.equal(db().tanks[0]!.status, 'reserviert')
  assert.equal(db().tanks[1]!.status, 'verfuegbar', 'T-9 steht in keinem Angebot')
})

test('B27 · ein geschrumpftes Paket sagt, wie viel fehlt', () => {
  // Etikett und Fließtext sind von Hand geschrieben („Raumspar-Keller, 8.000 l")
  // und ziehen nicht nach. Ohne diese Zahl stand die alte Behauptung über einem
  // Paket, das nur noch vier Positionen umfasste.
  const stock = new Map([
    ['T-1', { id: 'T-1', category: 'tank', vb: 1000 }],
    ['T-2', { id: 'T-2', category: 'tank', vb: 1000 }],
  ])
  const b = resolveBundle(
    { id: 'B-1', label: 'Vier Tanks, 4.000 l', blurb: 'Vier Stück.', ids: ['T-1', 'T-2', 'T-3', 'T-4'], giftIds: [], discount: 0.2, minItems: 2, active: true },
    stock,
  )
  assert.ok(b)
  assert.equal(b.short, 2, 'zwei der vier sind weg')
  assert.deepEqual(b.ids, ['T-1', 'T-2'])
})

test('B28 · reservieren geht auch ohne zugeordneten Interessenten', () => {
  /*
   * Die Sperre, die hier stand, war ein Fehlgriff.
   *
   * Wer ein Angebot aus dem Bestand heraus anlegt, wählt im Dialog keinen
   * Interessenten — das Feld steht auf „– keiner –". Genau dann lagen Knopf und
   * Häkchen grau da, ohne dass irgendwo lesbar stand, warum. Eine Position in
   * einem benannten Angebot ist nicht „niemandem zugeordnet": das Angebot ist
   * der Beleg, und heldByQuote findet sie.
   */
  setDb({
    tanks: [tank('T-1'), tank('T-2')],
    quotes: [quote('Q-1', { leadId: null, tankIds: ['T-1', 'T-2'], askPrice: 2000 })],
  })
  setQuoteReserved('Q-1', ['T-1', 'T-2'], true)
  for (const t of db().tanks) {
    assert.equal(t.status, 'reserviert', 'die Ware ist festgehalten')
    assert.equal(t.leadId, null, 'ein Name wird nicht erfunden')
  }
  // Und wieder lösen geht genauso — sonst wäre es die Einbahnstraße von vorher.
  setQuoteReserved('Q-1', ['T-1', 'T-2'], false)
  assert.equal(db().tanks[0]!.status, 'kontakt', 'Q-1 führt sie weiter')
})

/*
 * B29 bis B33 — die Regeln gelten auf jedem Weg, nicht nur auf einem.
 *
 * Die Schutzregeln standen in setQuoteTanks. Der Weg über die Bestandsliste —
 * anhaken, "Angebot erstellen" oder "Als Verkauf buchen" — ging vollständig
 * daran vorbei. Jeder Fall hier ist ein Weg, auf dem Geld verlorenging.
 */

test('B29 · ein neues Angebot nimmt keine verkaufte Position auf', () => {
  setDb({
    tanks: [tank('T-1', { status: 'verkauft', dealId: 'D-1' }), tank('T-2')],
    leads: [lead('L-1')],
  })
  const id = createQuote({ label: 'Test', tankIds: ['T-1', 'T-2'], askPrice: 2000, leadId: 'L-1', portalId: null, note: '' })
  assert.deepEqual(db().quotes.find((q) => q.id === id)!.tankIds, ['T-2'])
})

test('B30 · ein neues Angebot nimmt nicht, was einem anderen zugesagt ist', () => {
  setDb({
    tanks: [tank('T-1', { status: 'reserviert', leadId: 'L-2' }), tank('T-2')],
    leads: [lead('L-1'), lead('L-2')],
  })
  const id = createQuote({ label: 'Test', tankIds: ['T-1', 'T-2'], askPrice: 2000, leadId: 'L-1', portalId: null, note: '' })
  assert.deepEqual(db().quotes.find((q) => q.id === id)!.tankIds, ['T-2'])
  assert.equal(db().tanks[0]!.leadId, 'L-2', 'die fremde Zusage bleibt stehen')
})

test('B31 · ein Verkauf schließt das Angebot, das er erledigt', () => {
  /*
   * Das tat bisher nur quoteToDeal. Wer im Bestand buchte, ließ das Angebot
   * offen — mit scharfem Knopf "Als Verkauf buchen", der nicht prüfte, ob schon
   * verkauft ist. Ein zweiter Klick verdoppelte den Umsatz.
   */
  setDb({
    tanks: [tank('T-1'), tank('T-2')],
    leads: [lead('L-1')],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 2000 })],
  })
  createDeal({ label: 'Verkauf', tankIds: ['T-1', 'T-2'], price: 1900, leadId: 'L-1', date: '2026-01-01', note: '' })
  assert.equal(db().quotes[0]!.status, 'angenommen')
})

test('B32 · ein teilweise verkauftes Angebot bleibt offen', () => {
  // Wer sechs anbietet und zwei verkauft, verhandelt über den Rest weiter.
  setDb({
    tanks: [tank('T-1'), tank('T-2'), tank('T-3')],
    leads: [lead('L-1')],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2', 'T-3'], askPrice: 3000 })],
  })
  createDeal({ label: 'Teil', tankIds: ['T-1'], price: 900, leadId: 'L-1', date: '2026-01-01', note: '' })
  assert.equal(db().quotes[0]!.status, 'gesendet', 'zwei Positionen sind noch zu verhandeln')
})

test('B33 · freigeben löst, was nur dieses Angebot hält', () => {
  // T-1 hängt nur an Q-1, T-2 zusätzlich an der Auswahl des Interessenten.
  setDb({
    tanks: [
      tank('T-1', { status: 'reserviert', leadId: 'L-1' }),
      tank('T-2', { status: 'kontakt', leadId: 'L-1' }),
    ],
    leads: [lead('L-1', { tankIds: ['T-2'], stage: 'reserviert' })],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1', 'T-2'], askPrice: 2000, status: 'abgelehnt' })],
  })
  releaseQuoteTanks('Q-1')
  assert.equal(db().tanks[0]!.status, 'verfuegbar')
  assert.equal(db().tanks[0]!.leadId, null)
  assert.equal(db().tanks[1]!.status, 'kontakt', 'der Interessent will sie noch')
  assert.equal(db().leads[0]!.stage, 'angebot', 'nichts mehr reserviert, also nicht mehr diese Phase')
})

test('B34 · ein gelöschtes Angebot lässt keinen unsichtbar belegten Bestand zurück', () => {
  /*
   * removeQuote war der einzige Freigabeweg, der leadId stehen ließ. Status
   * "verfügbar" mit gesetztem Namen ist unsichtbar belegt: der Bestand zeigt
   * die Position frei, freeFor im Posteingang überspringt sie trotzdem.
   */
  setDb({
    tanks: [tank('T-1', { status: 'kontakt', leadId: 'L-1' })],
    leads: [lead('L-1')],
    quotes: [quote('Q-1', { leadId: 'L-1', tankIds: ['T-1'], askPrice: 1000 })],
  })
  removeQuote('Q-1')
  const t = db().tanks[0]!
  assert.equal(t.status, 'verfuegbar')
  assert.equal(t.leadId, null)
})

/*
 * B35 bis B39 — Anzeigentexte ziehen nach.
 *
 * Eine Reservierung löste bisher gar nichts aus: der Fingerabdruck kannte den
 * Zustand nicht, `adDrift` meldete nichts, und weil beide Aktualisieren-Knöpfe
 * hinter dieser Meldung lagen, war der Text danach überhaupt nicht mehr zu
 * erneuern. Die Anzeige bewarb weiter, was schon jemandem zugesagt war.
 */

// Immer den FRISCHEN Stand lesen: store.mutate ersetzt den Schnappschuss, ein
// vorher gegriffenes `db` zeigt danach auf die alte Fassung.
function adOf(scope: AdScope) {
  const d = store.getSnapshot().db
  return generateAd(d, scope, d.settings.portals[0]!)
}

test('B35 · reserviert steht als eigene Zeile, gekennzeichnet', () => {
  store.mutate((x) => {
    x.tanks = [
      tank('T-1', { maker: 'Speidel', type: 'Koffertank', litres: 1650, vb: 1050 }),
      tank('T-2', { maker: 'Speidel', type: 'Koffertank', litres: 1650, vb: 1050 }),
      tank('T-3', { maker: 'Speidel', type: 'Koffertank', litres: 1650, vb: 1050, status: 'reserviert', leadId: 'L-1' }),
    ]
    x.ads = []
  })
  const text = adOf({ kind: 'kategorie', category: 'tank' }).body
  assert.match(text, /2× Speidel Koffertank/, 'zwei sind lieferbar')
  assert.match(text, /1× Speidel Koffertank.*RESERVIERT/, 'das dritte steht getrennt und benannt')
})

test('B36 · eine Reservierung ändert den Fingerabdruck', () => {
  // Ohne das meldet adDrift nichts — und ohne Meldung gab es keinen Knopf.
  store.mutate((x) => { x.tanks = [tank('T-1', { vb: 1000 })]; x.ads = [] })
  const vorher = adOf({ kind: 'kategorie', category: 'tank' }).stamp
  store.mutate((x) => { x.tanks[0]!.status = 'reserviert' })
  assert.notEqual(adOf({ kind: 'kategorie', category: 'tank' }).stamp, vorher)
})

test('B37 · gezählt und bepreist wird, was lieferbar ist', () => {
  store.mutate((x) => {
    x.tanks = [
      tank('T-1', { vb: 1000, litres: 1000 }),
      tank('T-2', { vb: 1000, litres: 1000, status: 'reserviert', leadId: 'L-1' }),
    ]
    x.ads = []
  })
  const text = adOf({ kind: 'kategorie', category: 'tank' }).body
  // Die Summe darf die zugesagte Position nicht mitrechnen.
  assert.ok(!text.includes('2.000'), 'keine Summe über Ware, die niemand bekommen kann')
})

test('B38 · ein ausverkaufter Zuschnitt wirbt nicht weiter', () => {
  // Vorher entstand "0× Maschinen …" samt Zustandsblock und Preis.
  store.mutate((x) => {
    x.tanks = [tank('T-1', { status: 'verkauft', dealId: 'D-1' })]
    x.ads = []
  })
  const a = adOf({ kind: 'kategorie', category: 'tank' })
  assert.match(a.title, /alles verkauft/)
  assert.equal(a.price, 0)
  assert.ok(!a.body.includes('•'), 'keine Aufzählung über nichts')
})

test('B39 · abweichende Maße einer Gruppe werden nicht behauptet', () => {
  /*
   * Die Maße kamen vom ERSTEN Stück und wurden nie nachgeprüft. Verkauften sich
   * die ersten beiden einer Dreiergruppe, trug die Zeile plötzlich die Maße des
   * dritten — für die vorher beworbenen galten sie nie.
   */
  store.mutate((x) => {
    x.tanks = [
      tank('T-1', { vb: 900, dims: { w: 100, d: 100, h: 100 } }),
      tank('T-2', { vb: 900, dims: { w: 200, d: 200, h: 200 } }),
    ]
    x.ads = []
  })
  const text = adOf({ kind: 'kategorie', category: 'tank' }).body
  assert.ok(!text.includes('B 100') && !text.includes('B 200'), 'lieber keine Maße als die des falschen Stücks')
})


test('B40 · der Hinweis nennt die Reservierung, nicht nur Verkäufe', () => {
  /*
   * „Seit dem letzten Erzeugen geändert:" stand über einer LEEREN Aufzählung,
   * sobald der Grund eine Reservierung war: die Liste kannte nur Verkäufe,
   * Anzahl und Preis. Bei einer Kategorieanzeige ändert eine Reservierung
   * keines der drei — der Nutzer sah eine Warnung ohne Grund.
   */
  store.mutate((x) => { x.tanks = [tank('T-1', { vb: 1000 }), tank('T-2', { vb: 1000 })]; x.ads = [] })
  const adId = createAd(db(), { kind: 'kategorie', category: 'tank' }, db().settings.portals[0]!.id)
  store.mutate((x) => { x.tanks[0]!.status = 'reserviert'; x.tanks[0]!.leadId = 'L-1' })

  const d = adDrift(db(), db().ads.find((a) => a.id === adId)!)
  assert.equal(d.stale, true, 'der Text ist nicht mehr aktuell')
  assert.deepEqual(d.reservedSince.map((t) => t.id), ['T-1'], 'die vorgemerkte Position wird benannt')
  assert.equal(d.otherOnly, false, 'ein Grund steht ja fest — kein Sammelposten nötig')
})

test('B41 · nach dem Aktualisieren ist Ruhe, und der Vermerk steht im Text', () => {
  store.mutate((x) => { x.tanks = [tank('T-1', { vb: 1000 }), tank('T-2', { vb: 1000 })]; x.ads = [] })
  const adId = createAd(db(), { kind: 'kategorie', category: 'tank' }, db().settings.portals[0]!.id)
  store.mutate((x) => { x.tanks[0]!.status = 'reserviert'; x.tanks[0]!.leadId = 'L-1' })
  refreshAd(adId)

  const a = db().ads.find((x) => x.id === adId)!
  assert.equal(adDrift(db(), a).stale, false, 'der Hinweis verschwindet, sonst bliebe er für immer stehen')
  assert.match(a.body, /RESERVIERT/, 'im neuen Text ist die Vormerkung gekennzeichnet')
  assert.equal(a.edited, false, 'der Text kommt wieder aus der Maschine')
})

test('B42 · geänderte Angaben im Text bekommen einen eigenen Grund', () => {
  /*
   * Der Fingerabdruck deckt den ganzen Text ab. Wird ein Hersteller umbenannt,
   * ändert sich weder Anzahl noch Preis noch der Zustand einer Position — die
   * Aufzählung der Gründe bliebe leer. `otherOnly` fängt genau diesen Fall.
   */
  store.mutate((x) => { x.tanks = [tank('T-1', { vb: 1000, type: 'Edelstahltank' })]; x.ads = [] })
  const adId = createAd(db(), { kind: 'kategorie', category: 'tank' }, db().settings.portals[0]!.id)
  store.mutate((x) => { x.tanks[0]!.type = 'Immervolltank' })

  const d = adDrift(db(), db().ads.find((a) => a.id === adId)!)
  assert.equal(d.stale, true)
  assert.equal(d.otherOnly, true, 'ohne diesen Grund stünde die Überschrift über nichts')
})


/*
 * B43 bis B49 — die Käuferliste.
 *
 * `catalog.ts` war in keinem einzigen Prüffall, obwohl es das einzige Stück
 * Code ist, dessen Ergebnis das private Repo verlässt. Diese Fälle sichern die
 * Grenze: was hinausgeht, und was ausdrücklich nicht.
 */

function katalogVon(patch: Partial<DB>) {
  setDb(patch)
  return buildCatalog(store.getSnapshot().db)
}

test('B43 · Verkauftes steht neben der Liste, nicht darin', () => {
  /*
   * Der entscheidende Punkt der ganzen Änderung. Die Käuferseite holt die Datei
   * bei jeder Rückkehr in den Tab neu, ihr eigenes Programm aber nie — eine
   * ältere Fassung liest also die neue Datei. Ein Kennzeichen INNERHALB von
   * `items` überliest sie und böte Verkauftes zum Ankreuzen an; ein unbekanntes
   * Feld überliest sie folgenlos.
   */
  const c = katalogVon({
    tanks: [tank('T-1'), tank('T-2', { status: 'verkauft', dealId: 'D-1' })],
  })
  assert.deepEqual(c.items.map((i) => i.id), ['T-1'], 'nur Lieferbares steht in items')
  assert.deepEqual((c.soldItems ?? []).map((i) => i.id), ['T-2'], 'Verkauftes steht daneben')
})

test('B44 · von verkaufter Ware geht das Bild hinaus, der Preis nicht', () => {
  const c = katalogVon({
    tanks: [tank('T-1', {
      status: 'verkauft', dealId: 'D-1', leadId: 'L-9', vb: 1234, photos: ['fotos/a.jpg'],
      target: 900, floor: 800, offer: 777, note: 'am Telefon besprochen',
    })],
    deals: [deal('D-1', { tankIds: ['T-1'], price: 4242 })],
  })
  const v = (c.soldItems ?? [])[0]!
  /*
   * Die vollständige Liste, nicht zwei Stichproben.
   *
   * Zwei `assert.ok(!felder.includes(...))` blieben grün, wenn später jemand
   * `note` oder `dealId` mit hinausgäbe — also genau dann, wenn es darauf
   * ankommt. Eine Weißliste prüft man gegen die ganze Liste.
   */
  assert.deepEqual(Object.keys(v).sort(), ['category', 'categoryLabel', 'dims', 'id', 'litres', 'maker', 'photos', 'tags', 'type'])
  assert.deepEqual(v.photos, ['fotos/a.jpg'], 'das Bild ist der Beleg und geht mit')
  assert.equal(v.maker, 'Speidel', 'benannt wird die Position trotzdem')
})

test('B45 · übertragen und gestempelt wird dieselbe Bildmenge', () => {
  /*
   * Der Fallstrick, an dem die Bilder verkaufter Ware eine Weile gefehlt haben.
   *
   * `writeCatalog` überträgt `catalogPhotos(catalog)`, und derselbe Ausdruck
   * trägt den Fingerabdruck. Liefen die beiden auseinander — und getrennt
   * gerechnet taten sie das, sobald Verkauftes Bilder trägt —, dann änderte ein
   * Foto an einer verkauften Position den Stempel NICHT: der Bilddurchlauf wird
   * übersprungen, die Datei nie kopiert, und die Liste zeigt dauerhaft ein
   * totes Bild, während das Werkzeug „aktuell" meldet.
   */
  setDb({
    tanks: [
      tank('T-1', { photos: ['fotos/frei.jpg'] }),
      tank('T-2', { status: 'verkauft', dealId: 'D-1', photos: ['fotos/weg.jpg'] }),
    ],
  })
  const c = buildCatalog(store.getSnapshot().db)
  assert.deepEqual(catalogPhotos(c), ['fotos/frei.jpg', 'fotos/weg.jpg'], 'auch das Bild der verkauften Position')

  /*
   * Der Kern: `writeCatalog` überträgt `catalogPhotos(catalog)` und stempelt mit
   * `photoStampOf` über GENAU DIESES Array. Hier dieselbe Kette nachgebaut —
   * würde die Übertragung wieder auf eine eigene Rechnung umgestellt, fiele
   * dieser Fall.
   */
  const wanted = catalogPhotos(c)
  assert.equal(photoStampOf(wanted), photoStamp(c), 'gestempelt wird, was übertragen wird')
  assert.equal(photoStampOf(wanted), hashOf(wanted.join('|')), 'und zwar nachrechenbar')

  /*
   * Die Probe aufs Exempel: ein Foto an der VERKAUFTEN Position muss den Stempel
   * bewegen. Genau das tat es vorher nicht.
   *
   * Gesucht wird über den Zustand, nicht über den Index — `x.tanks[1]` wäre auch
   * dann grün geblieben, wenn es auf die freie Position zeigte, und damit hätte
   * der Fall seine eigene Behauptung nicht mehr festgenagelt.
   */
  const vorher = photoStamp(c)
  store.mutate((x) => { x.tanks.find((t) => t.status === 'verkauft')!.photos = ['fotos/weg.jpg', 'fotos/zweite.jpg'] })
  const danach = buildCatalog(store.getSnapshot().db)
  assert.deepEqual(catalogPhotos(danach), ['fotos/frei.jpg', 'fotos/weg.jpg', 'fotos/zweite.jpg'])
  assert.notEqual(photoStamp(danach), vorher)
})

test('B50 · eine ältere Datei ohne Bilder an Verkauftem bricht nichts', () => {
  /*
   * Bis zum nächsten Veröffentlichen liegt genau so eine Datei draußen: die
   * Fassung davor gab für Verkauftes gar keine Bilder heraus. Ohne die
   * Absicherung wirft `catalogPhotos` an `undefined.flatMap`.
   */
  const alt = { items: [], soldItems: [{ id: 'T-1', category: 'tank', categoryLabel: 'Tanks', maker: 'Speidel', type: 'Tank', litres: 0, dims: null, tags: [] }] }
  assert.deepEqual(catalogPhotos(alt as unknown as Parameters<typeof catalogPhotos>[0]), [])
})

// Derselbe Fingerabdruck wie in catalog.ts — hier nachgebaut, damit der Prüffall
// die Rechnung belegt und nicht nur sich selbst.
function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

test('B46 · ein Verkauf stößt eine Veröffentlichung an', () => {
  // Ohne Fingerabdruckwechsel erreicht die Kennzeichnung den Käufer nie.
  setDb({ tanks: [tank('T-1'), tank('T-2')] })
  const vorher = catalogStamp(store.getSnapshot().db)
  store.mutate((x) => { x.tanks[1]!.status = 'verkauft'; x.tanks[1]!.dealId = 'D-1' })
  assert.notEqual(catalogStamp(store.getSnapshot().db), vorher)
})

test('B47 · ein Paket schnürt nichts Verkauftes ein', () => {
  setDb({
    tanks: [tank('T-1', { vb: 1000 }), tank('T-2', { vb: 1000, status: 'verkauft', dealId: 'D-1' })],
  })
  store.mutate((x) => {
    x.settings.bundles = [{ id: 'B-1', label: 'Zwei Tanks', blurb: '', ids: ['T-1', 'T-2'], giftIds: [], discount: 0.1, minItems: 1, active: true }]
  })
  const b = buildCatalog(store.getSnapshot().db).bundles[0]!
  assert.deepEqual(b.ids, ['T-1'], 'die verkaufte Position fällt heraus')
  assert.equal(b.short, 1, 'und der Käufer erfährt, dass der Zuschnitt kleiner ist')
})

test('B48 · eine restlos verkaufte Gattung behält keinen Werbetext', () => {
  // „Wir geben die Fässer als Dekofässer ab …" über nichts wäre ein Angebot
  // für nichts. Die Überschrift trägt die verkaufte Zeile, der Werbetext nicht.
  const c = katalogVon({ tanks: [tank('T-1', { status: 'verkauft', dealId: 'D-1' })] })
  assert.deepEqual(c.categories, [], 'keine Gattung mit Inhalt')
  assert.equal(c.items.length, 0)
  assert.equal((c.soldItems ?? []).length, 1, 'sichtbar bleibt sie trotzdem')
})

test('B49 · reservierte Ware bleibt lieferbar und in der Liste', () => {
  // Die Abgrenzung nach unten: reserviert ist NICHT verkauft.
  const c = katalogVon({ tanks: [tank('T-1', { status: 'reserviert', leadId: 'L-1' })] })
  assert.deepEqual(c.items.map((i) => i.id), ['T-1'])
  assert.equal(c.items[0]!.reserved, true)
  assert.deepEqual(c.soldItems ?? [], [], 'sie ist nicht verkauft')
})
