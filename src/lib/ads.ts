import type { Ad, AdScope, DB, Maker, Portal, Tank } from '../types'
import { eur, eurExact, centsPerLitre, netOf, num } from './format'
import { isOpen, totals } from './stats'

/** Fallback when a portal was deleted but an ad still points at it. */
export const FALLBACK_LIMITS = { title: 65, body: 4000 }

export function portalOf(db: DB, portalId: string): Portal | null {
  return db.settings.portals.find((p) => p.id === portalId) ?? null
}

export function limitsOf(portal: Portal | null) {
  return portal ? { title: portal.titleLimit, body: portal.bodyLimit } : FALLBACK_LIMITS
}

export interface GeneratedAd {
  title: string
  body: string
  price: number
  priceType: 'VB' | 'Festpreis'
  tankIds: string[]
  /** Fingerprint of the inventory this text describes. */
  stamp: string
}

export const SCOPE_LABEL: Record<AdScope['kind'], string> = {
  paket: 'Tank-Komplettpaket',
  faesser: 'Holzfässer',
  maker: 'Hersteller-Bundle',
  tank: 'Einzelner Tank',
  restposten: 'Restposten (Kurzfassung)',
  custom: 'Freier Text',
}

function tanksInScope(db: DB, scope: AdScope): Tank[] {
  const open = db.tanks.filter(isOpen)
  switch (scope.kind) {
    case 'paket':
    case 'restposten':
      // Barrels sell to gardeners, tanks to winemakers — never in one package price.
      return open.filter((t) => t.category === 'tank')
    case 'faesser':
      return open.filter((t) => t.category === 'fass')
    case 'maker':
      return open.filter((t) => t.maker === scope.maker)
    case 'tank':
      return db.tanks.filter((t) => t.id === scope.tankId)
    default:
      return []
  }
}

interface Group {
  maker: Maker
  type: string
  litres: number
  count: number
  vb: number
}

function group(tanks: Tank[]): Group[] {
  const map = new Map<string, Group>()
  for (const t of tanks) {
    const key = `${t.maker}|${t.type}|${t.litres}|${t.vb}`
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { maker: t.maker, type: t.type, litres: t.litres, count: 1, vb: t.vb })
  }
  return [...map.values()].sort((a, b) => b.litres - a.litres)
}

const label = (g: Group) => (g.maker === 'Sonstige' ? g.type : `${g.maker} ${g.type}`)

const bullet = (g: Group) =>
  `• ${g.count}× ${label(g)} ${num(g.litres)} l – je ${eur(g.vb)}`

/** A fingerprint that changes whenever the ad's facts change. */
export function stampOf(tanks: Tank[], price: number): string {
  const ids = tanks.map((t) => `${t.id}:${t.vb}`).sort().join(',')
  return `${price}|${ids}`
}

function priceBlock(db: DB, sum: number, packagePrice: number, litresTotal: number, fach: boolean): string {
  const saving = sum - packagePrice
  const vatPct = Math.round(db.settings.vatRate * 100)
  const lines = [
    'PREIS',
    `Komplettabnahme: ${eur(packagePrice)} VB (brutto inkl. ${vatPct} % MwSt.)`,
  ]
  if (fach) {
    // A business buyer budgets net and needs the VAT shown separately to deduct it.
    lines.push(`Netto ${eurExact(netOf(packagePrice, db.settings.vatRate))} zzgl. ${vatPct} % MwSt.`)
  }
  lines.push(
    `Das entspricht ${centsPerLitre(packagePrice, litresTotal)} — gegenüber Einzelabgabe (${eur(sum)}) ${eur(saving)} günstiger.`,
    'Einzelabgabe ist möglich, Preise siehe Liste oben.',
  )
  if (fach) lines.push('Die Umsatzsteuer wird auf der Rechnung separat ausgewiesen.')
  return lines.join('\n')
}

const conditionBlock = [
  'ZUSTAND',
  'Gebraucht, technisch in Ordnung, dicht. Keine Kühlung.',
  'Restabläufe teilweise vorhanden. Besichtigung jederzeit möglich.',
].join('\n')

function pickupBlock(db: DB): string {
  const s = db.settings.seller
  const where = [s.plz, s.location].filter(Boolean).join(' ')
  return ['ABHOLUNG', s.pickupInfo, where ? `Standort: ${where}` : ''].filter(Boolean).join('\n')
}

