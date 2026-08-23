import { amountInText, mentionsMaker, type ProposalKind, type RawProposal } from './ai'
import { type ParsedMessage } from './ads'
import { eur, itemLabel, num } from './format'
import { buildCatalog } from './catalog'
import { priceSelection } from './bundles'
import { isOpen } from './stats'
import type { DB, Lead, Tank } from '../types'

/**
 * Aus Vorschlägen der KI werden erst dann Vorschläge für den Verkäufer, wenn sie
 * sich am Text UND am Bestand nachrechnen lassen.
 *
 * Die Prüfung ist der eigentliche Wert dieser Datei. Ein Modell, das eine
 * Telefonnummer für ein Gebot hält oder einen Nachnamen für einen Hersteller,
 * darf davon nichts in die Datenbank bringen — und wo sich etwas grundsätzlich
 * nicht prüfen lässt (Absicht, Verbindlichkeit), wird der Vorschlag nicht
 * abgelehnt, sondern als Vermutung ausgewiesen und nicht vorangekreuzt.
 */

export interface Proposal {
  id: string
  kind: ProposalKind
  /** Was der Verkäufer liest. */
  title: string
  /** Was es im Bestand anrichtet, im Klartext. Leer, wenn nichts. */
  effect: string
  /** Das Zitat, auf das sich der Vorschlag stützt. */
  quote: string
  /** Belegt = am Text nachgerechnet. Vermutung = nicht prüfbar. */
  proven: boolean
  /** Ändert es die öffentliche Liste? Dann eigene Klasse. */
  publishes: boolean
  leadId: string | null
  name: string
  email: string
  phone: string
  stage: Lead['stage'] | null
  amount: number | null
  tankIds: string[]
  /** Bei baugleicher Ware: wie viele Stück wovon, ohne erfundene Nummern. */
  pick: { count: number; what: string; from: string[] } | null
  warning: string | null
}

export interface Reading {
  intent: string
  summary: string
  /** Bei einem Bild: was die KI abgelesen hat. Das ist der Text, gegen den geprüft wird. */
  transcript: string
  proposals: Proposal[]
  dropped: string[]
}

/** Ziffern only, und die deutsche 0 vorn wie die 49 als dasselbe lesen. */
export function phoneKey(s: string): string {
  const d = s.replace(/\D/g, '')
  return d.replace(/^(?:0049|49|0)/, '').slice(-9)
}

const mailKey = (s: string) => s.trim().toLowerCase()

/**
 * Denselben Interessenten wiederfinden. Nur E-Mail und Telefonnummer sind
 * Schlüssel — ein Name nicht: bei leerem Namen steht "Unbenannt" drin, und zwei
 * Müller zusammenzulegen ist der teurere Fehler.
 */
export function findLead(db: DB, email: string, phone: string): Lead | null {
  const mail = mailKey(email)
  if (mail) {
    const hit = db.leads.find((l) => mailKey(l.email) === mail)
    if (hit) return hit
  }
  const tel = phoneKey(phone)
  if (tel.length >= 6) {
    const hit = db.leads.find((l) => phoneKey(l.phone) === tel)
    if (hit) return hit
  }
  return null
}

/** Wie viele offene Positionen dieselbe Literzahl haben. */
const sameLitres = (db: DB, litres: number) => db.tanks.filter((t) => isOpen(t) && t.litres === litres).length

/**
 * Trägt der Text diese Position — und trägt er sie EINDEUTIG?
 *
 * Eine Literzahl allein reicht nur, wenn genau eine offene Position sie hat. Bei
 * 1.650 l sind es drei, bei 225 l neunundzwanzig. Der Typ allein reicht nie.
 */
function positionProven(tank: Tank, text: string, db: DB): boolean {
  const hay = text.toLowerCase()
  if (hay.includes(tank.id.toLowerCase())) return true
  if (tank.litres > 0 && sameLitres(db, tank.litres) === 1) {
    if (hay.includes(String(tank.litres)) || hay.includes(tank.litres.toLocaleString('de-DE'))) return true
  }
  if (tank.maker !== 'Sonstige' && mentionsMaker(tank.maker, text)) {
    // Hersteller zählt nur, wenn er nicht selbst mehrdeutig ist.
    const ofMaker = db.tanks.filter((t) => isOpen(t) && t.maker === tank.maker)
    if (ofMaker.length === 1) return true
  }
  return false
}

