import type { Ad, AdScope, DB, Maker, Portal, Tank } from '../types'
import { dims as fmtDims, eur, eurExact, centsPerLitre, netOf, num } from './format'
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
  paket: 'Komplettpaket',
  kategorie: 'Ganze Kategorie',
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
      // Only what the settings mark as part of the package — barrels and machines
      // sell to entirely different people than the tanks do.
      return open.filter((t) => db.settings.categories.find((c) => c.id === t.category)?.inPackage)
    case 'kategorie':
      return open.filter((t) => t.category === scope.category)
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
  /** Features every item in this group shares. */
  tags: string[]
  /** Same shape and volume means the same measurements — carry them along. */
  dims: Tank['dims']
}

function group(tanks: Tank[]): Group[] {
  const map = new Map<string, Group>()
  for (const t of tanks) {
    const key = `${t.maker}|${t.type}|${t.litres}|${t.vb}`
    const hit = map.get(key)
    if (hit) {
      hit.count += 1
      // Only keep features that every item in the group actually has.
      hit.tags = hit.tags.filter((tag) => t.tags.includes(tag))
    } else {
      map.set(key, { maker: t.maker, type: t.type, litres: t.litres, count: 1, vb: t.vb, tags: [...t.tags], dims: t.dims })
    }
  }
  return [...map.values()].sort((a, b) => b.litres - a.litres)
}

const label = (g: Group) => (g.maker === 'Sonstige' ? g.type : `${g.maker} ${g.type}`)

const bullet = (g: Group, shared: string[] = []) => {
  const extra = g.tags.filter((t) => !shared.includes(t))
  // The size decides whether a buyer can get it through the door and onto a
  // trailer — it belongs on the line itself, not in a footnote.
  const size = fmtDims(g.dims)
  return `• ${g.count}× ${label(g)} ${num(g.litres)} l${size ? ` · ${size}` : ''} – je ${eur(g.vb)}${extra.length ? ` (${extra.join(', ')})` : ''}`
}

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

/**
 * Features shared by every advertised item become one AUSSTATTUNG block —
 * claiming "stapelbar" for the lot is only honest if it holds for all of them.
 */
function sharedFeatures(tanks: Tank[]): string[] {
  if (tanks.length === 0) return []
  return tanks[0].tags.filter((tag) => tanks.every((t) => t.tags.includes(tag)))
}

