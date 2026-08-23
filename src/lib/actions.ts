import type { Ad, AdScope, DB, Lead, Quote, Tank, TankStatus } from '../types'
import { MAX_PER_LEAD, askFor, collapseIds, describe, resolvePick, trimMessage, type Proposal } from './inbox'
import { STATUS_LABEL } from '../types'
import { generateAd, portalOf } from './ads'
import { SEED } from './seed'
import { newId, store } from './store'
import { openQuotesOf } from './stats'

const now = () => new Date().toISOString()
const tankName = (t: Tank) => `${t.maker === 'Sonstige' ? t.type : t.maker} ${t.litres} l`

// -------------------------------------------------------------------- tanks

export function patchTank(id: string, patch: Partial<Tank>, label?: string) {
  store.mutate(
    (db) => {
      const t = db.tanks.find((x) => x.id === id)
      if (!t) return
      Object.assign(t, patch, { updatedAt: now() })
    },
    label ? { kind: 'tank', text: label } : undefined,
  )
}

export function setTankStatus(tank: Tank, status: TankStatus) {
  patchTank(tank.id, { status }, `${tankName(tank)} → ${STATUS_LABEL[status]}`)
}

export function setTankOffer(tank: Tank, offer: number | null) {
  patchTank(tank.id, { offer }, offer ? `Gebot ${offer} € für ${tankName(tank)}` : `Gebot entfernt: ${tankName(tank)}`)
}

export function addTank(partial: Partial<Tank>) {
  store.mutate(
    (db) => {
      // The counter has to run over the PREFIX, not the category. Counting per
      // category gave the first Gitterbox T-01 — the same id as the seed tank T-01,
      // and removeTank would then delete both. Machines have their own letter so a
      // position added here can never collide with one arriving from the seed later.
      const prefix = partial.category === 'fass' ? 'F' : partial.category === 'maschine' ? 'M' : 'T'
      const maxN = db.tanks
        .filter((t) => t.id.startsWith(`${prefix}-`))
        .reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, '')) || 0), 0)
      const vb = partial.vb ?? 0
      db.tanks.push({
        id: `${prefix}-${String(maxN + 1).padStart(2, '0')}`,
        category: partial.category ?? 'tank',
        maker: partial.maker ?? 'Sonstige',
        type: partial.type ?? 'Edelstahltank',
        dims: partial.dims ?? null,
        litres: partial.litres ?? 0,
        vb,
        target: partial.target ?? Math.round(vb * 0.86),
        floor: partial.floor ?? Math.round(vb * 0.72),
        status: 'verfuegbar',
        leadId: null,
        dealId: null,
        offer: null,
        pickup: null,
        note: partial.note ?? '',
        tags: [],
        photos: [],
        updatedAt: now(),
      })
    },
    { kind: 'tank', text: `Position angelegt: ${partial.maker ?? ''} ${partial.type ?? ''}`.replace(/\s+/g, ' ').trim() },
  )
}

/** Add or remove one feature across a whole selection at once. */
export function tagMany(tankIds: string[], tag: string, on: boolean) {
  const value = tag.trim()
  if (!value) return
  store.mutate(
    (db) => {
      for (const id of tankIds) {
        const t = db.tanks.find((x) => x.id === id)
        if (!t) continue
        const has = t.tags.includes(value)
        if (on && !has) t.tags = [...t.tags, value]
        if (!on && has) t.tags = t.tags.filter((x) => x !== value)
        t.updatedAt = now()
      }
    },
    { kind: 'tank', text: `${on ? 'Merkmal gesetzt' : 'Merkmal entfernt'}: ${value} (${tankIds.length} Positionen)` },
  )
}

/**
 * Correct maker and/or type across a whole selection. Exists because a wrong
 * maker is not a typo you fix once: it sits in every ad, in the catalogue and in
 * the buyer's mail, and here it was wrong on eleven positions at the same time.
 * An empty field means "leave this one alone", so type can be set without
 * touching the maker.
 */
export function retypeMany(tankIds: string[], maker: string, type: string) {
  const m = maker.trim()
  const t = type.trim()
  if (!m && !t) return
  store.mutate(
    (db) => {
      for (const id of tankIds) {
        const tank = db.tanks.find((x) => x.id === id)
        if (!tank) continue
        if (m) tank.maker = m
        if (t) tank.type = t
        tank.updatedAt = now()
      }
    },
    {
      kind: 'tank',
      text: `${[m && `Hersteller: ${m}`, t && `Typ: ${t}`].filter(Boolean).join(', ')} (${tankIds.length} Positionen)`,
    },
  )
}