/**
 * Spricht der Text die WARENGRUPPE überhaupt an?
 *
 * Ohne diese Hürde wurde aus "Viele Grüße, Thomas Schneider" ein Vorschlag,
 * die Exzenterschneckenpumpe für 3.500 € anzuhängen — der Nachname reichte.
 * Für eine Vermutung muss wenigstens die Literzahl oder die Bauart dastehen.
 */
function groupMentioned(tank: Tank, text: string): boolean {
  const hay = fold(text)
  if (tank.litres > 0 && (hay.includes(String(tank.litres)) || hay.includes(tank.litres.toLocaleString('de-DE')))) return true
  // Wortanfang oder Wortende zählen, damit "Rundtanks" auf "Rundtank" passt und
  // "Fässer" auf "Dekofass" — im Plural wandert der Umlaut hinein, deshalb wird
  // vorher gefaltet.
  return fold(tank.type)
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4)
    .some((w) => hay.includes(w.slice(0, 5)) || hay.includes(w.slice(-4)))
}

/** Umlaute und ß einebnen: "Fässer" und "Dekofass" teilen sich sonst keinen Stamm. */
const fold = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')

/** Deckt der Vorschlag eine ganze Gruppe baugleicher Ware vollständig ab? */
function coversWholeGroup(tanks: Tank[], db: DB): boolean {
  if (tanks.length === 0) return false
  const litres = tanks[0].litres
  if (litres <= 0 || tanks.some((t) => t.litres !== litres)) return false
  return tanks.length === sameLitres(db, litres)
}

const newId = () => Math.random().toString(36).slice(2, 9)

/**
 * Aus dem, was das Modell zurückgibt, wird geprüfter Vorschlag oder Ausschuss.
 * `text` ist bei einem Bild das Transkript — sonst hätte die Prüfung nichts,
 * woran sie sich halten könnte.
 */
