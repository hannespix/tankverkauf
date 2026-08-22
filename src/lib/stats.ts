import type { DB, Deal, Maker, Tank, TankStatus } from '../types'

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
export const isOpen = (t: Tank) => t.status !== 'verkauft'

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
  const out: Record<TankStatus, Tank[]> = { verfuegbar: [], kontakt: [], reserviert: [], verkauft: [] }
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
  const all = totals(db.tanks)
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
}

export function quoteMetrics(db: DB, tankIds: string[], askPrice: number, buyerOffer: number | null): QuoteMetrics {
  const tanks = tankIds.map((id) => db.tanks.find((t) => t.id === id)).filter((t): t is Tank => Boolean(t))
  const base = totals(tanks)
  const decisive = buyerOffer ?? askPrice
  const discount = base.vb - askPrice
  return {
    ...base,
    askPrice,
    buyerOffer,
    discount,
    discountPct: base.vb ? discount / base.vb : 0,
    decisive,
    verdict: judgeBundle(base, decisive),
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