export function removeTank(tank: Tank) {
  store.mutate(
    (db) => {
      db.tanks = db.tanks.filter((t) => t.id !== tank.id)
      db.deals.forEach((d) => {
        d.tankIds = d.tankIds.filter((id) => id !== tank.id)
      })
      db.leads.forEach((l) => {
        l.tankIds = l.tankIds.filter((id) => id !== tank.id)
      })
      db.quotes.forEach((q) => {
        q.tankIds = q.tankIds.filter((id) => id !== tank.id)
      })
      // Ein Angebotspaket, das auf eine gelöschte Position zeigt, würde auf der
      // Käuferseite stillschweigend kleiner werden, ohne dass es jemand merkt.
      db.settings.bundles = db.settings.bundles.map((b) => ({
        ...b,
        ids: b.ids.filter((id) => id !== tank.id),
        giftIds: b.giftIds.filter((id) => id !== tank.id),
      }))
    },
    { kind: 'tank', text: `Position gelöscht: ${tankName(tank)}` },
  )
}

// -------------------------------------------------------------------- leads

export function addLead(partial: Partial<Lead>): string {
  const id = newId('L')
  store.mutate(
    (db) => {
      db.leads.unshift({
        id,
        name: partial.name?.trim() || 'Unbenannt',
        phone: partial.phone ?? '',
        email: partial.email ?? '',
        location: partial.location ?? '',
        source: partial.source ?? 'kleinanzeigen',
        stage: partial.stage ?? 'neu',
        tankIds: partial.tankIds ?? [],
        budget: partial.budget ?? null,
        lastContact: partial.lastContact ?? new Date().toISOString().slice(0, 10),
        nextFollowUp: partial.nextFollowUp ?? null,
        note: partial.note ?? '',
        createdAt: now(),
        updatedAt: now(),
      })
      // Any tank this lead asked about moves out of "nobody has called".
      for (const tid of partial.tankIds ?? []) {
        const t = db.tanks.find((x) => x.id === tid)
        if (t && t.status === 'verfuegbar') {
          t.status = 'kontakt'
          t.leadId = id
          t.updatedAt = now()
        }
      }
    },
    { kind: 'lead', text: `Interessent angelegt: ${partial.name ?? 'Unbenannt'}` },
  )
  return id
}

export function patchLead(id: string, patch: Partial<Lead>, label?: string) {
  store.mutate(
    (db) => {
      const l = db.leads.find((x) => x.id === id)
      if (!l) return
      Object.assign(l, patch, { updatedAt: now() })
    },
    label ? { kind: 'lead', text: label } : undefined,
  )
}

export function removeLead(lead: Lead) {
  store.mutate(
    (db) => {
      db.leads = db.leads.filter((l) => l.id !== lead.id)
      // Der Name gehört in den Verkauf, bevor der Interessent verschwindet.
      // Deal kennt kein Käuferfeld — nur `leadId`. Wer den Interessenten
      // löschte, nahm dem Verkauf damit seinen Menschen ganz, während der
      // Kommentar hier das Gegenteil behauptete und `t.leadId` an verkauften
      // Positionen ins Leere zeigen ließ.
      for (const d of db.deals) {
        if (d.leadId !== lead.id) continue
        const line = `Käufer: ${lead.name}${lead.email ? ` · ${lead.email}` : ''}${lead.phone ? ` · ${lead.phone}` : ''}`
        if (!d.note.includes(line)) d.note = d.note.trim() ? `${line}\n${d.note}` : line
        d.leadId = null
      }
      db.tanks.forEach((t) => {
        if (t.leadId !== lead.id) return
        t.leadId = null
        if (t.status === 'kontakt' || t.status === 'reserviert') t.status = 'verfuegbar'
      })
      // Angebote zeigten danach auf einen Interessenten, den es nicht mehr
      // gibt — die Angebotskarte rendert das stumm als „kein Interessent“, und
      // niemand sieht, dass da einmal einer war.
      for (const q of db.quotes) if (q.leadId === lead.id) q.leadId = null
    },
    { kind: 'lead', text: `Interessent gelöscht: ${lead.name}` },
  )
}

/**
 * Positions that exist in the shipped inventory but not in this database.
 *
 * The migration only ever patches fields on rows that are already there — it
 * must not silently resurrect anything the user deleted on purpose. Anything
 * added to the seed later therefore needs this explicit comparison.
 */
export function missingFromSeed(db: DB): Tank[] {
  const have = new Set(db.tanks.map((t) => t.id))
  return SEED.tanks.filter((t) => !have.has(t.id))
}

export function addMissingSeedItems(): number {
  const missing = missingFromSeed(store.getSnapshot().db)
  if (missing.length === 0) return 0
  store.mutate(
    (db) => {
      db.tanks = [...db.tanks, ...missing.map((t) => ({ ...t, photos: [...t.photos], tags: [...t.tags] }))]
    },
    { kind: 'settings', text: `${missing.length} Positionen aus dem Ausgangsbestand ergänzt` },
  )
  return missing.length
}

/**
 * Positions whose measurements exist in the starting stock but not yet in this
 * database. Same reason the missing-positions reconciliation exists: migrate()
 * never touches a row that is already there, so anything measured after the
 * database was created only arrives through a visible, opt-in step.
 *
 * Only ever fills an empty field — a measurement typed in by hand always wins.
 */
