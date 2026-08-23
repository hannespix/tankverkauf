import type { Ad, AdScope, DB, Maker, Portal, Tank } from '../types'
import { dims as fmtDims, eur, eurExact, centsPerLitre, netOf, num } from './format'
import { catalogPageUrl, hash } from './catalog'
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
  gesamt: 'Gesamtanzeige — alles',
  paket: 'Komplettpaket',
  kategorie: 'Ganze Kategorie',
  maker: 'Hersteller-Bundle',
  tank: 'Einzelne Position',
  restposten: 'Restposten (Kurzfassung)',
  custom: 'Freier Text',
}

function tanksInScope(db: DB, scope: AdScope): Tank[] {
  const open = db.tanks.filter(isOpen)
  switch (scope.kind) {
    case 'gesamt':
      // Wirklich alles, ohne Rücksicht auf inPackage — das ist der Sinn.
      return open
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
  // Eine Pumpe hat kein Volumen. "Impellerpumpe 0 l" stand in jeder Hersteller-
  // und Restposten-Anzeige und ließ die ganze Liste unseriös aussehen.
  const vol = g.litres > 0 ? ` ${num(g.litres)} l` : ''
  return `• ${g.count}× ${label(g)}${vol}${size ? ` · ${size}` : ''} – je ${eur(g.vb)}${extra.length ? ` (${extra.join(', ')})` : ''}`
}

/**
 * Fingerabdruck der Positionen und Preise, die eine Anzeige bewirbt.
 *
 * Reicht als alleiniges Kennzeichen NICHT: er merkt nichts davon, wenn sich
 * Hersteller, Typ, Literzahl, ein Kategoriename, der MwSt.-Satz, der Standort
 * oder die Signatur ändern — alles Dinge, die im Anzeigentext stehen. Deshalb
 * stempelt `generateAd` am Ende über den fertigen Text.
 */
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
 * "Dicht, keine Kühlung, Restabläufe" beschreibt einen Tank. An einer Pumpe oder
 * einem Filter ist derselbe Satz Unsinn — die Einzelanzeige nahm ihn aber für
 * jede Position, seit es auch Maschinen gibt.
 */
function conditionFor(category: string): string {
  if (category === 'fass') {
    return [
      'ZUSTAND',
      'Original Weinfässer, gebraucht, gewachsen im Einsatz. Holz dicht, Reifen fest.',
      'Nicht geschliffen und nicht behandelt — genau so, wie sie aus dem Keller kommen.',
    ].join('\n')
  }
  if (category === 'tank') return conditionBlock
  return ['ZUSTAND', 'Gebraucht, aus laufendem Betrieb. Funktionsfähig, Besichtigung und Prüfung vor Ort möglich.'].join('\n')
}

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

/**
 * `withPlace: false` für Zuschnitte, die den Standort schon an anderer Stelle
 * führen — sonst steht "Standort: 79241 Ihringen" zweimal in derselben Anzeige.
 */
function pickupBlock(db: DB, withPlace = true): string {
  const s = db.settings.seller
  const where = [s.plz, s.location].filter(Boolean).join(' ')
  const lines = [s.pickupInfo, withPlace && where ? `Standort: ${where}` : ''].filter(Boolean)
  // Ohne Inhalt bliebe die nackte Überschrift "ABHOLUNG" im Text stehen.
  return lines.length ? ['ABHOLUNG', ...lines].join('\n') : ''
}

/**
 * Der Fingerabdruck deckt den fertigen Text ab, nicht nur Positionen und Preise.
 * Vorher blieb „Text veraltet“ aus, sobald sich etwas änderte, das zwar im Text
 * steht, aber nicht in der Positionsliste — ein umbenannter Hersteller etwa, und
 * genau das steht bei den 29 Dekofässern noch an.
 */
export function generateAd(db: DB, scope: AdScope, portal: Portal | null): GeneratedAd {
  const gen = buildAd(db, scope, portal)
  return { ...gen, stamp: hash(`${gen.stamp}\n${gen.title}\n${gen.body}`) }
}

function buildAd(db: DB, scope: AdScope, portal: Portal | null): GeneratedAd {
  const tanks = tanksInScope(db, scope)
  const t = totals(tanks)
  const s = db.settings
  const groups = group(tanks)
  const sellerName = s.seller.name || 'Betriebsauflösung'
  const lim = limitsOfPortal(portal)
  const fach = portal?.style === 'fach'
  // Wie die Ware in Überschrift und Fließtext heißt. Solange nur eine Kategorie im
  // Zuschnitt steckt, ist es deren Name; bei gemischten Posten bleibt es neutral.
  // Fest verdrahtet stand hier früher "Edelstahltanks" — über zwei Pumpen und einen
  // Filter war das schlicht falsch.
  const kinds = [...new Set(tanks.map((x) => x.category))]
  const noun = kinds.length === 1
    ? (db.settings.categories.find((c) => c.id === kinds[0])?.label ?? 'Positionen')
    : 'Positionen'
  const hasVolume = kinds.length === 1 && (db.settings.categories.find((c) => c.id === kinds[0])?.hasVolume ?? false)

  if (scope.kind === 'tank') {
    const tank = tanks[0]
    if (!tank) {
      return { title: '', body: 'Position nicht gefunden.', price: 0, priceType: 'VB', tankIds: [], stamp: '' }
    }
    const name = tank.maker === 'Sonstige' ? tank.type : `${tank.maker} ${tank.type}`
    // Without a maker's plate the shape is the name, so the word buyers actually
    // search for has to come from the title instead.
    // Dieselbe Regel wie in der Liste: kein Volumen, keine Literangabe — und die
    // Suchbegriffe für Tanks gehören auch nur an einen Tank.
    const vol = tank.litres > 0 ? ` ${num(tank.litres)} l` : ''
    const search = tank.category === 'tank' ? ' Edelstahl Weintank Lagertank' : ''
    const title = trim(`${name}${vol}${search}`, lim.title)
    const body = [
      `${name}${tank.litres > 0 ? ` mit ${num(tank.litres)} Litern` : ''} aus Betriebsauflösung abzugeben.`,
      '',
      'DATEN',
      `• Hersteller/Typ: ${name}`,
      tank.litres > 0 ? `• Volumen: ${num(tank.litres)} l` : undefined,
      fmtDims(tank.dims) ? `• Maße: ${fmtDims(tank.dims)}` : undefined,
      `• Preis: ${eur(tank.vb)} VB (brutto inkl. ${Math.round(s.vatRate * 100)} % MwSt.)`,
      tank.litres > 0 ? `• Preis je Liter: ${centsPerLitre(tank.vb, tank.litres)}` : undefined,
      '',
      ...featureBlock([tank]),
      conditionFor(tank.category),
      '',
      pickupBlock(db),
      '',
      s.ad.signature,
    ]
      .filter((l) => l !== undefined)
      .join('\n')
    return { title, body: trim(body, lim.body), price: tank.vb, priceType: 'VB', tankIds: [tank.id], stamp: stampOf(tanks, tank.vb) }
  }

  if (scope.kind === 'gesamt') {
    // Ist alles weg, gibt es nichts zu bewerben. Ohne diesen Zweig entstünde beim
    // Neuerzeugen eine Anzeige über "0 Positionen" — und die stellt niemand ein.
    if (tanks.length === 0) {
      const body = [`${sellerName} — Betriebsauflösung.`, '', 'Alle Positionen sind verkauft. Vielen Dank für das Interesse.'].join('\n')
      return { title: trim(`${sellerName} — alles verkauft`, lim.title), body, price: 0, priceType: 'VB', tankIds: [], stamp: stampOf([], 0) }
    }

    // Reihenfolge wie in den Einstellungen — dieselbe wie in der Käuferliste.
    // Nach `db.tanks` sortiert begann die Anzeige mit der Kategorie, deren erste
    // Position zufällig oben stand.
    const byCat = new Map<string, Tank[]>()
    for (const c of s.categories) {
      const list = tanks.filter((x) => x.category === c.id)
      if (list.length) byCat.set(c.id, list)
    }
    for (const x of tanks) if (!byCat.has(x.category)) byCat.set(x.category, tanks.filter((y) => y.category === x.category))
    const catName = (id: string) => s.categories.find((c) => c.id === id)?.label ?? id

    // Eine Zeile je Bauart, ohne Maße: die stehen samt Fotos in der Liste, auf die
    // unten verwiesen wird. Bei 58 Positionen ist jedes Wort eine Entscheidung.
    // `perCat` deckelt die Aufzählung je Kategorie, damit die Kürzung in Stufen
    // geht statt alle Bauarten auf einmal zu verlieren.
    const rows = (withPrice: boolean, perCat = Infinity) => {
      const out: string[] = []
      for (const [cat, list] of byCat) {
        const tt = totals(list)
        const withVolume = s.categories.find((c) => c.id === cat)?.hasVolume ?? false
        const prices = list.map((x) => x.vb)
        const lo = Math.min(...prices)
        const hi = Math.max(...prices)
        // Fällt der Preis aus den Zeilen, wandert er als Spanne in die Überschrift.
        // Eine Anzeige ohne jede Preisangabe bekommt keine ernsthafte Anfrage.
        // „1 Stück · 390 € je Stück“ — „je Stück“ gehört nur dorthin, wo es von
        // mehreren wirklich eines meint.
        const span = withPrice ? '' : ` · ${lo === hi ? eur(lo) : `${num(lo)}–${eur(hi)}`}${list.length > 1 ? ' je Stück' : ''}`
        out.push(`${catName(cat).toUpperCase()} — ${list.length} Stück${withVolume && tt.litres > 0 ? `, ${num(tt.litres)} l` : ''}${span}`)
        // Gedeckelt wird nach Wert — die billigen Bauarten fallen weg, nicht die,
        // für die jemand herfährt. Angezeigt wird trotzdem in der Reihenfolge von
        // `group` (nach Liter absteigend): nach Preis sortiert stünde der 1.800er
        // über dem 2.000er, und die Liste läse sich wie ein Versehen.
        const kinds = group(list)
        const keep = perCat >= kinds.length
          ? kinds
          : [...kinds].sort((a, b) => b.vb - a.vb).slice(0, Math.max(0, perCat))
        const shown = kinds.filter((g) => keep.includes(g))
        for (const g of shown) {
          const name = g.maker === 'Sonstige' ? g.type : `${g.maker} ${g.type}`
          const vol = withVolume && g.litres > 0 ? ` ${num(g.litres)} l` : ''
          // "1× Schichtenfilter – je 390 €" liest sich falsch. "je" gehört nur dorthin,
          // wo es von mehreren Stück tatsächlich eines meint.
          const price = withPrice ? ` – ${g.count > 1 ? 'je ' : ''}${eur(g.vb)}` : ''
          out.push(`• ${g.count}× ${name}${vol}${price}`)
        }
        if (kinds.length > shown.length) out.push(`• und ${kinds.length - shown.length} weitere`)
        out.push('')
      }
      return out
    }

    // Beide Teile müssen stehen — ohne `repo` entstünde "…github.io//katalog.html",
    // ein Link, der aussieht wie einer und nirgendwohin führt.
    const link = s.catalog.owner && s.catalog.repo ? catalogPageUrl(s.catalog) : ''
    // Kleinanzeigen erlaubt 65 Zeichen. Ein abgeschnittener Titel ("… Dekof…")
    // sieht nach Panne aus, deshalb wird gekürzt, indem Wörter wegfallen, nicht
    // Buchstaben: die erste Fassung, die hineinpasst, gewinnt.
    // Die Warengattungen kommen aus den Kategorien selbst. Fest verdrahtet stand
    // hier "Edelstahltanks, Dekofässer, Kellertechnik" — sobald eine Gattung
    // ausverkauft ist, wäre das eine Einladung unter falschen Angaben.
    const catList = [...byCat.keys()].map(catName).join(', ')
    // „1 Positionen“ — dieselbe Regel wie bei „je“ in den Aufzählungszeilen.
    const posWord = t.count === 1 ? 'Position' : 'Positionen'
    const titles = [
      // Ohne Gattungen bliebe ein hängender Doppelpunkt stehen — der Fall tritt
      // ein, sobald die letzte Position verkauft und der Text neu erzeugt wird.
      ...(catList
        ? [
            fach
              ? `Betriebsauflösung Weingut: ${t.count} ${posWord} — ${catList}`
              : `Betriebsauflösung Weingut — ${t.count} ${posWord}: ${catList}`,
            `Betriebsauflösung Weingut: ${catList}`,
            `Betriebsauflösung: ${catList}`,
          ]
        : []),
      `Betriebsauflösung Weingut — ${t.count} ${posWord}`,
    ]
    const title = trim(titles.find((x) => x.length <= lim.title) ?? titles[titles.length - 1], lim.title)

    // Nach Wichtigkeit geordnet: was am Ende steht, fällt zuerst weg, wenn das
    // Portal nach Wörtern zählt. Der Verweis auf die Liste bleibt — ohne ihn
    // sieht niemand Fotos und Maße, und genau dafür ist die Anzeige da.
    const head = [
      fach
        ? `${sellerName} — Betriebsauflösung. ${t.count} ${posWord} abzugeben, einzeln oder zusammen.`
        : `Wegen Betriebsaufgabe geben wir unsere komplette Kellerausstattung ab: ${t.count} ${posWord}, einzeln oder zusammen.`,
      '',
    ]
    const tail = [
      'ALLE FOTOS UND MASSE',
      link ? `Vollständige Liste mit Bildern und Maßen zu jeder Position: ${link}` : 'Fotos und Maße auf Anfrage.',
      `Alle Preise brutto inkl. ${Math.round(s.vatRate * 100)} % MwSt., Verhandlungsbasis.`,
      // Bei Kleinanzeigen steht der Preis groß über der Anzeige. Ohne diese Zeile
      // stünden dort 35.515 €, ohne dass im Text steht, wofür.
      `Alles zusammen ${eur(t.vb)} VB, einzeln zu den genannten Preisen.`,
      'Bei Abnahme mehrerer Positionen mache ich einen Preis — bitte anfragen.',
      // Der Standort kostet drei Wörter und entscheidet, ob jemand überhaupt
      // anfragt. Er bleibt auch dann stehen, wenn der Abholtext fällt.
      [s.seller.plz, s.seller.location].filter(Boolean).join(' ')
        ? `Standort: ${[s.seller.plz, s.seller.location].filter(Boolean).join(' ')}`
        : '',
    ].filter(Boolean)
    // Der Standort steht schon im tail — hier würde er sich wiederholen.
    const full = ['', pickupBlock(db, false), '', s.ad.signature]
    const short = ['', s.ad.signature]

    const assemble = (list: string[], extra: string[]) => [...head, ...list, ...tail, ...extra].join('\n').replace(/\n{3,}/g, '\n\n')

    // Eine Rangfolge, keine Treppe: genommen wird die erste Fassung, die
    // hineinpasst. Nach Wert geordnet, nicht nach Länge — die Preisspalte wiegt
    // schwerer als Abholtext und Signatur, denn ohne sie fragt niemand an. Erst
    // wenn sie fällt, wandert der Preis als Spanne in die Kategoriezeile; danach
    // wird die Aufzählung Stufe um Stufe gedeckelt. Dass manche Fassung länger
    // ausfällt als eine frühere, ist damit unschädlich: sie passt dann eben auch
    // nicht. Der Verweis auf die Liste bleibt immer — ohne ihn sieht niemand
    // Fotos und Maße, und genau dafür ist die Anzeige da.
    //
    // Geprüft wird gegen BEIDE Grenzen. Nur nach Wörtern zu kürzen und danach hart
    // auf die Zeichengrenze zu schneiden hieße, den Link mitten im Wort zu kappen.
    const fits = (text: string) =>
      (lim.words === 0 || countWords(text) <= lim.words) && text.length <= lim.body
    const versions = [
      assemble(rows(true), full),
      assemble(rows(true), short),
      assemble(rows(true), []),
      assemble(rows(false), full),
      assemble(rows(false), short),
      assemble(rows(false), []),
      ...[10, 8, 6, 5, 4, 3, 2, 1, 0].map((n) => assemble(rows(false, n), [])),
      // Wenn selbst die Kategoriezeilen nicht mehr hineinpassen: Kopf und Verweis
      // auf die Liste. Weniger geht nicht, ohne die Anzeige sinnlos zu machen.
      assemble([], []),
    ]
    const body = versions.find(fits) ?? versions[versions.length - 1]

    return {
      title,
      body: trim(body, lim.body),
      price: t.vb,
      priceType: 'VB',
      tankIds: tanks.map((x) => x.id),
      stamp: stampOf(tanks, t.vb),
    }
  }

  if (scope.kind === 'maker') {
    const maker = scope.maker ?? 'Sonstige'
    // Most tanks here carry no maker's plate at all. "6 Sonstige Edelstahltanks"
    // would read like a filler word in the headline, so the brand simply drops out.
    const named = maker && maker !== 'Sonstige' ? `${maker} ` : ''
    const size = hasVolume && t.litres > 0 ? ` ${num(t.litres)} l` : ''
    const search = kinds.length === 1 && kinds[0] === 'tank' ? ' Weintank Lagertank' : ''
    const title = trim(`${t.count} ${named}${noun}${size}${search}`, lim.title)
    const body = [
      `${t.count} ${named ? `${maker}-${noun}` : noun}${hasVolume && t.litres > 0 ? ` mit zusammen ${num(t.litres)} Litern` : ''} aus Betriebsauflösung.`,
      '',
      'BESTAND',
      ...groups.map((g) => bullet(g, sharedFeatures(tanks))),
      '',
      ...featureBlock(tanks),
      'PREIS',
      `Einzelabgabe zu den genannten Preisen, Summe ${eur(t.vb)} VB.`,
      'Bei Abnahme mehrerer Positionen Preisnachlass — einfach anfragen.',
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
      // This scope builds its own line and so missed the measurements the package
      // ad already carried — the same list read differently depending on the scope.
      const size = fmtDims(g.dims)
      return `• ${g.count}× ${name}${size ? ` · ${size}` : ''} – je ${eur(g.vb)}${extra.length ? ` (${extra.join(', ')})` : ''}`
    })

    const title = trim(
      isBarrel
        // Die Suchbegriffe stehen vorn: gesucht wird nach "Dekofass", nicht nach
        // "Weinfass" — und verkauft werden sie ausdrücklich als Deko.
        ? `${t.count} Dekofässer Eiche ${groups.map((g) => `${num(g.litres)} l`).join(' / ')} Weinfass Regentonne Stehtisch`
        : `${t.count}× ${cat?.label ?? 'Positionen'} aus Betriebsauflösung Weingut`,
      lim.title,
    )

    const intro = isBarrel
      ? `${t.count} gebrauchte Eichenfässer aus dem eigenen Keller, ausdrücklich als Dekofässer abzugeben — ${sellerName}, Betriebsauflösung.`
      : `${cat?.label ?? 'Verschiedene Positionen'} aus der Betriebsauflösung von ${sellerName}. ${t.count} Positionen, einzeln oder zusammen abzugeben.`

    const condition = isBarrel
      ? [
          'ZUSTAND',
          'Original Weinfässer, gebraucht, gewachsen im Einsatz. Reifen fest.',
          'Nicht geschliffen und nicht behandelt — genau so, wie sie aus dem Keller kommen.',
          'Abgabe ausdrücklich als Dekofässer — nicht auf Dichtheit für den Weinausbau geprüft.',
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
    const size = hasVolume && t.litres > 0 ? ` ${num(t.litres)} l` : ''
    const title = trim(`${t.count} ${noun}${size} — Betriebsauflösung Weingut`, lim.title)
    const body = [
      `Wegen Betriebsauflösung: ${t.count} ${noun}${hasVolume && t.litres > 0 ? `, zusammen ${num(t.litres)} Liter` : ''}.`,
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
  const volume = t.litres > 0 ? ` ${num(t.litres)} l` : ''
  const title = trim(
    fach
      ? `Betriebsauflösung: ${t.count} ${noun}${t.litres > 0 ? `, ${num(t.litres)} l gesamt` : ''}${makerList ? ` — ${makerList}` : ''}`
      // Die Suchbegriffe gehören in den Titel, aber nur solange sie stimmen —
      // über einen gemischten Posten wäre "Weintank Lagertank" gelogen.
      : `${t.count} ${noun}${volume}${kinds.length === 1 && kinds[0] === 'tank' ? ' Weintank Lagertank' : ''} Betriebsauflösung Weingut`,
    lim.title,
  )
  const body = [
    fach ? `${sellerName} — Betriebsauflösung, kompletter Bestand` : `${sellerName} — Betriebsauflösung`,
    '',
    fach
      ? `${t.count} ${noun}${t.litres > 0 ? ` mit zusammen ${num(t.litres)} Litern` : ''} aus laufendem Kellerbetrieb. Abgabe komplett oder einzeln.`
      : `Wegen Aufgabe des Betriebs verkaufe ich meinen kompletten Bestand: ${t.count} ${noun}${t.litres > 0 ? ` mit insgesamt ${num(t.litres)} Litern Volumen` : ''}.`,
    '',
    'BESTAND',
    ...groups.map((g) => bullet(g, sharedFeatures(tanks))),
    '',
    ...featureBlock(tanks),
    priceBlock(db, t.vb, s.packagePrice, t.litres, fach),
    '',
    kinds.length === 1 ? conditionFor(kinds[0]) : conditionFor('gemischt'),
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

/** Wie ein Portal zählt: alles, was durch Leerraum getrennt ist. */
export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

export function limitsOfPortal(portal: Portal | null) {
  return { ...limitsOf(portal), words: portal?.bodyWords ?? 0 }
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
  /** Price the buyer named — from the structured block, otherwise from the prose. */
  offer: number | null
  /** True when the positions were read exactly instead of guessed from prose. */
  exact: boolean
  /**
   * Unser eigener Paketpreis, den die Käuferliste mitgeschickt hat — nicht das
   * Gebot des Käufers. Ohne diese Unterscheidung erschiene jeder, der den
   * ausgeschriebenen Paketpreis annimmt, als Preisdrücker gegenüber der Summe
   * der Einzelpreise.
   */
  packagePrice: number | null
  /** Set when a guess covers suspiciously many positions, so the form can warn. */
  broadMatch: boolean
  /**
   * Sätze über Abholung, Lieferung oder einen Termin — wörtlich, nicht gedeutet.
   *
   * „Abholung könnte ich Freitag machen" fiel bisher komplett durch: kein
   * Schritt konnte es aufnehmen, und in die Notiz kam es auch nicht. Ein Datum
   * daraus zu rechnen wäre falsche Genauigkeit — der Satz selbst genügt.
   */
  pickupHints: string[]
  /** Eine deutsche Postleitzahl mit Ort, falls die Nachricht eine nennt. */
  place: string
  /**
   * Jeder Betrag, den die Nachricht nennt — auch wenn keiner davon als Gebot
   * durchgeht. Sonst verschwiegen wir dem Verkäufer, dass Zahlen dastanden.
   */
  amounts: number[]
  /** Die Beträge lesen sich als Preisliste, nicht als ein Gebot. */
  priceList: boolean
}

/**
 * Kleinbuchstaben, Umlaute weg, Zeichensetzung weg.
 *
 * Der Umlaut fällt auf den Grundvokal, nicht auf zwei Buchstaben: aus
 * „Dekofässer" wird „dekofasser", und darin steckt „dekofass" aus dem Bestand.
 * Mit ä→ae hieße es „dekofaesser“ und der Stamm wäre zerschnitten — die Suche
 * fand den Plural dann nicht mehr. Dieselbe Regel wie in `groupMentioned`.
 */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
}

/**
 * Zwei Wörter meinen dasselbe, wenn eines im anderen steckt und höchstens eine
 * Endung dazwischenliegt.
 *
 * Die Grenze ist nicht Zierrat: ohne sie passte „barriquefass" auf „barrique"
 * und die Frage nach dem Barriquefass-Reiniger zog 29 Fässer mit. Drei Zeichen
 * decken Plural und Beugung ab, ein ganzes zweites Wort nicht.
 */
function sameWord(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 3) return false
  return a.startsWith(b) || b.startsWith(a)
}

/**
 * Wonach eine Position gefunden werden kann: die Wörter ihres Typs UND ihr
 * Hersteller. Der Hersteller fehlte — "Was soll die Schneider-Pumpe kosten?"
 * fand nichts, obwohl der Name im Bestand steht.
 *
 * Kurze Wörter taugen nicht: "Tank" träfe alles, "Sonstige" ist kein Name.
 */
function nameWords(t: { type: string; maker: string }): string[] {
  const parts = [...fold(t.type).split(' ')]
  if (t.maker && t.maker !== 'Sonstige') parts.push(...fold(t.maker).split(' '))
  return parts.filter((w) => w.length >= 6)
}

/** Marker the catalogue puts at the end of an enquiry so nothing has to be guessed. */
export const REQUEST_MARK = 'Positionen:'
export const OFFER_MARK = 'Angebot:'
/** Der Preis, den unsere eigene Käuferliste für diese Auswahl ausgerechnet hat. */
export const PACKAGE_MARK = 'Paketpreis:'

/** "T-03–T-05, F-01" becomes every id in between, keeping only ones that exist. */
function expandRanges(list: string, known: Set<string>): string[] {
  const out: string[] = []
  for (const part of list.split(',')) {
    const m = part.trim().toUpperCase().match(/^([A-Z]+)-(\d+)(?:\s*[-–—]\s*([A-Z]+)-(\d+))?$/)
    if (!m) continue
    const width = m[2].length
    const to = m[4] && m[3] === m[1] ? Number(m[4]) : Number(m[2])
    // A reversed or absurd range would otherwise spin for a very long time.
    if (to < Number(m[2]) || to - Number(m[2]) > 999) continue
    for (let n = Number(m[2]); n <= to; n += 1) {
      const id = `${m[1]}-${String(n).padStart(width, '0')}`
      if (known.has(id)) out.push(id)
    }
  }
  return [...new Set(out)]
}

/**
 * Kleinanzeigen has no API for private sellers, so incoming enquiries arrive as
 * text. Pasting one here pulls out the bits worth keeping instead of retyping them.
 */
/** Robot addresses the portals send from. Never the buyer. */
const RELAY_ADDRESS = /^(no-?reply|do-?not-?reply|reply-[\w.-]+|noreply)@/i

/**
 * A forwarded mail carries a header block — Von/An/Gesendet/Betreff — before the
 * text the buyer actually wrote. Everything in it belongs to the portal's robot:
 * searching it for a mail address finds noreply@…, and "Gesendet: 22.08.2026 09:41"
 * reads as the phone number 08202609. So the header is cut off first.
 */
function bodyOf(text: string): string {
  const start = text.search(/^-{2,}\s*(Weitergeleitete|Urspr(ü|ue)ngliche) Nachricht|^Anfang der weitergeleiteten Nachricht:/im)
  const rest = start === -1 ? text : text.slice(start)
  const lines = rest.split(/\r?\n/)
  let last = -1
  for (let i = 0; i < Math.min(lines.length, 25); i += 1) {
    if (/^\s*(Von|An|Gesendet|Betreff|Datum|Cc|Kopie|From|To|Sent|Subject|Date|Reply-To|Antwort an):/i.test(lines[i])) last = i
  }
  return last === -1 ? text : lines.slice(last + 1).join('\n')
}

export function parseMessage(text: string, db: DB): ParsedMessage {
  const body = bodyOf(text)
  /*
   * Bei einer weitergeleiteten Mail wird der Kopfblock abgeschnitten — bei einer
   * Portalmail zu Recht, denn dort steht die Roboteradresse. Wird aber eine
   * gewöhnliche E-Mail weitergeleitet, steht in „Von:" der Käufer selbst, und
   * die Adresse ging verloren. Ohne Kontaktweg verwirft der Vorgang dann alles.
   * Genommen wird sie nur, wenn im Text selbst keine steht und sie keine
   * Roboteradresse ist.
   */
  const fromHeader = text.match(/^\s*(?:Von|From)\s*:.*?([\w.+-]+@[\w-]+\.[\w.]{2,})/im)?.[1] ?? ''
  const inBody = (body.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) ?? []).find((a) => !RELAY_ADDRESS.test(a)) ?? ''
  const email = inBody || (RELAY_ADDRESS.test(fromHeader) ? '' : fromHeader)
  const phoneRaw = body.match(/(?:\+49|0)[\d\s/().-]{7,}\d/)?.[0] ?? ''
  const phone = phoneRaw.replace(/[^\d+]/g, '').replace(/^(\+49)/, '+49 ')

  // A number only counts as a volume when a unit stands next to it. The bare
  // "1.650" pattern that used to be here cannot work in this stock: the asking
  // prices (1250, 1650, 1800, 2100) are the same numbers as the tank sizes, so
  // "ich biete 2.800 Euro" silently attached both 2800 l tanks to the enquiry.
  const litresMentioned = [...body.matchAll(/\b(\d{1,2})[.,](\d{3})\s*(?:l\b|ltr\b|liter)|\b(\d{3,5})\s*(?:l\b|ltr\b|liter)/gi)]
    .map((m) => Number(m[3] ?? `${m[1]}${m[2]}`))
    .filter((n) => n >= 100 && n <= 20000)
  const all = [...new Set(litresMentioned)]

  // The catalogue writes the exact position numbers — prefer them over any guessing.
  // They arrive collapsed into ranges ("T-03–T-05") to keep the mailto link short.
  const known = new Set(db.tanks.map((t) => t.id))
  // Die Marke braucht eine linke Wortgrenze, sonst trifft "Angebot:" auch in
  // "Mein Paketangebot:" und "Positionen:" auch in "Paket-Positionen:" — und das
  // wäre wieder unser eigener Preis, der als Gebot des Käufers gelesen wird.
  const mark = (m: string, tail: string) => new RegExp(`(?:^|[^\\wäöüßÄÖÜ-])${m}\\s*${tail}`, 'im')
  const listed = text.match(mark(REQUEST_MARK, `([A-Z]-\\d+(?:\\s*[-–—]\\s*[A-Z]-\\d+)?(?:\\s*,\\s*[A-Z]-\\d+(?:\\s*[-–—]\\s*[A-Z]-\\d+)?)*)`))
  // Even an exactly stated number must not attach something already sold — the
  // catalogue never offers those, so a range simply reaches past them.
  const marked = (listed ? expandRanges(listed[1], known) : [])
  // Positionsnummern stehen nicht nur hinter der Marke. "Ich nehme T-23 und T-24"
  // wurde bisher gar nicht gelesen — dabei ist eine ausgeschriebene Nummer der
  // eindeutigste Beleg, den es gibt.
  const inProse = [...body.matchAll(/\b([A-Z])-(\d{1,3})\b/g)]
    .map((m) => `${m[1]}-${m[2].padStart(2, '0')}`)
    .filter((id) => known.has(id))
  const exactIds = [...new Set([...marked, ...inProse])]
    .filter((id) => db.tanks.some((t) => t.id === id && isOpen(t)))

  const offerLine = text.match(mark(OFFER_MARK, `([\\d.]+)`))
  const packageLine = text.match(mark(PACKAGE_MARK, `([\\d.]+)`))
  const packagePrice = packageLine ? Number(packageLine[1].replace(/\./g, '')) || null : null

  // An enquiry from our own catalogue quotes OUR prices back at us: "- 4x
  // Barriquefass (225 l) - je 175 EUR" and "Summe der genannten Preise: 2.500 EUR".
  // Scanning those for a price read 175 as the buyer's offer on a 2.500 EUR
  // enquiry — and presented it as exactly read. Our own lines are cut out first.
  const buyerWrote = body
    .split(/\r?\n/)
    .filter((l) => !/^\s*[-•]\s*\d+×/.test(l))
    .filter((l) => !/^\s*Summe der genannten Preise/i.test(l))
    .filter((l) => !/^\s*>*\s*(Paketpreis|Paket|Sie sparen)/i.test(l))
    .filter((l) => !/^\s*[·•]/.test(l))
    .join('\n')

  // Was ein Gebot ist.
  //
  // Zwei Wege, und beide müssen eng sein. Der erste Entwurf ließ nach dem Verb
  // 25 beliebige Zeichen zu — damit wurde jede Zahl in der Nähe eines Verbs zum
  // Gebot: „ich zahle bar: 0176 4433221" ergab 176 €, „Abholung nach 55232
  // Alzey" ergab 55.232 €, und „ich nehme den 1650er" bot 1.650 € für einen
  // Tank, der 1.050 € kostet.
  //
  // (1) Eine Zahl mit Währung. Die ist für sich eindeutig, egal wo sie steht —
  //     „3.600 EUR biete ich Ihnen" liest der Verbweg nie, weil die Zahl vorn steht.
  // (2) Eine Zahl OHNE Währung nur unmittelbar hinter einem Zahlungswort: höchstens
  //     zwölf Zeichen dazwischen, und darin nur Buchstaben und Leerzeichen. Ein
  //     Komma, ein Doppelpunkt oder ein Punkt beendet den Bezug — „nehme beide,
  //     meine PLZ ist 67435" ist damit kein Gebot mehr.
  const NUM = '(\\d{1,3}(?:[.\\s]\\d{3})+|\\d{2,6})'
  // Keine Einheit dahinter, kein Buchstabe (sonst wäre „1650er" ein Gebot) und
  // keine weitere Ziffer (sonst liest die Alternative aus „3700 l" die 370).
  const TAIL = '(?!\\d)(?![a-zäöüß])(?!\\s*(?:l\\b|ltr|liter|cm|mm|kg|st(?:ü|ue)ck|f(?:ä|ae)sser|tanks?|positionen|uhr))'
  const withCurrency = new RegExp(`${NUM}\\s*(?:€|EUR\\b|Euro\\b)|(?:€|EUR)\\s*${NUM}`, 'gi')
  const afterVerb = new RegExp(`(?:biete|bieten|geboten|zahle|zahlen|bezahle|bezahlen|gebe|f(?:ü|ue)r)\\b[a-zäöüßA-ZÄÖÜ ]{0,12}${NUM}${TAIL}`, 'gi')

  const money = [...buyerWrote.matchAll(withCurrency)].map((m) => Number((m[1] ?? m[2]).replace(/[.\s]/g, '')))
  const bare = [...buyerWrote.matchAll(afterVerb)]
    .map((m) => Number(m[1].replace(/[.\s]/g, '')))
    // Eine nackte Jahreszahl ist ein Termin, kein Preis: "brauchen die Tanks für 2027".
    .filter((n) => !(n >= 1900 && n <= 2099))
  const bids = money.length ? money : bare
  const plausible = bids.filter((n) => n >= 50 && n <= 500000)

  // Eine Preisliste ist kein Gebot.
  //
  // Ein Käufer, der unseren Katalog abtippt, schreibt einen Posten je Zeile:
  //   1 x 800 l für 650 €
  //   1 x 1.000 l für 750 €
  //   3 x 1.650 l für je 1.050 €
  // Bisher gewann daraus der letzte Treffer — nicht weil er das Gebot wäre,
  // sondern weil er unten steht. Bei Wallhäuser wurden so 1.050 € als sein
  // Gebot gebucht, während er in Wahrheit 5.400 € zusagte: 800 € mehr, als wir
  // selbst verlangt hätten. Stünde die Liste andersherum, hieße es 650 €.
  //
  // Eine Verhandlung dagegen steht in einem Satz auf einer Zeile: "4.200 EUR
  // sind mir zu viel, ich biete 3.600 EUR." Dort ist der letzte Treffer richtig
  // — und nur dort wird er noch genommen.
  const priced = buyerWrote
    .split(/\r?\n/)
    .filter((l) => [...l.matchAll(withCurrency)].some((m) => {
      const n = Number((m[1] ?? m[2]).replace(/[.\s]/g, ''))
      return n >= 50 && n <= 500000
    }))
  const distinct = new Set(plausible)
  const priceList = distinct.size > 1 && priced.length > 1

  const offer = offerLine
    ? Number(offerLine[1].replace(/\./g, '')) || null
    : priceList
      ? null
      : plausible.length
        // Der letzte Treffer: "4.200 EUR sind mir zu viel, ich biete 3.600 EUR"
        // nannte sonst unseren eigenen Preis als sein Gebot.
        ? plausible[plausible.length - 1]
        : null
  /** Alles, was nach Betrag aussah — auch wenn daraus kein Gebot wurde. */
  const amounts = [...new Set(plausible)]

  const byLitres = db.tanks.filter((t) => all.includes(t.litres) && isOpen(t))
  // Nicht jede Ware hat ein Volumen. "Die Impellerpumpe nehme ich" fand bisher
  // nichts, weil ausschließlich über Literzahlen gesucht wurde.
  //
  // Verglichen werden ganze Wörter, nicht Teilzeichenketten: "barrique" steckt
  // auch in "Barriquefass-Reiniger", und ein Teilstringtest hängte an der Frage
  // nach dem Reiniger 29 Fässer mit an. Und Wortanfang genügt, damit
  // "Dekofässer" das "Dekofass" im Bestand findet.
  //
  // Nur, wenn keine Literzahl dasteht: "die beiden Rundtanks 3700 l" meint die
  // 3.700er, nicht jeden Rundtank im Keller.
  const said = fold(body).split(' ').filter((w) => w.length >= 6)
  const named = byLitres.length > 0 ? [] : db.tanks.filter((t) => {
    if (!isOpen(t)) return false
    return nameWords(t).some((w) => said.some((x) => sameWord(x, w)))
  })
  const guessed = [...new Set([...byLitres, ...named].map((t) => t.id))]
  const matchedTankIds = exactIds.length ? exactIds : guessed
  // "225 l Fässer" matches every one of the 29 barrels. Attaching them all locks
  // the whole lot to one enquirer, so the form has to ask before that happens.
  const broadMatch = exactIds.length === 0 && guessed.length > 3

  // The structured block used to sit at the end and now sits at the top, and older
  // enquiries still carry the old layout — so its lines are removed wherever they
  // are instead of cutting the text at the separator. Otherwise the sender is
  // called "Angebot: 1100" or, with the block on top, not found at all.
  const prose = body
    .split(/\r?\n/)
    .filter((l) => !new RegExp(`^\\s*(${REQUEST_MARK}|${OFFER_MARK}|${PACKAGE_MARK})`, 'i').test(l))
    .filter((l) => !/^\s*\((Diese (drei )?Zeilen )?[Bb]itte stehen lassen/i.test(l))
    .filter((l) => !/^\s*[·•]/.test(l))
    .filter((l) => !/^\s*[—–-]\s*[—–-]\s*[—–-]\s*$/.test(l))
    .join('\n')
  const lines = prose.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  /*
   * "Viele Grüße, Martin Kessler" — der Name steht auf der Grußzeile selbst.
   *
   * Die Brücke war `[,\s]+`, und `\s` schließt den Zeilenumbruch ein. Damit
   * reichte die Regel über die Leerzeile hinweg in den Briefkopf und nahm, was
   * dort zuerst stand — bei einer echten Geschäftsmail das Naturschutz-Siegel
   * „Partnerbetrieb Naturschutz" statt des Absenders. Jetzt nur noch dieselbe
   * Zeile.
   *
   * `\p{Lu}\p{L}*` statt `[A-ZÄÖÜ][\wäöüß-]+`: die alte Klasse kannte keine
   * großen Umlaute. „WALLHÄUSER" wurde zu „WALLH", „SCHRÖDER" zu „SCHR", und
   * „MÜLLER" traf gar nicht — ein deutscher Nachname in Versalien zerbrach die
   * Erkennung.
   */
  const afterGreeting = prose.match(
    /(?:mit freundlichen grüßen|viele grüße|beste grüße|liebe grüße|grüße|gruß|mfg|lg)[,;]?[ \t]+(\p{L}[\p{L}'’-]*(?:[ \t]+\p{L}[\p{L}'’-]*){0,2})[ \t]*$/imu,
  )
  /*
   * Unter dem i-Flag faltet JavaScript auch `\p{Lu}` — die Klasse trifft dann
   * jeden Buchstaben. „Viele Grüße von der Nahe" ergab deshalb den Absendernamen
   * „von der Nahe". Die Großschreibung wird jetzt in Code geprüft, nicht in der
   * Regex, denn das i-Flag brauchen wir für die Grußformel selbst.
   */
  const greeted = afterGreeting?.[1]?.trim()
  const looksLikeName = !!greeted && greeted.split(/\s+/).every((w) => /^\p{Lu}/u.test(w))

  const stop = /^(hallo|hi|guten|sehr|mit freundlichen|viele grüße|liebe|mfg|lg|danke|gruß|grüße|ich |positionen|angebot|summe|diese|von|an|betreff|gesendet|datum|cc|kopie|from|to|subject|sent|date|antwort an)\b/i
  const standalone = [...lines]
    .reverse()
    .find((l) => l.length >= 3 && l.length <= 40 && !stop.test(l) && /^[A-ZÄÖÜ]/.test(l) && !/[.?!:€]$/.test(l) && l.split(/\s+/).length <= 4)

  const name = ((looksLikeName ? greeted : '') || standalone || '').trim()

  // Was der Käufer über Abholung sagt, steht fast immer in einem eigenen Satz.
  // Genommen wird der Satz, nicht ein daraus geratenes Datum.
  const pickupHints = [...new Set(
    prose
      .split(/(?<=[.!?])\s+|\n/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 8 && x.length <= 160)
      .filter((x) => /\b(abhol|abzuhol|abholen|liefer|anliefer|spedition|transport|termin|vorbeikommen|besichtig)/i.test(x)),
  )]
  const placeMatch = body.match(/\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß.-]+(?:[ -][A-ZÄÖÜ][\wäöüß.-]+)?)/)
  const place = placeMatch ? `${placeMatch[1]} ${placeMatch[2]}` : ''

  return { name, phone, email, litresMentioned: all, matchedTankIds, offer, packagePrice, exact: exactIds.length > 0, broadMatch, pickupHints, place, amounts, priceList }
}
