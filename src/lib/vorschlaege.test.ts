/**
 * Der KI-Weg: was aus einem Modellvorschlag wird — als Prüffälle.
 *
 * `checkProposals` kam in keiner Testdatei vor. Jeder `buildPlan`-Aufruf in den
 * anderen Tests übergibt eine leere Vorschlagsliste; der ganze KI-Pfad war damit
 * ungeprüft, und alle Tests blieben grün, egal was dort geschah. Genau dort ist
 * der Fall Wallhäuser passiert.
 *
 * Geprüft wird nicht die KI — die kostet Geld und ist nicht wiederholbar —,
 * sondern was der Code aus ihrer Antwort macht: was er übernimmt, was er
 * abweist, und was er als unsicher kennzeichnet.
 *
 * Laufen mit: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, checkProposals } from './inbox'
import { parseMessage } from './ads'
import { SEED } from './seed'
import type { DB } from '../types'
import type { RawProposal } from './ai'

const db = SEED as unknown as DB
const plan = (raw: RawProposal[], text: string) => {
  const checked = checkProposals(raw, text, db)
  return { ...buildPlan(checked.proposals, parseMessage(text, db), db, text), dropped: checked.dropped }
}
const step = (p: ReturnType<typeof plan>, kind: string) => p.steps.find((s) => s.kind === kind)

/** Die echte Mail von der Nahe, gekürzt auf das, was zählt. */
const WALL = [
  'Hallo Frau Pix,',
  '',
  'ich hätte Interesse an den Stapeltanks von Möschle.',
  '1 × 800 l – 650 € VB',
  '1 × 1.000 l – 750 € VB',
  '1 × 1.250 l – 850 € VB',
  '3 × 1.650 l – je 1.050 € VB',
  'Ich bräuchte noch Tiefe und Breite der Tanks sowie die Gesamthöhe des höchsten Stapels.',
  '',
  'Viele Grüße von der Nahe',
  'Alexander Wallhäuser',
  'weingut-wallhaeuser@web.de',
].join('\n')

test('V1 · der genannte Preis löst auf, wo die Literzahl mehrdeutig ist', () => {
  // Drei Positionen haben 1.000 l — T-09 und T-10 zu 700 €, T-15 zu 750 €.
  // Er nennt 750 €. Vorher hängte das Werkzeug T-09 an; die Regel verbot der KI,
  // den Preis zu nutzen, und der Code warf ihre Auflösung wieder weg.
  const p = plan([
    { kind: 'positionen', quote: '1 × 1.000 l – 750 € VB', positionIds: ['T-15'], confidence: 'erschlossen', reason: '750 € trifft genau T-15' },
  ], WALL)
  assert.deepEqual(step(p, 'positionen')?.tankIds, ['T-15'])
  assert.equal(step(p, 'positionen')?.proven, true)
})

test('V2 · ein Preis, der nicht dasteht, trägt die Auflösung nicht', () => {
  // Gegenprobe zu V1: T-09 kostet 700 €, und 700 € steht nirgends in der Mail.
  // „erschlossen" allein genügt nicht — es muss sich am Text nachrechnen lassen.
  const p = plan([
    { kind: 'positionen', quote: '1 × 1.000 l – 750 € VB', positionIds: ['T-09'], confidence: 'erschlossen', reason: 'behauptet' },
  ], WALL)
  const s = step(p, 'positionen')
  // Entweder verworfen oder als unsichere Vermutung — nie als belegt.
  assert.notEqual(s?.proven, true)
})

test('V3 · die drei 1.650er verschwinden nicht mehr', () => {
  // Der Kern des Falls. Die alte Anweisung nannte „drei 1.650-l-Tanks"
  // ausdrücklich als Beispiel, wo KEINE Nummer genannt werden darf — und
  // zusammen mit „lieber weniger und sicher" kam gar nichts.
  const p = plan([
    { kind: 'positionen', quote: '3 × 1.650 l – je 1.050 € VB', positionIds: ['T-17', 'T-18', 'T-19'], count: 3, confidence: 'baugleich' },
  ], WALL)
  const s = step(p, 'positionen')
  const trifft = s?.tankIds.length ? s.tankIds : (s?.pick ? s.pick.from.slice(0, s.pick.count) : [])
  assert.equal(trifft.length, 3, 'alle drei müssen ankommen')
  assert.deepEqual([...trifft].sort(), ['T-17', 'T-18', 'T-19'])
})