export function measuredInSeed(db: DB): { tank: Tank; dims: NonNullable<Tank['dims']> }[] {
  const seeded = new Map(SEED.tanks.filter((t) => t.dims).map((t) => [t.id, t.dims!]))
  return db.tanks
    .filter((t) => !t.dims && seeded.has(t.id))
    .map((t) => ({ tank: t, dims: seeded.get(t.id)! }))
}

export function addMissingSeedDims(): number {
  const todo = measuredInSeed(store.getSnapshot().db)
  if (todo.length === 0) return 0
  const byId = new Map(todo.map((x) => [x.tank.id, x.dims]))
  store.mutate(
    (db) => {
      for (const t of db.tanks) {
        const d = byId.get(t.id)
        if (d && !t.dims) {
          t.dims = { ...d }
          t.updatedAt = now()
        }
      }
    },
    { kind: 'settings', text: `Maße für ${todo.length} Positionen übernommen` },
  )
  return todo.length
}

/**
 * Gruppenhinweise, die im Ausgangsbestand stehen und in dieser Datenbank noch
 * fehlen. Derselbe Grund wie bei Positionen und Maßen: migrate() lässt eine
 * vorhandene Kategorie unangetastet, ein später hinzugekommener Text erreicht eine
 * bestehende Datenbank also nur über einen sichtbaren Schritt.
 *
 * Füllt ausschließlich ein leeres Feld — ein selbst geschriebener Hinweis gewinnt.
 */
export function notesInSeed(db: DB): { id: string; label: string; note: string }[] {
  const seeded = new Map(SEED.settings.categories.filter((c) => c.note).map((c) => [c.id, c.note!]))
  return db.settings.categories
    .filter((c) => !c.note?.trim() && seeded.has(c.id))
    .map((c) => ({ id: c.id, label: c.label, note: seeded.get(c.id)! }))
}

export function addMissingSeedNotes(): number {
  const todo = notesInSeed(store.getSnapshot().db)
  if (todo.length === 0) return 0
  const byId = new Map(todo.map((x) => [x.id, x.note]))
  store.mutate(
    (db) => {
      db.settings.categories = db.settings.categories.map((c) =>
        byId.has(c.id) && !c.note?.trim() ? { ...c, note: byId.get(c.id) } : c,
      )
    },
    { kind: 'settings', text: `Gruppenhinweis für ${todo.length} ${todo.length === 1 ? 'Kategorie' : 'Kategorien'} übernommen` },
  )
  return todo.length
}

/**
 * Wortgrenzen, die im Ausgangsbestand hinterlegt sind und beim vorhandenen Portal
 * noch fehlen. Die Portalliste ist Nutzerdatei — migrate() rührt sie nicht an,
 * sonst käme jedes selbst angelegte Portal beim nächsten Laden wieder weg. Also
 * derselbe sichtbare Abgleich wie bei Maßen und Paketen.
 */
export function wordLimitsInSeed(db: DB): { id: string; name: string; words: number }[] {
  const seeded = new Map(SEED.settings.portals.filter((p) => p.bodyWords).map((p) => [p.id, p.bodyWords!]))
  return db.settings.portals
    // Nur wo NICHTS steht. Eine bewusst gesetzte 0 heißt "keine Wortgrenze" und ist
    // eine Entscheidung — bei `!p.bodyWords` käme die Karte nach jedem Abwählen
    // wieder und würde die 0 überschreiben.
    .filter((p) => p.bodyWords === undefined && seeded.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, words: seeded.get(p.id)! }))
}

export function addMissingSeedWordLimits(): number {
  const todo = wordLimitsInSeed(store.getSnapshot().db)
  if (todo.length === 0) return 0
  const byId = new Map(todo.map((x) => [x.id, x.words]))
  store.mutate(
    (db) => {
      db.settings.portals = db.settings.portals.map((p) =>
        byId.has(p.id) && p.bodyWords === undefined ? { ...p, bodyWords: byId.get(p.id) } : p,
      )
    },
    { kind: 'settings', text: `Wortgrenze für ${todo.length} ${todo.length === 1 ? 'Portal' : 'Portale'} übernommen` },
  )
  return todo.length
}

/**
 * Angebotspakete, die im Ausgangsbestand stehen und hier noch fehlen. Gleiche
 * Regel wie überall: migrate() lässt eine vorhandene Liste unangetastet, sonst
 * käme jedes selbst geschnürte Paket beim nächsten Laden wieder weg.
 */
export function bundlesInSeed(db: DB): typeof SEED.settings.bundles {
  const have = new Set(db.settings.bundles.map((b) => b.id))
  return SEED.settings.bundles.filter((b) => !have.has(b.id))
}

export function addMissingSeedBundles(): number {
  const missing = bundlesInSeed(store.getSnapshot().db)
  if (missing.length === 0) return 0
  store.mutate(
    (db) => {
      db.settings.bundles = [
        ...db.settings.bundles,
        ...missing.map((b) => ({ ...b, ids: [...b.ids], giftIds: [...b.giftIds] })),
      ]
    },
    { kind: 'settings', text: `${missing.length} Angebotspakete aus dem Ausgangsbestand ergänzt` },
  )
  return missing.length
}