export function checkProposals(raw: RawProposal[], text: string, db: DB): { proposals: Proposal[]; dropped: string[] } {
  const dropped: string[] = []
  const proposals: Proposal[] = []
  const hay = text.toLowerCase()

  for (const p of raw) {
    const quote = String(p.quote ?? '').trim()
    // Ohne Beleg kein Vorschlag. Und der Beleg muss auch wirklich dastehen.
    if (!quote) {
      dropped.push(`${p.kind}: ohne Zitat`)
      continue
    }
    const short = quote.replace(/\s+/g, ' ').slice(0, 40).toLowerCase()
    if (short.length > 12 && !hay.replace(/\s+/g, ' ').includes(short)) {
      dropped.push(`${p.kind}: das Zitat „${quote.slice(0, 40)}…“ steht so nicht in der Nachricht`)
      continue
    }

    const lead = p.leadId ? (db.leads.find((l) => l.id === p.leadId) ?? null) : null
    const base: Proposal = {
      id: newId(),
      kind: p.kind,
      title: '',
      effect: '',
      quote,
      proven: true,
      publishes: false,
      leadId: lead?.id ?? null,
      name: '',
      email: '',
      phone: '',
      stage: null,
      amount: null,
      tankIds: [],
      pick: null,
      warning: null,
    }

    // Kontaktdaten müssen wörtlich dastehen — sonst sind sie geraten.
    const email = String(p.email ?? '').trim()
    const phone = String(p.phone ?? '').trim()
    const name = String(p.name ?? '').trim()
    base.email = email && hay.includes(email.toLowerCase()) ? email : ''
    base.phone = phone && text.replace(/\D/g, '').includes(phone.replace(/\D/g, '')) ? phone : ''
    base.name = name && hay.includes(name.toLowerCase().split(/\s+/)[0]) ? name : ''

    switch (p.kind) {
      case 'lead.neu': {
        if (!base.name && !base.email && !base.phone) {
          dropped.push('Interessent anlegen: weder Name noch Kontaktweg stehen in der Nachricht')
          continue
        }
        const dupe = findLead(db, base.email, base.phone)
        if (dupe) {
          // Dieselbe Person schreibt zum zweiten Mal — dann keine Dublette.
          base.kind = 'lead.notiz'
          base.leadId = dupe.id
          base.title = `Nachricht bei ${dupe.name} vermerken`
          base.effect = 'Der Wortlaut wird an den Interessenten gehängt, letzter Kontakt auf heute.'
        } else {
          base.title = `Interessent anlegen: ${base.name || base.email || base.phone}`
          base.effect = 'Legt nur die Person an. Positionen werden nicht angehängt.'
        }
        break
      }

      case 'lead.notiz': {
        if (!lead) {
          dropped.push('Notiz: der genannte Interessent existiert nicht')
          continue
        }
        base.title = `Nachricht bei ${lead.name} vermerken`
        base.effect = 'Der Wortlaut wird angehängt, letzter Kontakt auf heute.'
        break
      }

      case 'lead.phase': {
        if (!lead) {
          dropped.push('Phase ändern: der genannte Interessent existiert nicht')
          continue
        }
        const stage = p.stage as Lead['stage']
        if (!['kontakt', 'angebot', 'verloren'].includes(stage)) {
          dropped.push(`Phase „${p.stage}“ darf nicht aus einer Nachricht kommen`)
          continue
        }
        base.stage = stage
        base.title = `${lead.name}: Phase auf ${stage === 'verloren' ? 'verloren' : stage}`
        // Eine Absage ändert NUR die Phase. Positionen freigeben ist eine
        // eigene Entscheidung — sonst gibt eine falsch zugeordnete Absage
        // reservierte Ware wieder öffentlich frei.
        base.effect = stage === 'verloren' ? 'Ändert nur die Phase. Positionen bleiben, wo sie sind.' : 'Ändert nur die Phase.'
        base.proven = stage !== 'verloren' || /kein interesse|anderweitig|abgesagt|erledigt|zu teuer|doch nicht|anders entschieden/i.test(text)
        if (!base.proven) base.warning = 'Ob das wirklich eine Absage ist, lässt sich am Text nicht sicher sagen.'
        break
      }

      case 'positionen': {
        const ids = (p.positionIds ?? []).map((x) => String(x).toUpperCase())
        const open = ids.map((id) => db.tanks.find((t) => t.id === id)).filter((t): t is Tank => !!t && isOpen(t))
        const good = open.filter((t) => positionProven(t, text, db))
        const ambiguous = open.filter((t) => !positionProven(t, text, db))

        // Eine Vermutung braucht wenigstens einen Anhaltspunkt im Text. Sonst ist
        // sie nichts als ein Einfall des Modells.
        const hinted = ambiguous.filter((t) => groupMentioned(t, text))
        if (ambiguous.length > 0 && hinted.length === 0 && good.length === 0) {
          dropped.push('Positionen: die Nachricht spricht diese Ware gar nicht an')
          continue
        }
        if (hinted.length > 0 || (p.count && p.count > 0 && good.length === 0)) {
          // Bei baugleicher Ware gibt es keine richtige Nummer. Der Vorschlag
          // nennt deshalb Anzahl und Art, die Zuordnung passiert beim Bestätigen
          // nach einer festen Regel — sichtbar, nicht als Modellentscheidung.
          const what = String(p.what ?? '').trim() || (hinted[0] ? itemLabel(hinted[0]) : 'Positionen')
          // Derselbe Filter, den `resolvePick` beim Ausführen anlegt. Fehlte er
          // hier, versprach der Vorschlag „2 × Rundtank“ und hängte am Ende
          // einen oder keinen an — Vollzugsmeldung ohne Vollzug.
          const from = (hinted.length ? hinted : open).filter((t) => !t.leadId || t.leadId === base.leadId).map((t) => t.id)
          // Nennt das Modell keine Anzahl, ist es EINE. Vorher stand hier
          // `ambiguous.length` — aus „Fässer" wären damit alle 31 geworden.
          const count = Math.max(1, Math.min(p.count && p.count > 0 ? p.count : 1, from.length))
          if (from.length === 0) {
            dropped.push('Positionen: keine davon ist noch frei')
            continue
          }
          // Die Anzahl im Titel ist die, die auch ankommt.
          if (count > from.length) {
            base.warning = `Gemeint sind offenbar mehr, frei ${from.length === 1 ? 'ist' : 'sind'} aber nur noch ${from.length}.`
          }
          base.pick = { count, what, from }
          base.tankIds = []
          base.title = `${count} × ${what} anhängen`
          base.effect = from.length === 1
            ? 'Die Position steht danach auf „im Kontakt“ und ist für andere Käufer weg.'
            : `Aus ${from.length} gleichen Positionen ${count === 1 ? 'wird die niedrigste freie' : `werden die ${count} niedrigsten freien`} genommen. Sie ${count === 1 ? 'steht' : 'stehen'} danach auf „im Kontakt“ und ${count === 1 ? 'ist' : 'sind'} für andere Käufer weg.`
          base.proven = false
          base.warning = 'Die Nachricht nennt keine bestimmte Nummer — bitte nachsehen, ob die Anzahl stimmt.'
        } else if (good.length === 0) {
          dropped.push('Positionen: keine davon wird in der Nachricht eindeutig genannt')
          continue
        } else {
          base.tankIds = good.map((t) => t.id)
          const held = good.filter((t) => t.leadId && t.leadId !== base.leadId)
          base.title = `${good.length === 1 ? itemLabel(good[0]) : `${good.length} Positionen`} anhängen`
          base.effect = 'Sie stehen danach auf „im Kontakt“ und sind für andere Käufer weg.'
          if (held.length > 0) {
            base.warning = `${held.map((t) => t.id).join(', ')} ${held.length === 1 ? 'hängt' : 'hängen'} schon bei jemand anderem.`
          }
        }
        break
      }

      case 'gebot': {
        const amount = typeof p.amount === 'number' ? p.amount : null
        if (amount == null || !amountInText(amount, text)) {
          dropped.push(`Gebot ${p.amount ?? '?'}: steht nicht als Geldbetrag in der Nachricht`)
          continue
        }
        base.amount = amount
        base.title = `Gebot ${eur(amount)} eintragen`
        base.effect = 'Wird beim Angebot vermerkt. Ändert nichts am Bestand.'
        // Ein Gebot unter der eigenen Untergrenze muss dastehen, BEVOR jemand
        // zusagt. Vorher wurde es kommentarlos eingetragen.
        const floor = floorFor(db, base.leadId)
        if (floor > 0 && amount < floor) {
          base.warning = `${eur(amount)} liegt unter der Untergrenze von ${eur(floor)} für die betroffenen Positionen.`
        }
        break
      }

      case 'angebot': {
        base.title = 'Angebot als Entwurf anlegen'
        // Der Preis kommt aus dem Bestand, nie vom Modell. Ein Preis, den ein
        // Sprachmodell nennt, hat in einem Angebot nichts verloren.
        base.effect = 'Der geforderte Preis wird aus dem Bestand gerechnet. Das Angebot bleibt Entwurf.'
        break
      }

      case 'reservieren': {
        const ids = (p.positionIds ?? []).map((x) => String(x).toUpperCase())
        const open = ids.map((id) => db.tanks.find((t) => t.id === id)).filter((t): t is Tank => !!t && isOpen(t))
        // Streng: jede Position muss eindeutig benannt sein. Eine Ausnahme gibt es,
        // und die ist selbst eindeutig — "die beiden 3.700er", wenn es genau zwei
        // gibt und beide gemeint sind.
        const whole = coversWholeGroup(open, db) && open.every((t) => groupMentioned(t, text))
        const good = whole ? open : open.filter((t) => positionProven(t, text, db))
        if (good.length === 0) {
          dropped.push('Reservieren: keine eindeutig genannte, freie Position')
          continue
        }
        base.tankIds = good.map((t) => t.id)
        base.publishes = true
        base.proven = false
        base.title = `${good.map((t) => t.id).join(', ')} reservieren`
        base.effect = publicEffect(db, good)
        base.warning = 'Ob wirklich fest zugesagt wurde, lässt sich am Text nicht sicher sagen.'
        break
      }

      case 'verkauf.vorbereiten': {
        // Ein Verkauf wird NICHT gebucht. Eine Nachricht ist kein Zahlungseingang,
        // und createDeal ist die einzige Aktion, die sich nicht sauber zurücknehmen
        // lässt — der Interessent bliebe auf "gewonnen" stehen.
        base.title = 'Verkauf vorbereiten'
        base.effect = 'Bucht nichts. Öffnet den Verkaufsdialog mit dem, was hier steht — buchen musst du selbst.'
        base.proven = false
        break
      }

      default:
        dropped.push(`Unbekannter Vorschlag: ${String(p.kind)}`)
        continue
    }

    proposals.push(base)
  }

  return { proposals, dropped }
}

