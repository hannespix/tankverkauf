import type { Bundle, CatalogBundle, PriceTier } from '../types'

/**
 * Paketpreise.
 *
 * Zwei Mechaniken, eine Rechnung. Ein geschnürtes Paket ist eine feste Auswahl
 * mit einem Nachlass; die Mengenstaffel greift automatisch, sobald jemand mehrere
 * Positionen derselben Kategorie ankreuzt. Der Käufer bekommt immer die für ihn
 * bessere Variante — ein Paket, das teurer wäre als das Einzeln-Ankreuzen, wäre
 * genau die Art Angebot, die Vertrauen kostet.
 *
 * Alles hier ist reine Rechnung ohne Zugriff auf den Bestand: dieselbe Funktion
 * rechnet im Dashboard gegen die private Datenbank und auf der Käuferseite gegen
 * die veröffentlichte Liste.
 */

/** Was zum Rechnen von einer Position gebraucht wird — Tank wie CatalogItem erfüllen das. */
export interface Priced {
  id: string
  category: string
  vb: number
}

/**
 * Ein Preis, den ein Mensch nennen würde: 8.200, nicht 8.184. Grob gerundet wird
 * nur bei großen Summen — 8 % auf zwei Fässer sind 322 €, und die auf 300 zu
 * runden wäre in Wahrheit ein Nachlass von 14 %.
 */
export function nicePrice(n: number): number {
  const step = n >= 5000 ? 100 : n >= 1000 ? 50 : n >= 200 ? 10 : 5
  return Math.max(step, Math.round(n / step) * step)
}

/**
 * Ein Paket gegen den tatsächlich noch vorhandenen Bestand auflösen. Verkaufte
 * Positionen fallen einfach heraus, statt das Angebot ungültig zu machen — der
 * Preis rechnet sich aus dem, was übrig ist, mit demselben Nachlass.
 */
export function resolveBundle(bundle: Bundle, stock: Map<string, Priced>): CatalogBundle | null {
  if (!bundle.active) return null
  const gifts = bundle.giftIds.filter((id) => stock.has(id))
  const paid = bundle.ids.filter((id) => stock.has(id) && !bundle.giftIds.includes(id))
  if (paid.length < Math.max(1, bundle.minItems)) return null

  const paidSum = paid.reduce((a, id) => a + (stock.get(id)?.vb ?? 0), 0)
  const giftSum = gifts.reduce((a, id) => a + (stock.get(id)?.vb ?? 0), 0)
  const price = nicePrice(paidSum * (1 - bundle.discount))
  // Ein Paket ohne Vorteil ist kein Paket. Das passiert, wenn von einem großen
  // Angebot nur noch eine Position übrig ist und der Rundungsschritt den Nachlass
  // auffrisst.
  if (price >= paidSum + giftSum) return null

  return { id: bundle.id, label: bundle.label, blurb: bundle.blurb, ids: paid, giftIds: gifts, full: paidSum + giftSum, price }
}

/** Die Staffelstufe, die bei dieser Stückzahl greift — die höchste erreichte. */
export function tierFor(tiers: PriceTier[], category: string, count: number): PriceTier | null {
  return tiers
    .filter((t) => t.category === category && count >= t.minCount && t.discount > 0)
    .reduce<PriceTier | null>((best, t) => (!best || t.minCount > best.minCount ? t : best), null)
}

/** Die nächste Stufe, die der Käufer noch erreichen kann. */
export function nextTier(tiers: PriceTier[], category: string, count: number): PriceTier | null {
  return tiers
    .filter((t) => t.category === category && count < t.minCount && t.discount > 0)
    .reduce<PriceTier | null>((best, t) => (!best || t.minCount < best.minCount ? t : best), null)
}

/** Ein Teil der Rechnung: entweder ein geschnürtes Paket oder eine Staffelstufe. */
export interface PricePart {
  /** Paket-Id, oder null für die Mengenstaffel. */
  bundleId: string | null
  label: string
  ids: string[]
  giftIds: string[]
  full: number
  price: number
}

/**
 * Was der Käufer als Nächstes erreichen könnte. Ein fast vollständiges Paket geht
 * vor: dass 31 Fässer 5.500 € kosten und 32 nur 5.400 €, sieht ohne diesen Hinweis
 * nach einem Rechenfehler aus statt nach einem Angebot.
 */
export type NextStep =
  | { kind: 'tier'; category: string; minCount: number; missing: number; discount: number }
  | { kind: 'bundle'; bundleId: string; label: string; missing: string[]; price: number; full: number }

export interface Pricing {
  /** Summe der Einzelpreise. */
  full: number
  /** Was mit Paketen und Staffel zu zahlen wäre. */
  price: number
  saved: number
  parts: PricePart[]
  next: NextStep | null
}

const sum = (items: Priced[]) => items.reduce((a, i) => a + i.vb, 0)

/** Die Mengenstaffel auf eine Menge anwenden, je Kategorie getrennt. */
function tierParts(items: Priced[], tiers: PriceTier[], categoryLabel: (id: string) => string): PricePart[] {
  const byCat = new Map<string, Priced[]>()
  for (const i of items) byCat.set(i.category, [...(byCat.get(i.category) ?? []), i])
  const parts: PricePart[] = []
  for (const [category, group] of byCat) {
    const base = sum(group)
    const tier = tierFor(tiers, category, group.length)
    if (!tier) continue
    const price = nicePrice(base * (1 - tier.discount))
    if (price >= base) continue
    parts.push({
      bundleId: null,
      label: `${group.length} × ${categoryLabel(category)}`,
      ids: group.map((i) => i.id),
      giftIds: [],
      full: base,
      price,
    })
  }
  return parts
}