/**
 * Eine eingegangene Nachricht am Interessenten ablegen.
 *
 * Der Wortlaut ist der einzige Beleg dafür, warum später etwas reserviert oder
 * abgesagt wurde. Er hängt am Interessenten und nicht an einem eigenen
 * Wurzelschlüssel — migrate() baut sein Rückgabeobjekt aus einer festen Liste
 * und würde alles Neue beim Laden verwerfen.
 */
export function noteOnLead(leadId: string, text: string, applied: string[], fromImage = false) {
  store.mutate(
    (db) => {
      const l = db.leads.find((x) => x.id === leadId)
      if (!l) return
      const entry = { at: now(), text: trimMessage(text), fromImage: fromImage || undefined, applied }
      // Gedeckelt, weil db.json bei jedem Speichern vollständig geschrieben wird.
      l.messages = [entry, ...(l.messages ?? [])].slice(0, MAX_PER_LEAD)
      l.lastContact = new Date().toISOString().slice(0, 10)
      l.updatedAt = now()
    },
    { kind: 'lead', text: 'Nachricht vermerkt' },
  )
}

/** Positionen an einen Interessenten hängen — getrennt vom Anlegen der Person. */
export function attachTanks(leadId: string, tankIds: string[]) {
  store.mutate(
    (db) => {
      const l = db.leads.find((x) => x.id === leadId)
      if (!l) return
      l.tankIds = [...new Set([...l.tankIds, ...tankIds])]
      l.updatedAt = now()
      for (const id of tankIds) {
        const t = db.tanks.find((x) => x.id === id)
        if (t && t.status === 'verfuegbar') {
          t.status = 'kontakt'
          t.leadId = leadId
          t.updatedAt = now()
        }
      }
    },
    { kind: 'lead', text: `${tankIds.length} Positionen angehängt` },
  )
}

/**
 * Einen geprüften Vorschlag ausführen. Gibt zurück, welcher Interessent danach
 * gilt — nachfolgende Vorschläge hängen daran.
 */
/**
 * Einen Vorschlag ausführen.
 *
 * `done` leer heißt: es ist NICHTS passiert, und `skipped` sagt warum. Vorher
 * wertete die Oberfläche ein leeres `done` als Erfolg (`res.done || p.title`) —
 * ein Gebot ohne Angebot und ein Angebot ohne Positionen meldeten Vollzug und
 * schrieben nichts.
 */
export function applyProposal(p: Proposal, leadId: string | null, message: string): { leadId: string | null; done: string; skipped?: string } {
  const db = store.getSnapshot().db
  const target = p.leadId ?? leadId

  switch (p.kind) {
    case 'lead.neu': {
      // Ohne tankIds: das Anlegen einer Person darf nicht still den Bestand ändern.
      const id = addLead({ name: p.name || p.email || 'Unbenannt', email: p.email, phone: p.phone, source: 'kleinanzeigen', stage: 'neu', tankIds: [] })
      noteOnLead(id, message, [describe(p)])
      return { leadId: id, done: p.title }
    }
    case 'lead.notiz': {
      if (!target) return { leadId, done: '', skipped: 'kein Interessent vorhanden' }
      noteOnLead(target, message, [describe(p)])
      return { leadId: target, done: p.title }
    }
    case 'lead.phase': {
      if (!target || !p.stage) return { leadId, done: '', skipped: 'kein Interessent vorhanden' }
      patchLead(target, { stage: p.stage }, p.title)
      return { leadId: target, done: p.title }
    }
    case 'positionen': {
      if (!target) return { leadId, done: '', skipped: 'kein Interessent vorhanden' }
      const ids = p.pick ? resolvePick(db, p.pick) : p.tankIds
      if (ids.length === 0) return { leadId: target, done: '', skipped: 'keine dieser Positionen ist noch frei' }
      attachTanks(target, ids)
      return { leadId: target, done: `${p.title} (${collapseIds(ids)})` }
    }
    case 'gebot': {
      if (p.amount == null) return { leadId, done: '', skipped: 'kein Betrag' }
      // Das jüngste offene Angebot. Ein angenommenes gehört zu einem gebuchten
      // Verkauf — daran ist nichts mehr zu verhandeln.
      const quote = openQuotesOf(db, target)[0] ?? null
      if (quote) {
        patchQuote(quote.id, { buyerOffer: p.amount }, `Gebot ${p.amount} € vermerkt`)
        return { leadId: target, done: p.title }
      }
      const hit = p.tankIds.map((id) => db.tanks.find((x) => x.id === id)).filter((t): t is Tank => !!t)
      if (hit.length === 0) return { leadId: target, done: '', skipped: 'kein Angebot und keine Position, an der es hängen könnte' }
      for (const t of hit) setTankOffer(t, p.amount)
      return { leadId: target, done: p.title }
    }
    case 'angebot': {
      if (!target) return { leadId, done: '', skipped: 'kein Interessent vorhanden' }
      const lead = db.leads.find((l) => l.id === target)
      // Verkauftes gehört in kein neues Angebot. `lead.tankIds` behält gekaufte
      // Positionen — ohne diesen Filter entstand aus „Hätten Sie noch etwas
      // Passendes?“ ein Angebot über Ware, die derselbe Mensch schon besitzt.
      const wanted = p.tankIds.length ? p.tankIds : (lead?.tankIds ?? [])
      const ids = wanted.filter((id) => db.tanks.some((t) => t.id === id && t.status !== 'verkauft'))
      if (ids.length === 0) {
        return { leadId: target, done: '', skipped: wanted.length ? 'alle diese Positionen sind verkauft' : 'keine Positionen zugeordnet' }
      }
      // Der geforderte Preis kommt aus dem Bestand. Ein Preis, den ein
      // Sprachmodell nennt, hat in einem Angebot nichts verloren.
      createQuote({
        label: `Anfrage ${lead?.name ?? ''}`.trim(),
        tankIds: ids,
        askPrice: askFor(db, ids),
        leadId: target,
        portalId: null,
        note: '',
      })
      return { leadId: target, done: p.title }
    }
    case 'reservieren': {
      for (const id of p.tankIds) {
        const t = db.tanks.find((x) => x.id === id)
        if (t) setTankStatus(t, 'reserviert')
      }
      if (target) patchLead(target, { stage: 'reserviert' }, 'Phase: reserviert')
      return { leadId: target, done: p.title }
    }
    default:
      // verkauf.vorbereiten schreibt nichts — die Oberfläche öffnet den Dialog.
      return { leadId: target, done: '', skipped: 'wird über den Verkaufsdialog gebucht' }
  }
}