/**
 * Was eine Reservierung öffentlich anrichtet — ausgerechnet, nicht behauptet.
 * Eine reservierte Position fällt aus den Paketen; bei einem Zweierpaket
 * verschwindet damit das ganze Angebot von der Käuferseite.
 */
function publicEffect(db: DB, tanks: Tank[]): string {
  const ids = new Set(tanks.map((t) => t.id))
  const hit = db.settings.bundles.filter((b) => b.active && [...b.ids, ...b.giftIds].some((id) => ids.has(id)))
  const parts = ['Käufer sehen „reserviert“. Sichtbar in etwa einer Minute.']
  for (const b of hit) {
    const left = b.ids.filter((id) => !ids.has(id)).length
    parts.push(left < Math.max(1, b.minItems)
      ? `Das Paket „${b.label}“ verschwindet dadurch von der Käuferseite.`
      : `Das Paket „${b.label}“ wird kleiner und der Preis rechnet sich neu.`)
  }
  return parts.join(' ')
}

/**
 * Der Preis, den wir für eine Auswahl fordern — aus dem Bestand, nicht aus der
 * Nachricht.
 *
 * Gerechnet wird nach derselben Regel wie auf der Käuferseite: geschnürte Pakete
 * und Mengenstaffel, das für den Käufer Günstigere gewinnt. Vorher war es stur
 * die Summe der Einzelpreise — für die 31 Dekofässer 5.575 € statt der
 * ausgeschriebenen 4.200 €. Ein Angebot, das mehr fordert als die eigene
 * Käuferliste ausschreibt, verliert das Geschäft in dem Moment, in dem der Käufer
 * beides nebeneinander legt.
 */
