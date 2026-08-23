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
import { detachTanks, removeLead, setQuoteTanks } from './actions'
import { openQuotesOf, quoteRelation } from './stats'
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