// ------------------------------------------------------------------- quotes

/**
 * Die Positionen eines Angebots ändern.
 *
 * Das ging bisher überhaupt nicht: kein einziger `patchQuote`-Aufruf im Projekt
 * fasst `tankIds` an, und die Angebotskarte zeigt die Positionen als Marken ohne
 * Bedienelement. Wer eine Position aus einem Angebot nehmen wollte, musste sie
 * aus dem Bestand löschen.
 *
 * Der geforderte Preis rechnet mit, solange er dem entspricht, was die Regel für
 * die alte Auswahl ergeben hätte — hat der Verkäufer von Hand einen anderen
 * Preis eingetragen, bleibt der stehen.
 */
/**
 * Hält ein Angebot diese Position noch fest?
 *
 * Drei Stellen hatten dafür drei Definitionen. Ein abgelehntes Angebot hält
 * nichts mehr; jedes andere schon — auch ein angenommenes, denn daraus wird
 * der Verkauf.
 */
function heldByQuote(db: DB, tankId: string, exceptQuoteId?: string): boolean {
  return db.quotes.some((q) => q.id !== exceptQuoteId && q.tankIds.includes(tankId) && q.status !== 'abgelehnt')
}

export function setQuoteTanks(quoteId: string, tankIds: string[]) {
  store.mutate(
    (db) => {
      const q = db.quotes.find((x) => x.id === quoteId)
      if (!q) return
      const before = q.tankIds
      // Verkauftes kann niemandem mehr angeboten werden, und was einem anderen
      // versprochen ist, wird nicht still umgehängt. Beide Aufrufer geben ihre
      // Auswahl roh weiter; die Regel gehört deshalb hierher, nicht dorthin.
      const wanted = [...new Set(tankIds)].filter((id) => {
        const t = db.tanks.find((x) => x.id === id)
        if (!t || t.status === 'verkauft') return false
        return !(t.status === 'reserviert' && t.leadId && t.leadId !== q.leadId)
      })
      // Ein Angebot über nichts ist kein Angebot — es stünde mit 0 € da und
      // ließe sich trotzdem als Verkauf buchen.
      if (wanted.length === 0) return
      const auto = askFor(db, before)
      q.tankIds = wanted
      if (q.askPrice === auto) q.askPrice = askFor(db, wanted)
      q.updatedAt = now()

      // Neu dazugekommene binden, weggefallene freigeben — dieselbe Regel wie
      // beim Anlegen und Löschen eines Angebots.
      for (const id of wanted.filter((x) => !before.includes(x))) {
        const t = db.tanks.find((x) => x.id === id)
        if (t && t.status === 'verfuegbar') {
          t.status = 'kontakt'
          // Ein Angebot ohne Interessent darf den Käufer nicht wegwischen, den
          // die Position schon hatte — createQuote hält es genauso.
          t.leadId = q.leadId ?? t.leadId
          t.updatedAt = now()
        }
      }
      for (const id of before.filter((x) => !wanted.includes(x))) {
        const t = db.tanks.find((x) => x.id === id)
        if (!t || t.status !== 'kontakt') continue
        const heldElsewhere = heldByQuote(db, id, quoteId)
        const stillWanted = db.leads.some((l) => l.id === t.leadId && l.tankIds.includes(id))
        if (heldElsewhere || stillWanted) continue
        t.status = 'verfuegbar'
        t.leadId = null
        t.updatedAt = now()
      }
    },
    { kind: 'deal', text: `Angebot: ${tankIds.length} ${tankIds.length === 1 ? 'Position' : 'Positionen'}` },
  )
}