export function askFor(db: DB, tankIds: string[]): number {
  const chosen = db.tanks.filter((t) => tankIds.includes(t.id))
  if (chosen.length === 0) return 0
  const cat = buildCatalog(db)
  const priced = chosen.map((t) => ({ id: t.id, category: t.category, vb: t.vb }))
  const stock = new Map(cat.items.map((i) => [i.id, { id: i.id, category: i.category, vb: i.vb }]))
  const label = (id: string) => db.settings.categories.find((c) => c.id === id)?.label ?? id
  return priceSelection(priced, cat.bundles, cat.tiers, label, stock).price
}

/**
 * „F-01, F-02, … F-31“ zu „F-01–F-31“.
 *
 * Eine Erfolgsmeldung über 31 Positionen war eine Textwand, in der man den
 * eigentlichen Satz nicht mehr fand.
 */
export function collapseIds(ids: string[]): string {
  const parts = ids
    .map((id) => id.match(/^([A-Z]+)-(\d+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pre: m[1], n: Number(m[2]), id: m[0] }))
    .sort((a, b) => (a.pre === b.pre ? a.n - b.n : a.pre.localeCompare(b.pre)))
  if (parts.length !== ids.length) return ids.join(', ')

  const out: string[] = []
  let i = 0
  while (i < parts.length) {
    let j = i
    while (j + 1 < parts.length && parts[j + 1].pre === parts[i].pre && parts[j + 1].n === parts[j].n + 1) j += 1
    out.push(j - i >= 2 ? `${parts[i].id}–${parts[j].id}` : parts.slice(i, j + 1).map((p) => p.id).join(', '))
    i = j + 1
  }
  return out.join(', ')
}

/**
 * Die Summe der Untergrenzen dessen, worüber gerade verhandelt wird — das
 * offene Angebot des Interessenten, sonst die ihm zugeordneten Positionen.
 */
function floorFor(db: DB, leadId: string | null): number {
  if (!leadId) return 0
  const quote = db.quotes.find((q) => q.leadId === leadId && q.status !== 'abgelehnt')
  const ids = quote?.tankIds ?? db.leads.find((l) => l.id === leadId)?.tankIds ?? []
  return db.tanks.filter((t) => ids.includes(t.id)).reduce((a, t) => a + t.floor, 0)
}

/** Aus „4 × Barriquefass“ werden die vier niedrigsten freien Nummern. */
export function resolvePick(db: DB, pick: NonNullable<Proposal['pick']>): string[] {
  return db.tanks
    .filter((t) => pick.from.includes(t.id) && isOpen(t) && !t.leadId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, pick.count)
    .map((t) => t.id)
}

/** Kurzfassung fürs Protokoll am Interessenten. */
export function describe(p: Proposal): string {
  if (p.tankIds.length) return `${p.title} (${p.tankIds.join(', ')})`
  if (p.pick) return `${p.title} · aus ${p.pick.from.length} gleichen`
  if (p.amount != null) return `${p.title}`
  return p.title
}

/** Der Wortlaut wird gekappt — db.json wird bei jedem Speichern ganz geschrieben. */
export const MAX_MESSAGE = 4000
export const MAX_PER_LEAD = 10