const totalOf = (chosen: Priced[], parts: PricePart[]) => {
  const inParts = new Set(parts.flatMap((p) => [...p.ids, ...p.giftIds]))
  return parts.reduce((a, p) => a + p.price, 0) + sum(chosen.filter((i) => !inParts.has(i.id)))
}

/**
 * Was die Auswahl kostet.
 *
 * Zwei Wege werden gerechnet und der günstigere gewinnt: einmal mit den
 * geschnürten Paketen und der Staffel auf dem Rest, einmal nur mit der Staffel.
 * Beides ist nötig, weil ein angewandtes Paket seine Positionen aus der Zählung
 * nimmt und den Rest damit eine Staffelstufe tiefer fallen lassen kann — wer alle
 * 21 Tanks ankreuzt, zahlte sonst mehr als jemand, der dasselbe ohne Pakete tut.
 */
export function priceSelection(
  chosen: Priced[],
  bundles: CatalogBundle[],
  tiers: PriceTier[],
  categoryLabel: (id: string) => string,
  /** Der ganze Bestand. Nur damit kann der Hinweis auf ein fast volles Paket
   *  durchgerechnet werden; ohne ihn bleibt es bei der Staffel. */
  stock?: Map<string, Priced>,
): Pricing {
  const full = sum(chosen)
  const picked = new Set(chosen.map((i) => i.id))
  const claimed = new Set<string>()
  const bundleParts: PricePart[] = []

  // Ein Paket zählt nur, wenn wirklich alles darin angekreuzt ist. Wer die Hälfte
  // nimmt, bekommt den Paketpreis nicht — sonst wäre es kein Paket.
  const applicable = bundles
    .filter((b) => [...b.ids, ...b.giftIds].every((id) => picked.has(id)))
    .sort((a, b) => b.full - b.price - (a.full - a.price))

  for (const b of applicable) {
    const all = [...b.ids, ...b.giftIds]
    if (all.some((id) => claimed.has(id))) continue
    all.forEach((id) => claimed.add(id))
    bundleParts.push({ bundleId: b.id, label: b.label, ids: b.ids, giftIds: b.giftIds, full: b.full, price: b.price })
  }

  const withBundles = [...bundleParts, ...tierParts(chosen.filter((i) => !claimed.has(i.id)), tiers, categoryLabel)]
  const laddersOnly = tierParts(chosen, tiers, categoryLabel)
  const parts = totalOf(chosen, laddersOnly) < totalOf(chosen, withBundles) ? laddersOnly : withBundles
  const price = totalOf(chosen, parts)

  // Die nächste erreichbare Staffelstufe, aber nur die knappste: zwei Hinweise
  // nebeneinander lesen sich wie eine Aufforderung, nicht wie ein Angebot.
  const used = new Set(parts.flatMap((p) => [...p.ids, ...p.giftIds]))
  const counts = new Map<string, number>()
  for (const i of chosen) if (!used.has(i.id) || parts.some((p) => p.bundleId === null && p.ids.includes(i.id))) {
    counts.set(i.category, (counts.get(i.category) ?? 0) + 1)
  }
  let next: NextStep | null = null
  for (const [category, count] of counts) {
    const up = nextTier(tiers, category, count)
    if (!up) continue
    const missing = up.minCount - count
    // Es nützt nichts, nach zwei weiteren Fässern zu fragen, wenn nur noch eines
    // dasteht. Ohne Bestandsliste wird der Hinweis nicht geprüft und entfällt.
    if (stock) {
      const spare = [...stock.values()].filter((i) => i.category === category && !picked.has(i.id)).length
      if (spare < missing) continue
    }
    if (!next || (next.kind === 'tier' && missing < next.missing)) {
      next = { kind: 'tier', category, minCount: up.minCount, missing, discount: up.discount }
    }
  }

  // Ein Paket, dem nur ein, zwei Positionen fehlen, ist der konkretere Hinweis und
  // verdrängt die Staffel: dass 31 Fässer 5.500 € kosten und 32 nur 5.400 €, sieht
  // ohne diesen Satz nach einem Rechenfehler aus. Ob es sich wirklich lohnt, wird
  // nicht überschlagen, sondern durchgerechnet — die Staffel für den Rest der
  // Auswahl verschiebt sich dabei ja mit.
  let best: NextStep | null = null
  let bestPrice = Infinity
  if (stock) {
    for (const b of bundles) {
      const all = [...b.ids, ...b.giftIds]
      const missing = all.filter((id) => !picked.has(id))
      if (missing.length === 0 || missing.length > 2 || missing.length >= all.length) continue
      if (missing.some((id) => !stock.has(id))) continue
      const bigger = [...chosen, ...missing.map((id) => stock.get(id)!)]
      const would = priceSelection(bigger, bundles, tiers, categoryLabel)
      // Gleicher Preis zählt auch: bei einer Zugabe bekommt der Käufer für dasselbe
      // Geld mehr, und genau das soll er erfahren, statt es zu übersehen.
      if (would.price > price) continue
      if (would.price < bestPrice) {
        bestPrice = would.price
        best = { kind: 'bundle', bundleId: b.id, label: b.label, missing, price: would.price, full: would.full }
      }
    }
  }

  return { full, price, saved: full - price, parts, next: best ?? next }
}