/** Turn a selection of tanks into an offer, keeping the price ladder intact. */
export function createQuote(input: {
  label: string
  tankIds: string[]
  askPrice: number
  leadId: string | null
  portalId: string | null
  note: string
}): string {
  const id = newId('Q')
  store.mutate(
    (db) => {
      db.quotes.unshift({
        id,
        label: input.label || 'Angebot',
        leadId: input.leadId,
        portalId: input.portalId,
        tankIds: input.tankIds,
        askPrice: input.askPrice,
        buyerOffer: null,
        status: 'entwurf',
        validUntil: null,
        note: input.note,
        createdAt: now(),
        updatedAt: now(),
      })
      // Tanks in an open offer are no longer simply "available".
      for (const tid of input.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (t && t.status === 'verfuegbar') {
          t.status = 'kontakt'
          t.leadId = input.leadId ?? t.leadId
          t.updatedAt = now()
        }
      }
      if (input.leadId) {
        const l = db.leads.find((x) => x.id === input.leadId)
        if (l && (l.stage === 'neu' || l.stage === 'kontakt')) l.stage = 'angebot'
      }
    },
    { kind: 'deal', text: `Angebot erstellt: ${input.label} über ${input.askPrice} €` },
  )
  return id
}

export function patchQuote(id: string, patch: Partial<Quote>, label?: string) {
  store.mutate(
    (db) => {
      const q = db.quotes.find((x) => x.id === id)
      if (!q) return
      Object.assign(q, patch, { updatedAt: now() })
    },
    label ? { kind: 'deal', text: label } : undefined,
  )
}

export function removeQuote(id: string) {
  store.mutate(
    (db) => {
      const q = db.quotes.find((x) => x.id === id)
      if (!q) return
      db.quotes = db.quotes.filter((x) => x.id !== id)
      // Release tanks that no other open offer still claims.
      for (const tid of q.tankIds) {
        const stillOffered = heldByQuote(db, tid, id)
        const t = db.tanks.find((x) => x.id === tid)
        if (t && !stillOffered && t.status === 'kontakt') {
          t.status = 'verfuegbar'
          t.updatedAt = now()
        }
      }
    },
    { kind: 'deal', text: 'Angebot gelöscht' },
  )
}

/** Accepted offer becomes a booked sale at the price that was actually agreed. */
export function quoteToDeal(quoteId: string): string | null {
  const db = store.getSnapshot().db
  const q = db.quotes.find((x) => x.id === quoteId)
  if (!q) return null
  const price = q.buyerOffer ?? q.askPrice
  const dealId = createDeal({
    label: q.label,
    tankIds: q.tankIds,
    price,
    leadId: q.leadId,
    date: new Date().toISOString().slice(0, 10),
    note: q.note,
  })
  patchQuote(quoteId, { status: 'angenommen' }, `Angebot angenommen: ${q.label}`)
  return dealId
}

// -------------------------------------------------------------------- deals

/** Close a sale: bundle the tanks, book the price once, mark everything sold. */
export function createDeal(input: { label: string; tankIds: string[]; price: number; leadId: string | null; date: string; note: string }): string {
  const id = newId('D')
  store.mutate(
    (db) => {
      db.deals.unshift({
        id,
        label: input.label || 'Verkauf',
        leadId: input.leadId,
        tankIds: input.tankIds,
        price: input.price,
        date: input.date,
        paid: false,
        pickedUp: false,
        note: input.note,
      })
      for (const tid of input.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (!t) continue
        t.status = 'verkauft'
        t.dealId = id
        t.leadId = input.leadId ?? t.leadId
        t.updatedAt = now()
      }
      if (input.leadId) {
        const l = db.leads.find((x) => x.id === input.leadId)
        if (l) l.stage = 'gewonnen'
      }
    },
    { kind: 'deal', text: `Verkauf gebucht: ${input.label} für ${input.price} €` },
  )
  return id
}

export function patchDeal(id: string, patch: Partial<DB['deals'][number]>, label?: string) {
  store.mutate(
    (db) => {
      const d = db.deals.find((x) => x.id === id)
      if (!d) return
      Object.assign(d, patch)
    },
    label ? { kind: 'deal', text: label } : undefined,
  )
}

/**
 * Assign (or clear) the buyer on an already-booked sale. The tanks follow along,
 * the new lead counts as won, and a previous buyer left without any other sale
 * drops back to "Angebot" instead of staying falsely marked as won.
 */