export function generateAd(db: DB, scope: AdScope, portal: Portal | null): GeneratedAd {
  const tanks = tanksInScope(db, scope)
  const t = totals(tanks)
  const s = db.settings
  const groups = group(tanks)
  const sellerName = s.seller.name || 'Betriebsauflösung'
  const lim = limitsOf(portal)
  const fach = portal?.style === 'fach'

  if (scope.kind === 'tank') {
    const tank = tanks[0]
    if (!tank) {
      return { title: '', body: 'Tank nicht gefunden.', price: 0, priceType: 'VB', tankIds: [], stamp: '' }
    }
    const name = tank.maker === 'Sonstige' ? tank.type : `${tank.maker} ${tank.type}`
    const title = trim(`${name} ${num(tank.litres)} l Edelstahl Weintank`, lim.title)
    const body = [
      `${name} mit ${num(tank.litres)} Litern aus Betriebsauflösung abzugeben.`,
      '',
      'DATEN',
      `• Hersteller/Typ: ${name}`,
      `• Volumen: ${num(tank.litres)} l`,
      `• Preis: ${eur(tank.vb)} VB (brutto inkl. ${Math.round(s.vatRate * 100)} % MwSt.)`,
      `• Preis je Liter: ${centsPerLitre(tank.vb, tank.litres)}`,
      '',
      conditionBlock,
      '',
      pickupBlock(db),
      '',
      s.ad.signature,
    ]
      .filter((l) => l !== undefined)
      .join('\n')
    return { title, body: trim(body, lim.body), price: tank.vb, priceType: 'VB', tankIds: [tank.id], stamp: stampOf(tanks, tank.vb) }
  }

  if (scope.kind === 'maker') {
    const maker = scope.maker ?? 'Sonstige'
    const title = trim(`${t.count} ${maker} Edelstahltanks ${num(t.litres)} l Weintank Lagertank`, lim.title)
    const body = [
      `${t.count} ${maker}-Edelstahltanks mit zusammen ${num(t.litres)} Litern aus Betriebsauflösung.`,
      '',
      'BESTAND',
      ...groups.map(bullet),
      '',
      'PREIS',
      `Einzelabgabe zu den genannten Preisen, Summe ${eur(t.vb)} VB.`,
      'Bei Abnahme mehrerer Tanks Preisnachlass — einfach anfragen.',
      '',
      conditionBlock,
      '',
      pickupBlock(db),
      '',
      s.ad.signature,
    ].join('\n')
    return { title, body: trim(body, lim.body), price: t.vb, priceType: 'VB', tankIds: tanks.map((x) => x.id), stamp: stampOf(tanks, t.vb) }
  }

  if (scope.kind === 'faesser') {
    // Deco buyers care about look, size and what fits in the garden, not cellar specs.
    const perPiece = groups.map((g) => `• ${g.count}× ${g.type} ${num(g.litres)} l – je ${eur(g.vb)}`)
    const title = trim(`${t.count} Weinfässer Eiche ${groups.map((g) => `${num(g.litres)} l`).join(' / ')} Dekofass Regentonne`, lim.title)
    const body = [
      `${t.count} gebrauchte Eichenfässer aus dem eigenen Keller abzugeben — ${sellerName}, Betriebsauflösung.`,
      '',
      'BESTAND',
      ...perPiece,
      '',
      'ZUSTAND',
      'Original Weinfässer, gebraucht, gewachsen im Einsatz. Holz dicht, Reifen fest.',
      'Nicht geschliffen und nicht behandelt — genau so, wie sie aus dem Keller kommen.',
      '',
      'VERWENDUNG',
      'Als Deko im Garten oder Hof, Stehtisch, Pflanzkübel, Regentonne oder Möbelprojekt.',
      '',
      'PREIS',
      `Einzeln zu den genannten Preisen. Bei Abnahme mehrerer Fässer deutlicher Nachlass — die ganze Partie (${t.count} Stück) auf Anfrage.`,
      `Alle Preise brutto inkl. ${Math.round(s.vatRate * 100)} % MwSt.`,
      '',
      pickupBlock(db),
      '',
      s.ad.signature,
    ].join('\n')
    return { title, body: trim(body, lim.body), price: groups[0]?.vb ?? 0, priceType: 'VB', tankIds: tanks.map((x) => x.id), stamp: stampOf(tanks, groups[0]?.vb ?? 0) }
  }

  if (scope.kind === 'restposten') {
    const title = trim(`${t.count} Edelstahltanks ${num(t.litres)} l — Betriebsauflösung Weingut`, lim.title)
    const body = [
      `Wegen Betriebsauflösung: ${t.count} Edelstahltanks, zusammen ${num(t.litres)} Liter.`,
      '',
      ...groups.map(bullet),
      '',
      `Komplett: ${eur(s.packagePrice)} VB brutto (${centsPerLitre(s.packagePrice, t.litres)}). Einzelabgabe möglich.`,
      s.seller.pickupInfo,
    ].join('\n')
    return { title, body: trim(body, lim.body), price: s.packagePrice, priceType: 'VB', tankIds: tanks.map((x) => x.id), stamp: stampOf(tanks, s.packagePrice) }
  }

  // Komplettpaket
  const makerList = [...new Set(groups.map((g) => g.maker))].filter((m) => m !== 'Sonstige').join(', ')
  const title = trim(
    fach
      ? `Betriebsauflösung: ${t.count} Edelstahltanks, ${num(t.litres)} l gesamt${makerList ? ` — ${makerList}` : ''}`
      : `${t.count} Edelstahltanks ${num(t.litres)} l Weintank Lagertank Betriebsauflösung`,
    lim.title,
  )
  const body = [
    fach ? `${sellerName} — Betriebsauflösung, kompletter Edelstahltank-Bestand` : `${sellerName} — Betriebsauflösung`,
    '',
    fach
      ? `${t.count} Tanks mit zusammen ${num(t.litres)} Litern aus laufendem Kellerbetrieb. Abgabe komplett oder einzeln.`
      : `Wegen Aufgabe des Betriebs verkaufe ich meinen kompletten Edelstahltank-Bestand: ${t.count} Tanks mit insgesamt ${num(t.litres)} Litern Volumen.`,
    '',
    'BESTAND',
    ...groups.map(bullet),
    '',
    priceBlock(db, t.vb, s.packagePrice, t.litres, fach),
    '',
    conditionBlock,
    '',
    pickupBlock(db),
    '',
    s.ad.signature,
  ].join('\n')

  return {
    title,
    body: trim(body, lim.body),
    price: s.packagePrice,
    priceType: 'VB',
    tankIds: tanks.map((x) => x.id),
    stamp: stampOf(tanks, s.packagePrice),
  }
}

