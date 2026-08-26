import type { DB, Deal, Lead, Maker, Quote, Tank, TankStatus } from '../types'

export interface Totals {
  count: number
  litres: number
  vb: number
  target: number
  floor: number
}

export const emptyTotals = (): Totals => ({ count: 0, litres: 0, vb: 0, target: 0, floor: 0 })

export function totals(tanks: Tank[]): Totals {
  return tanks.reduce<Totals>((acc, t) => {
    acc.count += 1
    acc.litres += t.litres
    acc.vb += t.vb
    acc.target += t.target
    acc.floor += t.floor
    return acc
  }, emptyTotals())
}

export const isSold = (t: Tank) => t.status === 'verkauft'
/**
 * Im Verkauf und noch zu haben. „In Vorbereitung" ist ausdrücklich NICHT offen:
 * die Position existiert nur im Bestand — Katalog, Anzeigen, Pakete und alle
 * Kennzahlen des laufenden Verkaufs sehen sie nicht. Achtung bei Negationen:
 * `!isOpen` heißt seit diesem Status „verkauft ODER in Vorbereitung" — wer
 * Verkauftes meint, nimmt `isSold`.
 */
export const isOpen = (t: Tank) => t.status !== 'verkauft' && t.status !== 'vorbereitung'

/**
 * Revenue actually booked. A tank that belongs to a deal contributes through the
 * deal's total price (counted once), never through its own offer — otherwise a
 * three-tank bundle would be counted three times.
 */
export function revenue(db: DB): number {
  const counted = new Set<string>()
  let total = 0
  for (const deal of db.deals) {
    const anySold = deal.tankIds.some((id) => db.tanks.find((t) => t.id === id)?.status === 'verkauft')
    if (!anySold) continue
    total += deal.price
    deal.tankIds.forEach((id) => counted.add(id))
  }
  for (const t of db.tanks) {
    if (t.status === 'verkauft' && !counted.has(t.id)) total += t.offer ?? 0
  }
  return total
}

/** Best offer currently on the table across tanks that are not yet sold. */
export function pipelineValue(db: DB): number {
  return db.tanks.filter((t) => isOpen(t) && t.offer != null).reduce((a, t) => a + (t.offer ?? 0), 0)
}

export function byStatus(tanks: Tank[]): Record<TankStatus, Tank[]> {
  const out: Record<TankStatus, Tank[]> = { verfuegbar: [], kontakt: [], reserviert: [], verkauft: [], vorbereitung: [] }
  for (const t of tanks) out[t.status].push(t)
  return out
}

export function byMaker(tanks: Tank[]): { maker: Maker; tanks: Tank[] }[] {
  const order: Maker[] = ['Möschle', 'Speidel', 'Clemens', 'Sonstige']
  return order
    .map((maker) => ({ maker, tanks: tanks.filter((t) => t.maker === maker) }))
    .filter((g) => g.tanks.length > 0)
}

/** How an offer compares to the tank's own price ladder. Drives the colour coding. */
export type OfferVerdict = 'ueber-vb' | 'gut' | 'ok' | 'unter-limit' | null

export function judgeOffer(tank: Tank, offer: number | null | undefined): OfferVerdict {
  if (offer == null || offer <= 0) return null
  if (offer >= tank.vb) return 'ueber-vb'
  if (offer >= tank.target) return 'gut'
  if (offer >= tank.floor) return 'ok'
  return 'unter-limit'
}

export const VERDICT_LABEL: Record<Exclude<OfferVerdict, null>, string> = {
  'ueber-vb': 'auf VB-Niveau',
  gut: 'über Zielpreis',
  ok: 'im Verhandlungsrahmen',
  'unter-limit': 'unter Untergrenze',
}

export function dealOf(db: DB, tank: Tank): Deal | null {
  return tank.dealId ? (db.deals.find((d) => d.id === tank.dealId) ?? null) : null
}

/** Progress of the whole liquidation, by value and by volume. */
export function progress(db: DB) {
  // Gemessen wird der VERKAUF: verkauft plus noch zu haben. Was in Vorbereitung
  // steht, gehört noch nicht dazu — sonst gälte all ≠ sold + open, und die
  // Übersicht wie der Excel-Export ließen eine Restmenge unerklärt.
  const all = totals(db.tanks.filter((t) => t.status !== 'vorbereitung'))
  const sold = totals(db.tanks.filter(isSold))
  const open = totals(db.tanks.filter(isOpen))
  return {
    all,
    sold,
    open,
    revenue: revenue(db),
    litresPct: all.litres ? sold.litres / all.litres : 0,
    countPct: all.count ? sold.count / all.count : 0,
  }
}

/**
 * The price of one position inside one quote.
 *
 * THE single place that resolves it. A negotiated price lives on the quote; an
 * untouched position keeps the stock VB. Every reader — the card, the sum, the
 * offer mail, the AI reply draft — goes through here, because a second copy of
 * this rule is a second chance to show the buyer a different number than the
 * one we booked.
 *
 * Guards against a stored `null`, a string from a hand-edited db.json and NaN:
 * all of them would poison a sum silently.
 */
export function linePrice(quote: Pick<Quote, 'prices'>, tank: Tank): number {
  const set = quote.prices?.[tank.id]
  return typeof set === 'number' && Number.isFinite(set) && set >= 0 ? set : tank.vb
}

/** Sum of the line prices — what the positions cost when bought one by one. */
export function lineSum(quote: Pick<Quote, 'prices'>, tanks: Tank[]): number {
  return tanks.reduce((a, t) => a + linePrice(quote, t), 0)
}