export function assignDealLead(dealId: string, leadId: string | null) {
  store.mutate(
    (db) => {
      const deal = db.deals.find((d) => d.id === dealId)
      if (!deal) return
      const previousId = deal.leadId
      if (previousId === leadId) return

      deal.leadId = leadId
      for (const tid of deal.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (t) {
          t.leadId = leadId
          t.updatedAt = now()
        }
      }

      if (leadId) {
        const lead = db.leads.find((l) => l.id === leadId)
        if (lead) {
          lead.stage = 'gewonnen'
          lead.updatedAt = now()
        }
      }

      // Das Angebot, aus dem der Verkauf entstand, gehört demselben Menschen.
      // Sonst nannten Angebot, Verkauf und Bestand drei verschiedene Namen.
      const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
      for (const q of db.quotes) {
        if (q.leadId === previousId && sameSet(q.tankIds, deal.tankIds)) q.leadId = leadId
      }

      if (previousId) {
        const stillBuying = db.deals.some((d) => d.id !== dealId && d.leadId === previousId)
        const previous = db.leads.find((l) => l.id === previousId)
        if (previous && !stillBuying) {
          previous.stage = 'angebot'
          previous.updatedAt = now()
        }
      }
    },
    { kind: 'deal', text: leadId ? 'Käufer zugeordnet' : 'Käufer entfernt' },
  )
}

/** Undo a sale — the tanks go back on the market. */
/**
 * Einen Verkauf vollständig zurücknehmen.
 *
 * Vorher blieb dreierlei stehen: der Käufer auf „gewonnen", `leadId` an der
 * Position (womit `resolvePick` sie dauerhaft übersprang) und ein über ein
 * Angebot gebuchter Verkauf ließ das Angebot auf „angenommen". Solange das so
 * war, durfte Buchen nirgends bequem werden — genau das ist jetzt der Punkt.
 */
export function removeDeal(dealId: string) {
  store.mutate(
    (db) => {
      const deal = db.deals.find((d) => d.id === dealId)
      if (!deal) return
      const others = db.deals.filter((d) => d.id !== dealId)

      for (const tid of deal.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (!t) continue
        // Führt ein ANDERER Verkauf dieselbe Position, bleibt sie verkauft.
        // `t.dealId` zeigt nur auf den zuletzt gebuchten; ohne diese Prüfung kam
        // sie als frei zurück, während der ältere Verkauf sie noch führte — und
        // ließ sich ein drittes Mal verkaufen.
        const heldElsewhere = others.find((d) => d.tankIds.includes(tid))
        if (heldElsewhere) {
          t.dealId = heldElsewhere.id
          t.updatedAt = now()
          continue
        }
        t.dealId = null
        // Der Käufer hängt nicht mehr dran. Ohne das übersprang `resolvePick`
        // die Position auf Dauer — sie war „verfügbar" und trotzdem unsichtbar.
        t.leadId = null
        t.status = 'verfuegbar'
        t.updatedAt = now()
      }

      // Nur das Angebot, das wirklich zu diesem Verkauf gehört. Ein Verkauf trägt
      // keine Angebotsnummer, also entscheiden die Positionen — über `leadId`
      // allein wurde jedes angenommene Angebot desselben Käufers zurückgesetzt,
      // auch das eines anderen, noch gebuchten Verkaufs.
      const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
      for (const q of db.quotes) {
        if (q.status !== 'angenommen') continue
        if (q.leadId !== deal.leadId || !sameSet(q.tankIds, deal.tankIds)) continue
        if (others.some((d) => sameSet(d.tankIds, q.tankIds))) continue
        q.status = 'gesendet'
        q.updatedAt = now()
      }

      // Dieselbe Rückstufung, die assignDealLead beim Umhängen schon macht.
      if (deal.leadId) {
        const stillBuying = others.some((d) => d.leadId === deal.leadId)
        const lead = db.leads.find((l) => l.id === deal.leadId)
        if (lead && !stillBuying && lead.stage === 'gewonnen') {
          lead.stage = db.quotes.some((q) => q.leadId === lead.id) ? 'angebot' : 'kontakt'
          lead.updatedAt = now()
        }
      }
      db.deals = db.deals.filter((d) => d.id !== dealId)
    },
    { kind: 'deal', text: 'Verkauf zurückgenommen' },
  )
}

/**
 * Positionen wieder von einem Interessenten lösen.
 *
 * Das Gegenstück zu attachTanks hat gefehlt: hakte man im Interessentendialog
 * eine Position ab, blieb sie auf „im Kontakt" mit gesetztem `leadId` hängen und
 * war für jeden anderen Käufer unsichtbar verbraucht.
 */