function trim(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export interface AdDrift {
  stale: boolean
  soldSince: Tank[]
  priceChanged: { from: number; to: number } | null
  countNow: number
  countThen: number
}

/** What has changed in reality since this ad was last published. */
export function adDrift(db: DB, ad: Ad): AdDrift {
  const fresh = generateAd(db, ad.scope, portalOf(db, ad.portalId))
  const soldSince = ad.tankIds
    .map((id) => db.tanks.find((t) => t.id === id))
    .filter((t): t is Tank => Boolean(t) && t!.status === 'verkauft')
  return {
    stale: ad.stamp !== fresh.stamp,
    soldSince,
    priceChanged: ad.price !== fresh.price ? { from: ad.price, to: fresh.price } : null,
    countNow: fresh.tankIds.length,
    countThen: ad.tankIds.length,
  }
}

// ------------------------------------------------------- incoming messages

export interface ParsedMessage {
  name: string
  phone: string
  email: string
  litresMentioned: number[]
  matchedTankIds: string[]
}

/**
 * Kleinanzeigen has no API for private sellers, so incoming enquiries arrive as
 * text. Pasting one here pulls out the bits worth keeping instead of retyping them.
 */
export function parseMessage(text: string, db: DB): ParsedMessage {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] ?? ''
  const phoneRaw = text.match(/(?:\+49|0)[\d\s/().-]{7,}\d/)?.[0] ?? ''
  const phone = phoneRaw.replace(/[^\d+]/g, '').replace(/^(\+49)/, '+49 ')

  const litresMentioned = [...text.matchAll(/\b(\d{3,4})(?:[.,](\d{3}))?\s*(?:l\b|liter)/gi)]
    .map((m) => Number(m[2] ? `${m[1]}${m[2]}` : m[1]))
    .filter((n) => n >= 100 && n <= 20000)
  const bare = [...text.matchAll(/\b(\d\.\d{3})\b/g)].map((m) => Number(m[1].replace('.', '')))
  const all = [...new Set([...litresMentioned, ...bare])]

  const matchedTankIds = db.tanks.filter((t) => all.includes(t.litres) && isOpen(t)).map((t) => t.id)

  // Signature heuristic: a short, capitalised line near the end that is not a greeting.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const stop = /^(hallo|hi|guten|sehr|mit freundlichen|viele grüße|liebe|mfg|lg|danke|gruß|grüße)/i
  const name =
    [...lines].reverse().find((l) => l.length >= 3 && l.length <= 40 && !stop.test(l) && /^[A-ZÄÖÜ]/.test(l) && !/[.?!:]$/.test(l) && l.split(/\s+/).length <= 4) ?? ''

  return { name, phone, email, litresMentioned: all, matchedTankIds }
}