/** Everything a quote is worth, measured against the tanks it bundles. */
export interface QuoteMetrics extends Totals {
  askPrice: number
  buyerOffer: number | null
  /** Discount of the asking price against the sum of individual VB. */
  discount: number
  discountPct: number
  /** How the decisive number compares to the sum of the floors. */
  verdict: OfferVerdict
  /** The number to judge: the buyer's offer if there is one, otherwise our ask. */
  decisive: number
  /**
   * Sum of the negotiated line prices. Equals `vb` while no line was touched,
   * which is why nothing that only reads `vb` broke when this arrived.
   */
  lines: number
  /** What the bundle price takes off the line sum. Negative means a surcharge. */
  bundleOff: number
  /** Positions priced below their own floor — each one by name. */
  underFloor: string[]
}

export function quoteMetrics(
  db: DB,
  tankIds: string[],
  askPrice: number,
  buyerOffer: number | null,
  prices?: Quote['prices'],
): QuoteMetrics {
  const tanks = tankIds.map((id) => db.tanks.find((t) => t.id === id)).filter((t): t is Tank => Boolean(t))
  const base = totals(tanks)
  const decisive = buyerOffer ?? askPrice
  const discount = base.vb - askPrice
  const lines = lineSum({ prices }, tanks)
  return {
    ...base,
    askPrice,
    buyerOffer,
    discount,
    discountPct: base.vb ? discount / base.vb : 0,
    decisive,
    verdict: judgeBundle(base, decisive),
    lines,
    bundleOff: lines - askPrice,
    underFloor: tanks.filter((t) => linePrice({ prices }, t) < t.floor).map((t) => t.id),
  }
}

/** Same ladder as a single tank, but against the summed prices of the bundle. */
export function judgeBundle(base: Totals, price: number): OfferVerdict {
  if (!price || price <= 0) return null
  if (price >= base.vb) return 'ueber-vb'
  if (price >= base.target) return 'gut'
  if (price >= base.floor) return 'ok'
  return 'unter-limit'
}

/**
 * Die offenen Angebote eines Interessenten, neueste zuerst.
 *
 * Vier Stellen im Werkzeug suchten „das“ Angebot mit einem nackten `.find()`
 * und trafen damit stillschweigend das zuletzt angelegte — `createQuote` schiebt
 * vorn ein. Wer zwei Angebote hat, bekam Gebote am falschen vermerkt.
 * Angenommen und abgelehnt zählen nicht: daran ist nichts mehr zu verhandeln.
 */
export function openQuotesOf(db: DB, leadId: string | null): Quote[] {
  if (!leadId) return []
  // Nach Datum, nicht nach Einfügereihenfolge: `createQuote` schiebt vorn ein,
  // aber ein Statuswechsel weiter hinten verschob damit still, welches Angebot
  // als „das" gilt — Gebote und die beiden Abgleich-Knöpfe hätten danach
  // unverändert ausgesehen und ein anderes Angebot getroffen.
  return db.quotes
    .filter((q) => q.leadId === leadId && q.status !== 'abgelehnt' && q.status !== 'angenommen')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))
}

/**
 * Wie Auswahl und Angebot zueinander stehen, in einem Satzteil.
 *
 * „2 von 1 Position“ stand da, solange das Angebot für eine Teilmenge der
 * Auswahl gehalten wurde. Es ist keine: über `setQuoteTanks` kommt eine
 * Position ins Angebot, ohne dass sie je in der Auswahl stand.
 */
export function quoteRelation(quoteIds: string[], pickedIds: string[]): string {
  const onlyQuote = quoteIds.filter((id) => !pickedIds.includes(id))
  const onlyPicked = pickedIds.filter((id) => !quoteIds.includes(id))
  if (onlyQuote.length === 0 && onlyPicked.length === 0) return 'deckungsgleich'
  if (onlyQuote.length === 0) {
    return `${quoteIds.length} von ${pickedIds.length} ${pickedIds.length === 1 ? 'Position' : 'Positionen'} im Angebot`
  }
  return [
    onlyQuote.length ? `${onlyQuote.length} nur im Angebot` : '',
    onlyPicked.length ? `${onlyPicked.length} nur in der Auswahl` : '',
  ].filter(Boolean).join(', ')
}

// ------------------------------------------------------- Bescheid geben

export interface DueWatch {
  lead: Lead
  tank: Tank
  /** Verkauft an jemand anderen — dann ist die Aufgabe eine Absage, kein Zuruf. */
  sold: boolean
}

/**
 * Fällige Bescheid-Wünsche: der Mensch wollte informiert werden, sobald die
 * Position in den Verkauf geht — und sie ist nicht mehr in Vorbereitung.
 *
 * Berechnet, nicht gespeichert: es gibt kein Ereignis, das man verpassen, und
 * keinen Merker, der beim Abgleich zweier Geräte streiten könnte. Die Karte
 * verschwindet, wenn der Eintrag gelöscht wird — von Hand oder von selbst,
 * sobald ein Angebot oder Verkauf dieses Menschen die Position enthält.
 * Einträge auf gelöschte Positionen räumt removeTank ab; falls doch einer
 * durchrutscht, fällt er hier still heraus statt eine Geisterkarte zu tragen.
 */
export function dueWatches(db: DB): DueWatch[] {
  const out: DueWatch[] = []
  for (const lead of db.leads) {
    for (const w of lead.watch ?? []) {
      const tank = db.tanks.find((t) => t.id === w.tankId)
      if (!tank || tank.status === 'vorbereitung') continue
      out.push({ lead, tank, sold: tank.status === 'verkauft' })
    }
  }
  return out
}