function featureBlock(tanks: Tank[]): string[] {
  const shared = sharedFeatures(tanks)
  return shared.length > 0 ? ['AUSSTATTUNG', ...shared.map((f) => `• ${f}`), ''] : []
}

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
    // Without a maker's plate the shape is the name, so the word buyers actually
    // search for has to come from the title instead.
    const title = trim(`${name} ${num(tank.litres)} l Edelstahl Weintank Lagertank`, lim.title)
    const body = [
      `${name} mit ${num(tank.litres)} Litern aus Betriebsauflösung abzugeben.`,
      '',
      'DATEN',
      `• Hersteller/Typ: ${name}`,
      `• Volumen: ${num(tank.litres)} l`,
      fmtDims(tank.dims) ? `• Maße: ${fmtDims(tank.dims)}` : undefined,
      `• Preis: ${eur(tank.vb)} VB (brutto inkl. ${Math.round(s.vatRate * 100)} % MwSt.)`,
      `• Preis je Liter: ${centsPerLitre(tank.vb, tank.litres)}`,
      '',
      ...featureBlock([tank]),
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
    // Most tanks here carry no maker's plate at all. "6 Sonstige Edelstahltanks"
    // would read like a filler word in the headline, so the brand simply drops out.
    const named = maker && maker !== 'Sonstige' ? `${maker} ` : ''
    const title = trim(`${t.count} ${named}Edelstahltanks ${num(t.litres)} l Weintank Lagertank`, lim.title)
    const body = [
      `${t.count} ${named ? `${maker}-Edelstahltanks` : 'Edelstahltanks'} mit zusammen ${num(t.litres)} Litern aus Betriebsauflösung.`,
      '',
      'BESTAND',
      ...groups.map((g) => bullet(g, sharedFeatures(tanks))),
      '',
      ...featureBlock(tanks),
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

  if (scope.kind === 'kategorie') {
    const cat = db.settings.categories.find((c) => c.id === scope.category)
    const volume = cat?.hasVolume ?? false
    const isBarrel = scope.category === 'fass'
    const shared = sharedFeatures(tanks)
    const perPiece = groups.map((g) => {
      const extra = g.tags.filter((x) => !shared.includes(x))
      // The maker used to drop out whenever a volume was shown. Now that most tanks
      // carry no plate, the few that do are the only brand value left in the text.
      const named = g.maker === 'Sonstige' ? g.type : `${g.maker} ${g.type}`
      const name = volume ? `${named} ${num(g.litres)} l` : named
      return `• ${g.count}× ${name} – je ${eur(g.vb)}${extra.length ? ` (${extra.join(', ')})` : ''}`
    })

    const title = trim(
      isBarrel
        ? `${t.count} Weinfässer Eiche ${groups.map((g) => `${num(g.litres)} l`).join(' / ')} Dekofass Regentonne`
        : `${t.count}× ${cat?.label ?? 'Positionen'} aus Betriebsauflösung Weingut`,
      lim.title,
    )

    const intro = isBarrel
      ? `${t.count} gebrauchte Eichenfässer aus dem eigenen Keller abzugeben — ${sellerName}, Betriebsauflösung.`
      : `${cat?.label ?? 'Verschiedene Positionen'} aus der Betriebsauflösung von ${sellerName}. ${t.count} Positionen, einzeln oder zusammen abzugeben.`

    const condition = isBarrel
      ? [
          'ZUSTAND',
          'Original Weinfässer, gebraucht, gewachsen im Einsatz. Holz dicht, Reifen fest.',
          'Nicht geschliffen und nicht behandelt — genau so, wie sie aus dem Keller kommen.',
          '',
          'VERWENDUNG',
          'Als Deko im Garten oder Hof, Stehtisch, Pflanzkübel, Regentonne oder Möbelprojekt.',
        ]
      : ['ZUSTAND', 'Gebraucht, aus laufendem Betrieb. Funktionsfähig, Besichtigung und Prüfung vor Ort möglich.']

    const body = [
      intro,
      '',
      'BESTAND',
      ...perPiece,
      '',
      ...featureBlock(tanks),
      ...condition,
      '',
      'PREIS',
      `Einzeln zu den genannten Preisen. Bei Abnahme mehrerer Positionen deutlicher Nachlass — alles zusammen (${t.count} Stück) auf Anfrage.`,
      `Alle Preise brutto inkl. ${Math.round(s.vatRate * 100)} % MwSt.`,
      ...(fach ? ['Die Umsatzsteuer wird auf der Rechnung separat ausgewiesen.'] : []),
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
      ...groups.map((g) => bullet(g, sharedFeatures(tanks))),
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
    ...groups.map((g) => bullet(g, sharedFeatures(tanks))),
    '',
    ...featureBlock(tanks),
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
  /** Price the buyer named, if the message carries the structured block. */
  offer: number | null
  /** True when the positions were read exactly instead of guessed from prose. */
  exact: boolean
}

/** Marker the catalogue puts at the end of an enquiry so nothing has to be guessed. */
export const REQUEST_MARK = 'Positionen:'
export const OFFER_MARK = 'Angebot:'

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

  // The catalogue appends the exact position numbers — prefer them over any guessing.
  const known = new Set(db.tanks.map((t) => t.id))
  const listed = text.match(new RegExp(`${REQUEST_MARK}\\s*([A-Z]-\\d+(?:\\s*,\\s*[A-Z]-\\d+)*)`, 'i'))
  const exactIds = listed
    ? listed[1].split(',').map((x) => x.trim().toUpperCase()).filter((id) => known.has(id))
    : []

  const offerLine = text.match(new RegExp(`${OFFER_MARK}\\s*([\\d.]+)`, 'i'))
  const offer = offerLine ? Number(offerLine[1].replace(/\./g, '')) || null : null

  const matchedTankIds = exactIds.length
    ? exactIds
    : db.tanks.filter((t) => all.includes(t.litres) && isOpen(t)).map((t) => t.id)

  // The structured block sits at the very end, exactly where a signature would —
  // so cut it off before looking for a name, or every enquiry is called "Angebot: 1100".
  const prose = text.split(/^\s*[—–-]\s*[—–-]\s*[—–-]\s*$/m)[0]
  const lines = prose.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // "Viele Grüße, Martin Kessler" — the name rides along on the greeting line.
  const afterGreeting = prose.match(
    /(?:mit freundlichen grüßen|viele grüße|beste grüße|liebe grüße|grüße|gruß|mfg|lg)[,\s]+([A-ZÄÖÜ][\wäöüß-]+(?:\s+[A-ZÄÖÜ][\wäöüß-]+){0,2})\s*$/im,
  )

  const stop = /^(hallo|hi|guten|sehr|mit freundlichen|viele grüße|liebe|mfg|lg|danke|gruß|grüße|ich |positionen|angebot|summe|diese)/i
  const standalone = [...lines]
    .reverse()
    .find((l) => l.length >= 3 && l.length <= 40 && !stop.test(l) && /^[A-ZÄÖÜ]/.test(l) && !/[.?!:€]$/.test(l) && l.split(/\s+/).length <= 4)

  const name = (afterGreeting?.[1] ?? standalone ?? '').trim()

  return { name, phone, email, litresMentioned: all, matchedTankIds, offer, exact: exactIds.length > 0 }
}