export function detachTanks(leadId: string, tankIds: string[]) {
  if (tankIds.length === 0) return
  store.mutate(
    (db) => {
      const l = db.leads.find((x) => x.id === leadId)
      if (l) l.tankIds = l.tankIds.filter((id) => !tankIds.includes(id))
      for (const id of tankIds) {
        const t = db.tanks.find((x) => x.id === id)
        // Ein Angebot, das die Position noch führt, hält sie fest. Ohne das gab
        // ein Häkchen weniger im Interessentendialog eine Position frei, die im
        // selben Bild daneben als „im Angebot" markiert stand — und die danach
        // jedem anderen Angebot und jedem Katalogpaket wieder offenstand,
        // während „Als Verkauf buchen" sie noch verkaufen konnte.
        if (heldByQuote(db, id)) continue
        // Verkauftes und Reserviertes bleibt, wo es ist — das löst kein Abhaken.
        if (t && t.leadId === leadId && t.status === 'kontakt') {
          t.leadId = null
          t.status = 'verfuegbar'
          t.updatedAt = now()
        }
      }
    },
    { kind: 'tank', text: `${tankIds.length} ${tankIds.length === 1 ? 'Position' : 'Positionen'} freigegeben` },
  )
}

// ---------------------------------------------------------------------- ads

/** One ad per portal — same inventory, wording tuned to each audience. */
export function createAdsForPortals(db: DB, scope: AdScope, portalIds: string[]): string[] {
  return portalIds.map((pid) => createAd(db, scope, pid))
}

export function createAd(db: DB, scope: AdScope, portalId: string): string {
  const id = newId('AD')
  const portal = portalOf(db, portalId)
  const gen = generateAd(db, scope, portal)
  store.mutate(
    (draft) => {
      draft.ads.unshift({
        id,
        portalId,
        title: gen.title,
        body: gen.body,
        price: gen.price,
        priceType: gen.priceType,
        url: '',
        scope,
        tankIds: gen.tankIds,
        status: 'entwurf',
        publishedAt: null,
        bumpedAt: null,
        views: null,
        stamp: gen.stamp,
        note: '',
        createdAt: now(),
        updatedAt: now(),
      })
    },
    { kind: 'ad', text: `Anzeige für ${portal?.name ?? portalId} erstellt` },
  )
  return id
}

export function patchAd(id: string, patch: Partial<Ad>, label?: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      Object.assign(a, patch, { updatedAt: now() })
    },
    label ? { kind: 'ad', text: label } : undefined,
  )
}

/** Pull the ad's text back in line with the current inventory. */
export function refreshAd(id: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      const gen = generateAd(db, a.scope, portalOf(db, a.portalId))
      a.title = gen.title
      a.body = gen.body
      a.price = gen.price
      a.tankIds = gen.tankIds
      a.stamp = gen.stamp
      a.updatedAt = now()
    },
    { kind: 'ad', text: 'Anzeigentext aktualisiert' },
  )
}

export function markAdPublished(id: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      a.status = 'online'
      a.publishedAt = now()
      a.bumpedAt = now()
      a.updatedAt = now()
    },
    { kind: 'ad', text: 'Anzeige als online markiert' },
  )
}

export function bumpAd(id: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      a.bumpedAt = now()
      a.updatedAt = now()
    },
    { kind: 'ad', text: 'Anzeige hochgeholt' },
  )
}

export function removeAd(id: string) {
  store.mutate((db) => {
    db.ads = db.ads.filter((a) => a.id !== id)
  }, { kind: 'ad', text: 'Anzeige gelöscht' })
}

// ----------------------------------------------------------------- settings

export function upsertCategory(cat: DB['settings']['categories'][number]) {
  store.mutate(
    (db) => {
      const i = db.settings.categories.findIndex((c) => c.id === cat.id)
      if (i >= 0) db.settings.categories[i] = cat
      else db.settings.categories.push(cat)
    },
    { kind: 'settings', text: `Kategorie gespeichert: ${cat.label}` },
  )
}

/** Refused while positions still point at it — silently orphaning them would be worse. */
export function removeCategory(id: string): string | null {
  const db = store.getSnapshot().db
  const used = db.tanks.filter((t) => t.category === id).length
  if (used > 0) return `${used} Positionen gehören noch zu dieser Kategorie.`
  store.mutate((draft) => {
    draft.settings.categories = draft.settings.categories.filter((c) => c.id !== id)
  }, { kind: 'settings', text: 'Kategorie entfernt' })
  return null
}

export function upsertPortal(portal: DB['settings']['portals'][number]) {
  store.mutate(
    (db) => {
      const i = db.settings.portals.findIndex((p) => p.id === portal.id)
      if (i >= 0) db.settings.portals[i] = portal
      else db.settings.portals.push(portal)
    },
    { kind: 'settings', text: `Portal gespeichert: ${portal.name}` },
  )
}

/** Removing a portal leaves its ads intact — they simply fall back to default limits. */
export function removePortal(portalId: string) {
  store.mutate(
    (db) => {
      db.settings.portals = db.settings.portals.filter((p) => p.id !== portalId)
    },
    { kind: 'settings', text: 'Portal entfernt' },
  )
}

export function patchSettings(patch: Partial<DB['settings']>, label = 'Einstellungen geändert') {
  store.mutate((db) => {
    db.settings = { ...db.settings, ...patch }
  }, { kind: 'settings', text: label })
}