export function trimMessage(text: string): string {
  return text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE)}\n… (gekürzt, ${num(text.length)} Zeichen)`
}

// ------------------------------------------------------------------- Vorgang

/**
 * Was aus einer Nachricht in einem Zug folgen darf — und was nicht.
 *
 * Die Schritte sind unterschiedlich teuer. Interessent anlegen, Positionen
 * anhängen, Angebot entwerfen und ein Gebot vermerken sind billig, unsichtbar
 * für Käufer und rücknehmbar; für die einzeln zu klicken gibt es keinen Grund.
 * Reservieren und Verkauf buchen sind binnen einer Minute öffentlich und bleiben
 * deshalb außen vor — sie bekommen einen eigenen, bewussten Griff.
 */
const CHEAP: ProposalKind[] = ['lead.neu', 'lead.notiz', 'lead.phase', 'positionen', 'angebot', 'gebot']
/**
 * „Verkauf vorbereiten" schrieb nie etwas — der Kommentar versprach einen Dialog,
 * den es nirgends gab. Den gibt es jetzt am Angebot; der Vorschlag wird deshalb
 * zum Hinweis statt zu einem Knopf, der nur eine Warnung ausgeben kann.
 */
const TOTER_KNOPF: ProposalKind[] = ['verkauf.vorbereiten']
const ORDER: ProposalKind[] = ['lead.neu', 'lead.notiz', 'positionen', 'angebot', 'gebot', 'lead.phase']

export interface Plan {
  /** In der Reihenfolge, in der sie laufen müssen. */
  steps: Proposal[]
  /** Öffentlich wirksam — nie im Zug, immer einzeln. */
  risky: Proposal[]
  /** Was in der Nachricht steht, aber (noch) nirgends hin kann. */
  notes: string[]
  /** Eine Zeile für den Knopf. */
  summary: string
}

/**
 * Aus geprüften Vorschlägen und der schlüssellosen Extraktion einen Zug bauen.
 *
 * Die Extraktion füllt nur Lücken: was die KI schon belegt hat, wird nicht
 * verdoppelt. Ohne API-Schlüssel trägt sie den Zug allein — dann steht der
 * Vorgang eben auf dem, was wörtlich in der Nachricht steht.
 */
export function buildPlan(proposals: Proposal[], parsed: ParsedMessage, db: DB, text: string): Plan {
  const steps = proposals.filter((p) => CHEAP.includes(p.kind))
  const risky = proposals.filter((p) => !CHEAP.includes(p.kind) && !TOTER_KNOPF.includes(p.kind))
  const dead = proposals.filter((p) => TOTER_KNOPF.includes(p.kind))
  const has = (k: ProposalKind) => steps.some((p) => p.kind === k)

  const known = findLead(db, parsed.email, parsed.phone)
  // Interessent: nur ergänzen, wenn die KI keinen genannt hat und wirklich ein
  // Kontaktweg dasteht. Ein Name allein legt niemanden an — "Sehr geehrte Damen"
  // wäre sonst eine Person.
  if (!has('lead.neu') && !has('lead.notiz') && (parsed.email || parsed.phone)) {
    steps.push(known
      ? mk('lead.notiz', `Nachricht bei ${known.name} vermerken`, 'Der Wortlaut wird angehängt, letzter Kontakt auf heute.', { leadId: known.id })
      : mk('lead.neu', `Interessent anlegen: ${parsed.name || parsed.email || parsed.phone}`,
          'Legt nur die Person an. Positionen kommen im nächsten Schritt.',
          { name: parsed.name, email: parsed.email, phone: parsed.phone }))
  }

  const notes: string[] = []
  if (dead.length > 0) {
    notes.push('Die Nachricht liest sich wie ein fester Kauf. Buchen kannst du unten, sobald ein Angebot steht — der Preis kommt dann von dort.')
  }

  /**
   * Wirklich zu haben.
   *
   * `isOpen` allein genügt nicht: es lässt reservierte Ware durch und fragt
   * nicht, ob die Position schon bei jemand anderem hängt. `attachTanks` ändert
   * an beidem nichts, meldet aber Vollzug — zwei Käufer bekamen so nacheinander
   * dieselben zwei Tanks angehängt, mit zwei offenen Angeboten darüber.
   */
  /** Hängt schon bei genau diesem Käufer — dann ist nichts zu tun. */
  const mine = (t: Tank) => !!known && t.leadId === known.id
  /** Wirklich zu haben: frei im Bestand und niemandem zugeordnet. */
  const freeFor = (t: Tank) => t.status === 'verfuegbar' && !t.leadId

  const warum = (t: Tank) =>
    t.status === 'verkauft' ? 'verkauft' : t.status === 'reserviert' ? 'reserviert' : 'schon bei jemand anderem'

  // Positionen. Wörtlich genannte Nummern kommen vollständig in den Zug.
  if (!has('positionen') && parsed.exact && parsed.matchedTankIds.length > 0) {
    const all = parsed.matchedTankIds.map((id) => db.tanks.find((t) => t.id === id)).filter((t): t is Tank => !!t)
    const free = all.filter(freeFor)
    // Was ihm schon gehört, wird stillschweigend übergangen: dieselbe Nachricht
    // ein zweites Mal einzulesen darf nichts verdoppeln und nichts melden.
    const taken = all.filter((t) => !freeFor(t) && !mine(t))
    if (free.length > 0) {
      steps.push(mk('positionen', `${free.length === 1 ? itemLabel(free[0]) : `${free.length} Positionen`} anhängen`,
        'Sie stehen danach auf „im Kontakt“ und sind für andere Käufer weg.', { tankIds: free.map((t) => t.id) }))
    }
    if (taken.length > 0) {
      notes.push(`${collapseIds(taken.map((t) => t.id))} ${taken.length === 1 ? 'ist' : 'sind'} nicht mehr frei — ${[...new Set(taken.map(warum))].join(', ')}.`)
    }
  } else if (!has('positionen') && !parsed.exact && parsed.broadMatch) {
    notes.push(`Die Nachricht passt auf ${parsed.matchedTankIds.length} Positionen — zu viele, um daraus etwas abzuleiten. Bitte im Bestand auswählen.`)
  } else if (!has('positionen') && !parsed.exact && parsed.matchedTankIds.length > 0) {
    // Ohne Nummer nur dann, wenn die Treffer untereinander austauschbar sind:
    // drei Koffertanks mit 1.650 l zu 1.050 € sind für den Käufer dasselbe Ding,
    // und ihn nach einer Seriennummer zu fragen, die er nicht kennt, hilft
    // niemandem. Angehängt wird EINER — er hat nach einem gefragt.
    const cand = parsed.matchedTankIds
      .map((id) => db.tanks.find((t) => t.id === id))
      .filter((t): t is Tank => !!t && freeFor(t))
    const same = cand.length > 0 && cand.every((t) => t.maker === cand[0].maker && t.type === cand[0].type && t.litres === cand[0].litres && t.vb === cand[0].vb)
    if (same) {
      // „die beiden Rundtanks“ meint zwei. Ohne diesen Hinweis stünde einer da
      // und der Verkäufer müsste den zweiten von Hand nachtragen — für eine
      // Angabe, die wörtlich in der Nachricht steht.
      const want = Math.min(countCue(text) ?? 1, cand.length)
      const take = [...cand].sort((a, b) => a.id.localeCompare(b.id)).slice(0, want)
      steps.push(mk('positionen', take.length === 1 ? `${itemLabel(take[0])} anhängen` : `${take.length} × ${itemLabel(take[0])} anhängen`,
        cand.length > take.length
          ? `${cand.length} davon sind frei und untereinander gleich — angehängt ${take.length === 1 ? 'wird' : 'werden'} ${collapseIds(take.map((t) => t.id))}.`
          : `${take.length === 1 ? 'Sie steht' : 'Sie stehen'} danach auf „im Kontakt“ und ${take.length === 1 ? 'ist' : 'sind'} für andere Käufer weg.`,
        { tankIds: take.map((t) => t.id) }))
    } else if (cand.length > 0) {
      notes.push(`Die Nachricht passt auf ${cand.length} verschiedene Positionen (${collapseIds(cand.map((t) => t.id))}) — welche gemeint ist, steht nicht drin.`)
    }
  }

  // Angebot: sobald Positionen im Spiel sind. Genau das, was der Verkäufer sonst
  // von Hand in der Bestandsliste zusammenklickt.
  // Erledigte Angebote zählen nicht mehr: ein angenommenes gehört zu einem
  // gebuchten Verkauf, und daran hängt kein neues Gebot mehr.
  const openQuote = known
    ? db.quotes.find((q) => q.leadId === known.id && q.status !== 'abgelehnt' && q.status !== 'angenommen') ?? null
    : null
  const posStep = steps.find((p) => p.kind === 'positionen')
  const withPositions = !!posStep || (known?.tankIds.length ?? 0) > 0
  // Nicht zum zweiten Mal. Steht schon ein Angebot offen, entstünde ein Duplikat
  // — und das Gebot der Verhandlung landete am neuen statt am verhandelten.
  if (!has('angebot') && withPositions && !openQuote) {
    steps.push(mk('angebot', 'Angebot als Entwurf anlegen', 'Der geforderte Preis wird nach der Katalogregel gerechnet — mit Paketen und Staffel.', {}))
  }

  // Gebot: nur ein Betrag, der wirklich vom Käufer kommt. Unser eigener
  // Paketpreis reist in derselben Nachricht mit und wäre das teuerste Missverständnis.
  //
  // Und nur, wenn es am Ende auch irgendwo hängen kann. Ein Gebot ohne Angebot
  // schreibt nichts — es als Schritt zu versprechen wäre genau die Lüge, die
  // dieser Umbau abstellt.
  const willHaveQuote = steps.some((p) => p.kind === 'angebot') || !!openQuote
  if (!has('gebot') && parsed.offer != null && parsed.offer !== parsed.packagePrice) {
    if (willHaveQuote) {
      // `leadId` muss dranstehen, sonst findet floorFor nichts und die Warnung
      // unter der Untergrenze erschiene im Ein-Knopf-Weg nie.
      const forFloor = openQuote?.tankIds ?? posStep?.tankIds ?? []
      const floor = db.tanks.filter((t) => forFloor.includes(t.id)).reduce((a, t) => a + t.floor, 0)
      steps.push(mk('gebot', `Gebot ${eur(parsed.offer)} eintragen`, 'Wird beim Angebot vermerkt. Ändert nichts am Bestand.', {
        amount: parsed.offer,
        leadId: known?.id ?? null,
        warning: floor > 0 && parsed.offer < floor ? `${eur(parsed.offer)} liegt unter der Untergrenze von ${eur(floor)}.` : null,
      }))
    } else {
      notes.push(`${eur(parsed.offer)} steht als Gebot in der Nachricht — es braucht erst ein Angebot, an dem es hängen kann.`)
    }
  }

  steps.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))

  // Ohne Interessenten hängt nichts irgendwo. Positionen, Angebot und Gebot
  // schrieben dann nichts — als Schritt versprochen wären sie wieder die
  // Vollzugsmeldung ohne Vollzug. Eine Portalmail ohne Kontaktweg ist genau
  // dieser Fall: der Name steht da, aber die Adresse gehört dem Roboter.
  const willHaveLead = steps.some((p) => p.kind === 'lead.neu' || p.kind === 'lead.notiz') || !!known
  if (!willHaveLead) {
    const need = steps.filter((p) => p.kind !== 'lead.phase')
    if (need.length > 0) {
      notes.push(`${need.map((p) => p.title).join(', ')} — dafür fehlt der Interessent. In der Nachricht steht weder E-Mail noch Telefonnummer${parsed.name ? `, nur der Name „${parsed.name}“` : ''}.`)
    }
    return { steps: [], risky, notes, summary: '' }
  }

  return { steps, risky, notes, summary: steps.map((p) => p.title).join(' · ') }
}

/**
 * Wie viele Stück die Nachricht meint, wenn keine Nummer dasteht.
 *
 * Nur ausgeschriebene Mengenwörter — eine Ziffer im Text ist zu oft eine
 * Literzahl oder ein Preis. „die beiden“ und „alle“ sind dagegen eindeutig.
 */
export function countCue(text: string): number | null {
  const t = ` ${text.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-zäöü0-9]+/g, ' ')} `
  // Zeitangaben sind keine Mengen. „Ich melde mich in zwei Wochen“ hängte zwei
  // Tanks an, „Ist der Tank komplett dicht?“ alle drei — deshalb steht
  // „komplett“ gar nicht mehr in der Liste und eine Zeiteinheit hebt auf.
  const TIME = /(wochen?|tagen?|monaten?|jahren?|stunden?|minuten?|uhr|mal)/
  const words: [string, number][] = [
    ['alle', Infinity], ['sämtliche', Infinity], ['saemtliche', Infinity],
    ['beide', 2], ['beiden', 2], ['zwei', 2], ['drei', 3], ['vier', 4], ['fünf', 5], ['fuenf', 5],
    ['sechs', 6], ['sieben', 7], ['acht', 8], ['neun', 9], ['zehn', 10],
  ]
  // Das zuerst GENANNTE Wort gewinnt, nicht das zuerst aufgelistete: in
  // „drei Fässer und zwei Tanks“ ist die Drei gemeint.
  let best: { at: number; n: number } | null = null
  for (const [w, n] of words) {
    const at = t.indexOf(` ${w} `)
    if (at === -1) continue
    // Was direkt dahinter steht, entscheidet: „zwei Wochen“ ist keine Stückzahl.
    if (TIME.test(t.slice(at + w.length + 2, at + w.length + 14))) continue
    if (!best || at < best.at) best = { at, n }
  }
  return best?.n ?? null
}

function mk(kind: ProposalKind, title: string, effect: string, rest: Partial<Proposal>): Proposal {
  return {
    id: newId(), kind, title, effect, quote: '', proven: true, publishes: false,
    leadId: null, name: '', email: '', phone: '', stage: null, amount: null,
    tankIds: [], pick: null, warning: null, ...rest,
  }
}