test('V4 · eine zurückzitierte Preisliste wird kein Gebot', () => {
  // 1.050 € ist unser eigener VB für T-17 bis T-19. Als Gebot gebucht wären das
  // 4.350 € weniger, als er zugesagt hat.
  const p = plan([
    { kind: 'gebot', quote: '3 × 1.650 l – je 1.050 € VB', amount: 1050, amountKind: 'unser_preis' },
  ], WALL)
  assert.equal(step(p, 'gebot'), undefined)
  assert.ok(p.dropped.some((d) => /eigener Preis/.test(d)), 'und es steht dabei, warum')
})

test('V5 · ein echtes Gebot bleibt ein Gebot', () => {
  // Mit Kontaktweg — ohne den verweigert buildPlan zu Recht jeden Schritt.
  const text = 'Ich biete 3.600 EUR für die beiden Rundtanks 3700 l.\nGruß, Martin Weber\nweber@example.org'
  const p = plan([
    { kind: 'gebot', quote: 'Ich biete 3.600 EUR', amount: 3600, amountKind: 'gebot' },
  ], text)
  assert.equal(step(p, 'gebot')?.amount, 3600)
})

test('V6 · „geraten" bleibt unsicher und läuft nicht ungefragt mit', () => {
  const p = plan([
    { kind: 'positionen', quote: 'an einem der großen Tanks', positionIds: ['T-22'], confidence: 'geraten', reason: 'Es kämen auch T-20, T-21 und T-23 in Frage.' },
  ], 'Ich hätte Interesse an einem der großen Tanks, so 3.100 l.\nGruß, Martin Weber\nweber@example.org')
  const s = step(p, 'positionen')
  assert.equal(s?.proven, false)
  assert.match(s?.warning ?? '', /T-20/)
})

test('V7 · was nicht zuzuordnen war, verschwindet nicht stillschweigend', () => {
  // Vorher warf der Code bei gemischter Sicherheit die aufgelösten Positionen weg
  // (`base.tankIds = []`) — aus sechs gewollten wurde eine.
  const p = plan([
    { kind: 'positionen', quote: '1 × 800 l – 650 € VB', positionIds: ['T-14', 'T-09'], confidence: 'erschlossen', reason: '650 € trifft T-14' },
  ], WALL)
  const s = step(p, 'positionen')
  assert.ok(s?.tankIds.includes('T-14'), 'die belegte Position bleibt')
  assert.match(s?.warning ?? '', /T-09/, 'und die andere wird benannt')
})

test('V8 · 29 Fässer hängen nicht an der Frage nach einem', () => {
  // Der Vorfall, wegen dem „lieber weniger und sicher" überhaupt dastand. Auch
  // wenn die KI jetzt alle Nummern nennen darf, muss die Stückzahl decken.
  const alle = Array.from({ length: 29 }, (_, i) => `F-${String(i + 1).padStart(2, '0')}`)
  const p = plan([
    { kind: 'positionen', quote: 'ein Barriquefass', positionIds: alle, count: 1, confidence: 'baugleich' },
  ], 'Was soll ein Barriquefass 225 l kosten?\nGruß, Martin Weber\nweber@example.org')
  const s = step(p, 'positionen')
  const trifft = s?.tankIds.length ? s.tankIds.length : (s?.pick?.count ?? 0)
  assert.equal(trifft, 1, 'gefragt war eines')
})

test('V9 · reservieren bleibt streng, auch wenn Positionen es nicht mehr sind', () => {
  // Reserviert heißt binnen einer Minute öffentlich. Die Lockerung bei
  // „positionen" darf diesen Weg nicht erreichen.
  const p = plan([
    { kind: 'reservieren', quote: '1 × 1.000 l – 750 € VB', positionIds: ['T-15'], confidence: 'erschlossen' },
  ], WALL)
  assert.equal(p.steps.find((x) => x.kind === 'reservieren'), undefined, 'nie im Ein-Knopf-Zug')
  const r = p.risky.find((x) => x.kind === 'reservieren')
  if (r) assert.equal(r.proven, false)
})

test('V10 · die Stückzahl deckelt auch den belegten Zweig', () => {
  // „1 × 1.650 l" mit drei Nummern hängte alle drei an — als belegt, ohne
  // Warnung. Die Stückzahl wurde nur im pick-Zweig gelesen.
  const p = plan([
    { kind: 'positionen', quote: '3 × 1.650 l – je 1.050 € VB', positionIds: ['T-17', 'T-18', 'T-19'], count: 1, confidence: 'erschlossen' },
  ], WALL)
  const s = step(p, 'positionen')
  assert.equal(s?.tankIds.length, 1)
  assert.equal(s?.proven, false, 'und es ist nicht mehr belegt')
  assert.match(s?.warning ?? '', /Gefragt 1, genannt 3/)
})

test('V11 · 29 Fässer kommen auch über den Preis nicht durch', () => {
  // Der Ausweg aus dem Deckel: alle 29 kosten 175 €, und „175 €" steht im Text.
  // Damit war `erschlossen` für jedes einzelne wahr.
  const alle = Array.from({ length: 29 }, (_, i) => `F-${String(i + 1).padStart(2, '0')}`)
  const text = 'Was soll ein Barriquefass 225 l kosten? In der Anzeige stehen 175 € VB.\nGruß, Martin Weber\nweber@example.org'
  const p = plan([
    { kind: 'positionen', quote: 'ein Barriquefass', positionIds: alle, count: 1, confidence: 'erschlossen' },
  ], text)
  const s = step(p, 'positionen')
  assert.ok((s?.tankIds.length ?? 0) <= 1, 'gefragt war eines')
  assert.notEqual(s?.proven, true)
})

test('V12 · eine Zahl ohne Währung daneben ist kein Preistreffer', () => {
  // T-20/T-21 kosten 1.650 €. Auf der Zeile „3 × 1.650 l – je 1.050 € VB" steht
  // ein €, und damit galt auch die Literzahl als Betrag — zwei Rundtanks, die
  // in der Nachricht nirgends vorkommen, wurden belegt angehängt.
  const p = plan([
    { kind: 'positionen', quote: '3 × 1.650 l – je 1.050 € VB', positionIds: ['T-20', 'T-21'], confidence: 'erschlossen' },
  ], WALL)
  assert.notEqual(step(p, 'positionen')?.proven, true)
})

test('V13 · reservierte Ware wird nicht wortlos angehängt', () => {
  const text = 'Ich nehme T-23.\nGruß, Martin Weber\nweber@example.org'
  const mit = { ...db, tanks: db.tanks.map((t) => (t.id === 'T-23' ? { ...t, status: 'reserviert' as const, leadId: 'L-fremd' } : t)) }
  const checked = checkProposals([{ kind: 'positionen', quote: 'Ich nehme T-23.', positionIds: ['T-23'], confidence: 'genannt' }], text, mit)
  const s = buildPlan(checked.proposals, parseMessage(text, mit), mit, text).steps.find((x) => x.kind === 'positionen')
  assert.match(s?.warning ?? '', /reserviert/i)
  assert.equal(s?.proven, false)
})

test('V14 · eine Nummer, die es nicht gibt, verschwindet nicht spurlos', () => {
  const p = plan([
    { kind: 'positionen', quote: '1 × 800 l – 650 € VB', positionIds: ['T-14', 'T-99'], confidence: 'genannt' },
  ], WALL)
  const s = step(p, 'positionen')
  assert.ok(s?.tankIds.includes('T-14'))
  assert.match(s?.warning ?? '', /T-99/)
})

test('V15 · „unklar" wird kein festes Gebot', () => {
  const text = 'Was halten Sie von 3.600 EUR?\nGruß, Martin Weber\nweber@example.org'
  const p = plan([{ kind: 'gebot', quote: 'Was halten Sie von 3.600 EUR?', amount: 3600, amountKind: 'unklar' }], text)
  assert.equal(step(p, 'gebot')?.proven, false)
})

test('V16 · reservieren greift nicht über die Bauart hinweg', () => {
  // 1.250 l haben T-07 und T-08 (Speidel, 900 €) und T-16 (Koffertank, 850 €).
  // `coversWholeGroup` verglich nur die Literzahl — und gab einen
  // Reservieren-Knopf über alle drei frei.
  const p = plan([
    { kind: 'reservieren', quote: '1 × 1.250 l – 850 € VB', positionIds: ['T-07', 'T-08', 'T-16'], confidence: 'genannt' },
  ], WALL)
  const r = p.risky.find((x) => x.kind === 'reservieren')
  assert.ok(!r || !r.tankIds.includes('T-07'), 'kein Speidel-Tank, den niemand genannt hat')
})
