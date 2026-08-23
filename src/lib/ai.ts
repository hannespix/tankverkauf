import type { DB, Quote, Tank } from '../types'
import { isOpen, linePrice } from './stats'
import { dims as fmtDims } from './format'

/**
 * Optional second reader for an incoming enquiry.
 *
 * The rule-based parseMessage() stays the default and keeps working without any
 * of this. The model is only better at the two things a rule cannot do: it does
 * not care what the portal's mail looks like, and it can tell "I want to buy the
 * 1650" apart from "does the 1650 have a cooling jacket".
 *
 * Everything it returns is checked against the actual text and the actual stock
 * before it is shown — a model that invents a position number or a price that was
 * never written must not be able to smuggle it into the database.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'

export const AI_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — günstig, für die meisten Mails genug' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — teurer, liest verworrene Mails besser' },
] as const

export type AiIntent = 'kaufinteresse' | 'frage' | 'absage' | 'sonstiges'

export interface AiResult {
  name: string
  email: string
  phone: string
  offer: number | null
  positionIds: string[]
  intent: AiIntent
  /** One sentence for the note, in the buyer's own terms. */
  summary: string
  /** What was thrown away because it did not appear in the text or the stock. */
  verworfen: string[]
}

const TOOL = {
  name: 'anfrage',
  description: 'Trägt die Angaben aus einer eingegangenen Nachricht ein.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Name des Absenders. Leer, wenn nicht genannt.' },
      email: { type: 'string', description: 'E-Mail des KÄUFERS. Niemals eine noreply-Adresse des Portals.' },
      phone: { type: 'string', description: 'Telefonnummer des Käufers. Leer, wenn keine dasteht.' },
      offer: { type: ['number', 'null'], description: 'Gebotener Preis in Euro, falls einer genannt wird.' },
      positionIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Positionsnummern wie T-20 oder F-01, NUR wenn sie im Text stehen oder eindeutig aus Angaben wie "der 3.100 l" folgen. Im Zweifel leer lassen.',
      },
      intent: { type: 'string', enum: ['kaufinteresse', 'frage', 'absage', 'sonstiges'] },
      summary: { type: 'string', description: 'Ein Satz auf Deutsch, worum es geht.' },
    },
    required: ['name', 'email', 'phone', 'offer', 'positionIds', 'intent', 'summary'],
  },
}

function stockList(db: DB): string {
  return db.tanks
    .filter(isOpen)
    .map((t) => `${t.id}: ${t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}${t.litres > 0 ? `, ${t.litres} l` : ''}, ${t.vb} EUR`)
    .join('\n')
}

/** Digits only, so "0176 123-456" and "0176123456" compare equal. */
const digits = (s: string) => s.replace(/\D/g, '')

/**
 * Steht die Zahl als GELDBETRAG im Text?
 *
 * text.includes('175') allein reicht nicht: "melden Sie sich unter 0175 …"
 * enthält die 175, und 175 € ist zufällig genau der Preis eines Fasses. Ein
 * Gebot braucht deshalb eine Währungsangabe auf derselben Zeile — und darf nicht
 * mitten in einer langen Ziffernfolge stehen, wie sie jede Telefonnummer ist.
 */
export function amountInText(amount: number, text: string): boolean {
  const forms = [String(amount), amount.toLocaleString('de-DE'), String(amount).replace(/(\d)(?=(\d{3})+$)/g, '$1.')]
  return text.split(/\r?\n/).some((line) => {
    if (!/(?:€|EUR\b|Euro\b)/i.test(line)) return false
    return forms.some((f) => {
      let at = line.indexOf(f)
      while (at >= 0) {
        // Keine Ziffer und kein Trennzeichen direkt daneben — sonst ist es ein
        // Ausschnitt aus einer größeren Zahl.
        const before = line[at - 1] ?? ' '
        const after = line[at + f.length] ?? ' '
        /*
         * Das Währungszeichen muss AN DIESER Zahl stehen, nicht irgendwo auf der
         * Zeile.
         *
         * „3 × 1.650 l – je 1.050 € VB" enthält ein €, und damit galt auch die
         * 1.650 als Geldbetrag — zufällig der Preis zweier Rundtanks, die in der
         * Nachricht nirgends vorkommen. Der Preis-Schlüssel wäre damit in jeder
         * Tank-Nachricht wirkungslos gewesen: „irgendeine Zahl auf einer Zeile
         * mit €".
         */
        const rechts = line.slice(at + f.length, at + f.length + 8)
        const links = line.slice(Math.max(0, at - 8), at)
        const amGeld = /^\s*(?:€|EUR\b|Euro\b)/i.test(rechts) || /(?:€|EUR|Euro)\s*$/i.test(links)
        if (!/[\d.,]/.test(before) && !/\d/.test(after) && amGeld) return true
        at = line.indexOf(f, at + 1)
      }
      return false
    })
  })
}

/** Grußformeln und Absenderzeilen, hinter denen ein Name steht. */
const SIGN_OFF = /^\s*(viele\s+gr(ü|ue)(ß|ss)e|mit\s+freundlichen|beste\s+gr(ü|ue)(ß|ss)e|lg\b|mfg\b|gru(ß|ss)\b|ihr\b|ihre\b|von:|absender:|gesendet\s+von)/i

/**
 * Nennt der Text wirklich den HERSTELLER — oder nur zufällig denselben Namen?
 *
 * "Viele Grüße, Thomas Schneider" enthält "Schneider" und schaltete damit die
 * Exzenterschneckenpumpe für 3.500 € frei. Clemens ist ein Vorname, Kiesel und
 * Jakobs sind Nachnamen. Auf einer Grußzeile zählt der Treffer deshalb nicht.
 */
export function mentionsMaker(maker: string, text: string): boolean {
  const needle = maker.toLowerCase()
  const lines = text.split(/\r?\n/)
  return lines.some((line, i) => {
    if (!line.toLowerCase().includes(needle)) return false
    if (SIGN_OFF.test(line)) return false
    // Auch die Zeile direkt unter einer Grußformel ist eine Namenszeile.
    const prev = lines[i - 1]
    if (prev !== undefined && SIGN_OFF.test(prev) && line.trim().split(/\s+/).length <= 4) return false
    return true
  })
}

/**
 * Keep only what the text and the stock actually support. This is the whole
 * safety net: a model that hallucinates a position or a price loses it here
 * instead of attaching it to a lead and locking the position for other buyers.
 */
export function verify(raw: AiResult, text: string, db: DB): AiResult {
  const verworfen: string[] = []
  const hay = text.toLowerCase()

  const positionIds = raw.positionIds
    .map((id) => id.toUpperCase())
    .filter((id) => {
      const tank = db.tanks.find((t) => t.id === id)
      if (!tank) {
        verworfen.push(`Position ${id} gibt es nicht`)
        return false
      }
      // Existing is not enough. The message has to point at it somehow — by its
      // number, by its volume, or by its name. Otherwise a model that throws in
      // a barrel nobody asked about would get it attached to the lead, and
      // attaching sets it to "kontakt" and locks it away from other buyers.
      const litres = tank.litres
      const hits = [
        hay.includes(id.toLowerCase()),
        litres > 0 && (hay.includes(String(litres)) || hay.includes(litres.toLocaleString('de-DE'))),
        hay.includes(tank.type.toLowerCase()),
        tank.maker !== 'Sonstige' && mentionsMaker(tank.maker, text),
      ]
      if (!hits.some(Boolean)) {
        verworfen.push(`Position ${id} (${tank.type}) wird in der Nachricht nicht erwähnt`)
        return false
      }
      return true
    })

  let offer = raw.offer
  if (offer != null && !amountInText(offer, text)) {
    verworfen.push(`Betrag ${offer} steht nicht als Geldbetrag in der Nachricht`)
    offer = null
  }

  let email = raw.email.trim()
  if (email && !hay.includes(email.toLowerCase())) {
    verworfen.push(`E-Mail ${email} steht nicht in der Nachricht`)
    email = ''
  }

  let phone = raw.phone.trim()
  if (phone && !digits(text).includes(digits(phone))) {
    verworfen.push(`Telefonnummer ${phone} steht nicht in der Nachricht`)
    phone = ''
  }

  let name = raw.name.trim()
  if (name && !hay.includes(name.toLowerCase().split(/\s+/)[0])) {
    verworfen.push(`Name ${name} steht nicht in der Nachricht`)
    name = ''
  }

  return { ...raw, name, email, phone, offer, positionIds, verworfen }
}

/* ------------------------------------------------------------------ Vorschläge
 *
 * Statt Felder zu füllen und einen Knopf drei Dinge auf einmal tun zu lassen,
 * liefert das Modell einzeln bestätigbare Vorschläge — jeder mit dem Zitat, auf
 * das er sich stützt.
 *
 * Das Vokabular ist absichtlich klein. Was nicht umkehrbar ist, steht nicht
 * drin: kein Löschen, kein Buchen eines Verkaufs, keine Einstellungen. Eine
 * Nachricht ist kein Zahlungseingang, und "ich nehme ihn" ist von "ich würde ihn
 * nehmen, wenn" für ein Modell kaum zu unterscheiden. Die Grenze steht deshalb
 * im Code und nicht als Warndreieck in der Oberfläche.
 */

export type ProposalKind =
  | 'lead.neu'
  | 'lead.notiz'
  | 'lead.phase'
  | 'positionen'
  | 'gebot'
  | 'angebot'
  | 'reservieren'
  | 'verkauf.vorbereiten'

export interface RawProposal {
  kind: ProposalKind
  /** Zitat aus der Nachricht, das den Vorschlag trägt. Pflicht. */
  quote: string
  leadId?: string
  name?: string
  email?: string
  phone?: string
  stage?: string
  amount?: number
  positionIds?: string[]
  /** Für baugleiche Ware: wie viele Stück, ohne eine Nummer zu erfinden. */
  count?: number
  /** Beschreibung der gemeinten Ware, wenn keine Nummer genannt wurde. */
  what?: string
  /**
   * Wie die Nummern zustande kamen — die KI sagt es selbst, statt dass der Code
   * es hinterher neu errät und dabei ihre Auflösung verwirft.
   */
  confidence?: 'genannt' | 'eindeutig' | 'erschlossen' | 'baugleich' | 'geraten'
  /** Ein Satz, welche Angabe entschieden hat. Wird zur Warnung, wo es unsicher ist. */
  reason?: string
  /** Beim Gebot: bietet der Käufer, oder zitiert er unsere eigenen Preise zurück? */
  amountKind?: 'gebot' | 'unser_preis' | 'unklar'
}

/** Was der Käufer von UNS will — geht heute komplett verloren. */
export interface RawAsk {
  topic: 'masse' | 'verfuegbarkeit' | 'zustand' | 'preis' | 'abholung' | 'zahlung' | 'sonstiges'
  quote: string
  positionIds?: string[]
}

/** Was in der Nachricht steht und abgelegt werden soll, ohne dass ein Schritt daraus wird. */
export interface RawNote {
  topic: 'abholung' | 'termin' | 'ort' | 'betrieb' | 'preis' | 'zahlung' | 'bedingung' | 'sonstiges'
  quote: string
}

export interface AiRead {
  /** Bei einem Bild: was die KI abgelesen hat. Sonst leer. */
  transcript: string
  intent: AiIntent
  summary: string
  proposals: RawProposal[]
  /** Worauf der Käufer eine Antwort erwartet. */
  asks: RawAsk[]
  /** Was sonst in der Nachricht steht und abgelegt gehört. */
  notes: RawNote[]
}

const PROPOSAL_TOOL = {
  name: 'vorschlaege',
  description: 'Schlägt vor, was aus einer eingegangenen Nachricht übernommen werden soll.',
  input_schema: {
    type: 'object' as const,
    properties: {
      transcript: {
        type: 'string',
        description:
          'NUR wenn ein Bild dabei ist: schreibe den lesbaren Text des Bildes wörtlich ab, Zeile für Zeile. Sonst leer lassen.',
      },
      intent: { type: 'string', enum: ['kaufinteresse', 'frage', 'absage', 'sonstiges'] },
      summary: { type: 'string', description: 'Ein Satz auf Deutsch, worum es geht.' },
      proposals: {
        type: 'array',
        description:
          'Was in den Bestand oder an den Interessenten übernommen werden soll. Bei Positionen: lieber vollständig'
          + ' mit ehrlichem Sicherheitskennzeichen als still unvollständig — eine fehlende Position sieht niemand,'
          + ' eine markierte schon. Bei reservieren und verkauf.vorbereiten umgekehrt: im Zweifel gar nicht.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['lead.neu', 'lead.notiz', 'lead.phase', 'positionen', 'gebot', 'angebot', 'reservieren', 'verkauf.vorbereiten'],
              description:
                'lead.neu = neuer Interessent. lead.notiz = Nachricht bei bestehendem vermerken. lead.phase = Phase ändern (nur kontakt, angebot, verloren). positionen = Ware an den Interessenten hängen. gebot = ein vom KÄUFER genannter Betrag. angebot = Angebot als Entwurf anlegen. reservieren = Ware zurücklegen, nur bei ausdrücklicher Zusage. verkauf.vorbereiten = Käufer sagt, es sei bezahlt oder abgeholt.',
            },
            quote: { type: 'string', description: 'Wörtliches Zitat aus der Nachricht, das diesen Vorschlag trägt. PFLICHT.' },
            leadId: { type: 'string', description: 'Nur wenn die Nachricht zu einem bestehenden Interessenten gehört.' },
            name: { type: 'string' },
            email: { type: 'string', description: 'Niemals eine noreply-Adresse des Portals.' },
            phone: { type: 'string' },
            stage: { type: 'string', enum: ['kontakt', 'angebot', 'verloren'] },
            amount: { type: 'number', description: 'Nur ein Betrag, den der KÄUFER nennt. Unsere eigenen Preise sind kein Gebot.' },
            positionIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Die gemeinten Positionsnummern, jede einzeln — niemals ein Bereich wie "T-17–T-19". Löse jede'
                + ' Wunschzeile über jeden Anhaltspunkt auf: genannte Nummer, genannter Preis, Typwort, Hersteller,'
                + ' Literzahl, Maß, Bauform, Stapelbarkeit und die Stimmigkeit der ganzen Anfrage. Wie sicher das ist,'
                + ' steht in confidence — Unsicherheit ist KEIN Grund, die Zeile wegzulassen.',
            },
            confidence: {
              type: 'string',
              enum: ['genannt', 'eindeutig', 'erschlossen', 'baugleich', 'geraten'],
              description:
                'Wie die Nummern zustande kamen. genannt = die Nummer steht in der Nachricht. eindeutig = eine'
                + ' einzelne Angabe trifft genau eine offene Position. erschlossen = erst mehrere Angaben zusammen'
                + ' (etwa Liter UND Preis) treffen genau eine. baugleich = mehrere gleiche, die Stückzahl stimmt,'
                + ' welche Nummer es wird, ist beliebig. geraten = es bleibt offen, welche gemeint ist.',
            },
            reason: {
              type: 'string',
              description:
                'Ein Satz auf Deutsch, warum genau diese Nummern. Nenne die Angabe, die entschieden hat, und bei'
                + ' "geraten" auch, was sonst in Frage käme. Belegte Ware (RESERVIERT, im Kontakt) hier vermerken.',
            },
            count: { type: 'number', description: 'Wie viele Stück diese Wunschzeile verlangt. Bei "3 × 1.650 l" also 3.' },
            what: { type: 'string', description: 'Womit die Ware benannt wurde, z. B. "Barriquefässer 225 l".' },
            amountKind: {
              type: 'string',
              enum: ['gebot', 'unser_preis', 'unklar'],
              description:
                'Bei kind "gebot" PFLICHT. gebot = der Käufer nennt, was er zahlen will, und es ist nicht unser Preis.'
                + ' unser_preis = die Beträge sind unsere eigenen Preise für genau diese Ware — er nimmt an, er bietet'
                + ' nicht. unklar = ein Betrag steht da, aber es ist nicht zu erkennen, wessen er ist.',
            },
          },
          required: ['kind', 'quote'],
        },
      },
      asks: {
        type: 'array',
        description:
          'Worauf der Käufer eine Antwort erwartet. Hier hängt nichts an ihm — es sagt dem Verkäufer nur, was in'
          + ' der Antwort stehen muss. Lieber eine zu viel als eine unbeantwortete.',
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: ['masse', 'verfuegbarkeit', 'zustand', 'preis', 'abholung', 'zahlung', 'sonstiges'],
              description:
                'masse = Maße, Höhe, Breite, Tiefe, Durchmesser, Stapelhöhe. verfuegbarkeit = ist es noch da.'
                + ' zustand = Material, Dichtigkeit, Baujahr, Ausstattung. abholung = Termin, Verladung, Transport.',
            },
            quote: { type: 'string', description: 'Wörtliches Zitat der Frage. PFLICHT.' },
            positionIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Worauf sich die Frage bezieht, soweit erkennbar. Nur zum Antworten — es sperrt nichts.',
            },
          },
          required: ['topic', 'quote'],
        },
      },
      notes: {
        type: 'array',
        description: 'Was in der Nachricht steht und abgelegt werden soll, ohne dass daraus ein Schritt wird.',
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: ['abholung', 'termin', 'ort', 'betrieb', 'preis', 'zahlung', 'bedingung', 'sonstiges'],
            },
            quote: { type: 'string', description: 'Der Satz, wie er dasteht. Rate kein Datum daraus. PFLICHT.' },
          },
          required: ['topic', 'quote'],
        },
      },
    },
    required: ['transcript', 'intent', 'summary', 'proposals', 'asks', 'notes'],
  },
}

export class AiError extends Error {
  constructor(message: string, readonly kind: 'key' | 'credit' | 'rate' | 'net' | 'shape') {
    super(message)
  }
}

/**
 * Ein Bild, das mitgeschickt wird — ein Bildschirmfoto aus WhatsApp oder der
 * Kleinanzeigen-App. Aus diesen Quellen bekommt man keinen Text heraus, ohne
 * mühsam zu markieren.
 */
export interface AiImage {
  /** Base64 ohne Präfix, so wie prepareImage() es liefert. */
  base64: string
  mediaType: string
}

interface Block {
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

/**
 * Der eine Weg zur Schnittstelle. Bilder stehen VOR dem Text — das Modell soll
 * erst sehen, worüber geredet wird, und dann die Anweisung lesen.
 */
async function call(
  apiKey: string,
  model: string,
  prompt: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
  images: AiImage[] = [],
  maxTokens = 1024,
): Promise<Record<string, unknown>> {
  const content: Block[] = [
    ...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.base64 } })),
    { type: 'text' as const, text: prompt },
  ]

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': VERSION,
        // Without this header the browser call is refused outright.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content }],
      }),
    })
  } catch {
    throw new AiError('Keine Verbindung zur KI. Die Erkennung ohne KI läuft weiter.', 'net')
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; type?: string } } | null
    const msg = body?.error?.message ?? `Fehler ${res.status}`
    if (res.status === 401 || res.status === 403) throw new AiError('Der API-Schlüssel wird nicht angenommen.', 'key')
    if (res.status === 429) throw new AiError('Zu viele Anfragen hintereinander. Kurz warten.', 'rate')
    if (/credit|balance/i.test(msg)) throw new AiError('Das Guthaben bei Anthropic ist aufgebraucht.', 'credit')
    throw new AiError(msg, 'shape')
  }

  const data = (await res.json()) as {
    content?: { type: string; name?: string; input?: unknown }[]
    stop_reason?: string
  }
  /*
   * Abgeschnitten heißt abgeschnitten, nicht „weniger gefunden".
   *
   * Bei `max_tokens` liefert die API ein unvollständiges Tool-Eingabeobjekt.
   * Das ist truthy, es wirft nichts, und der Verkäufer bekommt einfach weniger
   * Vorschläge — ohne einen Hinweis darauf, dass etwas fehlt. Genau die
   * unsichtbare Lücke, gegen die dieser Umbau antritt.
   */
  if (data.stop_reason === 'max_tokens') {
    throw new AiError('Die Antwort der KI wurde abgeschnitten. Bitte die Nachricht kürzen oder in zwei Teile lesen.', 'shape')
  }
  const hit = data.content?.find((c) => c.type === 'tool_use' && c.name === tool.name)
  if (!hit?.input) throw new AiError('Die KI hat nicht im erwarteten Format geantwortet.', 'shape')
  return hit.input as Record<string, unknown>
}

export async function readMessage(text: string, db: DB, apiKey: string, model: string): Promise<AiResult> {
  const prompt = [
    'Du liest eine eingegangene Nachricht zu einer Betriebsauflösung und trägst die Angaben ein.',
    '',
    'REGELN:',
    '- Ein Betrag, den der Käufer nennt, ist nur dann sein Gebot, wenn es nicht unser eigener Preis ist.',
    '  Zitiert er unsere Preisliste zurück (mehrere Beträge, je einer pro Wunschzeile, oft mit „VB"), NIMMT er an —',
    '  dann `offer` leer lassen.',
    '- Trage NUR ein, was wörtlich in der Nachricht steht. Erfinde nichts.',
    '- Der Kopfblock einer weitergeleiteten Mail (Von/An/Gesendet/Betreff) gehört dem Portal, nicht dem Käufer.',
    '- noreply-Adressen sind nie die Adresse des Käufers.',
    '- Eine Positionsnummer nur dann, wenn sie dasteht oder die genannte Größe genau eine Position trifft.',
    '- Fragt jemand nur nach einer Eigenschaft, ist das intent "frage", nicht "kaufinteresse".',
    '',
    'BESTAND:',
    stockList(db),
    '',
    'NACHRICHT:',
    text,
  ].join('\n')

  const input = (await call(apiKey, model, prompt, TOOL)) as Partial<AiResult>
  const raw: AiResult = {
    name: String(input.name ?? ''),
    email: String(input.email ?? ''),
    phone: String(input.phone ?? ''),
    offer: typeof input.offer === 'number' ? input.offer : null,
    positionIds: Array.isArray(input.positionIds) ? input.positionIds.map(String) : [],
    intent: (['kaufinteresse', 'frage', 'absage', 'sonstiges'] as const).includes(input.intent as AiIntent)
      ? (input.intent as AiIntent)
      : 'sonstiges',
    summary: String(input.summary ?? ''),
    verworfen: [],
  }
  return verify(raw, text, db)
}

/** Der Bestand, wie ihn das Modell sieht — mit Belegung, damit es eine schon
 *  zugesagte Position nicht ein zweites Mal verspricht. */
/** T-17, T-18, T-19 → „T-17–T-19"; bei Lücken die Nummern einzeln. */
function idRange(ids: string[]): string {
  if (ids.length === 1) return ids[0]
  const nums = ids.map((id) => Number(id.split('-')[1]))
  const lueckenlos = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)
  return lueckenlos ? `${ids[0]}–${ids[ids.length - 1]}` : ids.join(', ')
}

/**
 * Der Bestand, wie die KI ihn sieht.
 *
 * Bisher standen dort nur Nummer, Typ, Liter und Preis. Damit konnte sie eine
 * Frage nach Maßen nicht beantworten, „Gesamthöhe des höchsten Stapels" nicht
 * einordnen und eckige nicht von runden Tanks unterscheiden — obwohl all das
 * gepflegt ist. Und 29 gleiche Fässer standen als 29 gleich aussehende Zeilen
 * da, statt als die eine Tatsache „29 baugleich".
 *
 * Baugleiches wird deshalb zusammengefasst, Maße und Merkmale kommen dazu. Die
 * Zeile wird länger, die Liste kürzer: aus 58 Zeilen werden rund 20.
 *
 * Der Gruppenschlüssel enthält den Belegungszustand — sonst verschwindet ein
 * reserviertes Stück in der Gruppe und die KI bietet es weiter an.
 */
function stockForProposals(db: DB): string {
  const byLead = new Map(db.leads.map((l) => [l.id, l.name]))
  const groups = new Map<string, { ids: string[]; line: (ids: string) => string }>()
  for (const t of db.tanks.filter(isOpen)) {
    const name = t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`
    const held = t.leadId ? ` — schon bei ${byLead.get(t.leadId) ?? 'jemandem'}` : ''
    const state = t.status === 'reserviert' ? ' — RESERVIERT' : t.status === 'kontakt' ? ' — im Kontakt' : ''
    const size = fmtDims(t.dims)
    const tags = t.tags.length ? ` · ${t.tags.join(', ')}` : ''
    const key = [t.maker, t.type, t.litres, t.vb, size ?? '', t.tags.join('|'), state, held].join('\u0000')
    const g = groups.get(key)
    if (g) { g.ids.push(t.id); continue }
    groups.set(key, {
      ids: [t.id],
      line: (ids: string) => {
        const n = groups.get(key)!.ids.length
        return `${ids}: ${name}${t.litres > 0 ? `, ${t.litres} l` : ''}, ${t.vb} EUR${n > 1 ? '/Stück' : ''}`
          + `${size ? `, ${size}` : ''}${tags}${n > 1 ? ` · ${n} baugleich` : ''}${state}${held}`
      },
    })
  }
  return [...groups.values()].map((g) => g.line(idRange(g.ids))).join('\n')
}

/** Die offenen Interessenten, damit eine zweite Nachricht keinen zweiten Datensatz erzeugt. */
function leadList(db: DB): string {
  const open = db.leads.filter((l) => l.stage !== 'verloren' && l.stage !== 'gewonnen')
  if (open.length === 0) return '(keine)'
  return open
    .slice(0, 40)
    .map((l) => `${l.id}: ${l.name}${l.email ? `, ${l.email}` : ''}${l.phone ? `, ${l.phone}` : ''} — Phase ${l.stage}`)
    .join('\n')
}

export async function readProposals(
  text: string,
  images: AiImage[],
  db: DB,
  apiKey: string,
  model: string,
  extra = '',
): Promise<AiRead> {
  const prompt = [
    'Du liest eine eingegangene Nachricht zu einer Betriebsauflösung und schlägst vor, was daraus übernommen werden soll.',
    '',
    'WIE SICHER MUSST DU SEIN? Zwei Maßstäbe, verwechsle sie nicht.',
    '- "reservieren" und "verkauf.vorbereiten" wirken öffentlich oder bewegen Geld: im Zweifel gar nichts vorschlagen.',
    '- Positionen, Fragen und Notizen sieht nur der Verkäufer, und er hakt sie mit einem Blick ab. Dort gilt das',
    '  Gegenteil: lieber vollständig mit ehrlichem Sicherheitskennzeichen als still unvollständig. Etwas wegzulassen,',
    '  weil du unsicher bist, ist hier der schlimmere Fehler — dann steht es nirgends und niemand merkt es.',
    '',
    'BELEG:',
    '- Jeder Vorschlag braucht ein wörtliches Zitat aus der Nachricht. Kein Zitat, kein Vorschlag.',
    '  Zitiere die eine Zeile oder den einen Satz, der ihn trägt — nicht die ganze Mail.',
    '- Erfinde keine Zahl, keine Nummer, keinen Namen, keinen Termin.',
    '',
    'WELCHE ZEILEN GEHÖREN WEM:',
    '- Der Kopfblock einer weitergeleiteten Mail (Von/An/Gesendet/Betreff) gehört dem Portal — es sei denn, dort steht',
    '  eine gewöhnliche Adresse des Absenders. noreply-Adressen sind nie die Adresse des Käufers.',
    '- Zeilen, die mit "Positionen:", "Paketpreis:", "Angebot" oder "Summe" beginnen, sind unsere eigene Liste, die der',
    '  Käufer mitgeschickt hat. Sie liefern Positionsnummern, aber niemals einen Betrag des Käufers.',
    '',
    'WER SCHREIBT:',
    '- Der Interessent ist die PERSON, nicht der Betrieb. In einer Signatur ist der Name die Zeile aus Vor- und',
    '  Nachname. Titel und Abschlüsse ("Dipl. Ing.", "Dr.", "M. Sc."), Siegel und Mitgliedschaften',
    '  ("Partnerbetrieb …"), die Firmenzeile, Straße, Ort und Web-Adresse sind NIE der Name.',
    '- Ein Name auf einer Grußzeile ist ein Name, auch wenn er wie ein Hersteller aus dem Bestand klingt.',
    '',
    'POSITIONEN — zerlege den Wunsch in Zeilen, eine Zeile ist eine Menge einer Sache.',
    'Für JEDE Zeile einen eigenen Vorschlag "positionen" mit genau dieser Zeile als Zitat, und der Reihe nach:',
    '  1. Steht eine Positionsnummer da? Nimm sie. confidence "genannt".',
    '  2. Sonst nimm ALLE Angaben der Zeile zusammen — Literzahl, genannter Preis, Typwort, Hersteller, Maß,',
    '     Bauform, Stückzahl — und filtere den Bestand damit.',
    '  3. Bleibt genau eine Position übrig: nimm sie. confidence "eindeutig", wenn schon eine einzelne Angabe',
    '     gereicht hätte, sonst "erschlossen". Schreibe in reason, welche Angabe entschieden hat.',
    '  4. Bleiben mehrere baugleiche übrig: nimm so viele, wie die Zeile verlangt, ab der niedrigsten Nummer,',
    '     und nenne jede Nummer einzeln. confidence "baugleich", count setzen.',
    '  5. Bleiben mehrere verschiedene übrig: nimm die am besten passende, confidence "geraten", und schreibe in',
    '     reason, was sonst in Frage käme.',
    '  6. Bleibt nichts übrig: keine Nummer, sondern eine Notiz.',
    '- Der genannte PREIS ist ein Schlüssel: trifft ein Betrag des Käufers genau den Preis einer offenen Position,',
    '  ist diese gemeint — auch wenn mehrere dieselbe Literzahl haben.',
    '- Der Preis grenzt ein, er sucht nicht. Eine Position, die die Zeile sonst gar nicht anspricht, kommt nicht',
    '  dadurch hinzu, dass ihr Preis zufällig passt.',
    '- MASSE sind ein Schlüssel: wer nach Breite und Tiefe oder nach einer Stapelhöhe fragt, meint eckige oder',
    '  ausdrücklich als stapelbar gekennzeichnete Ware. Runde Tanks haben keine Breite, sondern einen Durchmesser.',
    '- Prüfe die Zuordnung am Ende als Ganzes: fallen mehrere Zeilen in eine zusammenhängende Reihe des Bestands',
    '  — gleicher Typ, aufsteigende Größen, unsere eigenen Preise —, ist diese Reihe gemeint und nicht ein',
    '  Sammelsurium aus verschiedenen Bauarten.',
    '- Jede Nummer einzeln in positionIds, niemals ein Bereich wie "T-17–T-19" als einen Eintrag.',
    '- Ein Typwort zählt nur als ganzes Wort: "Barriquefass" in "Barriquefass-Reiniger" meint den Reiniger.',
    '- Eine Warengruppe ohne Menge und ohne Größe ("die Fässer", "die Tanks") ist KEIN Wunsch nach allen davon.',
    '  Mit einem Mengenwort ("alle", "die beiden", "12") ist sie einer.',
    '- Eine Frage nach einer Eigenschaft ist kein Wunsch. Sie gehört unter "asks", mit den Nummern, um die es geht —',
    '  dort hängt sie niemandem etwas an.',
    '- Steht bei einer Position RESERVIERT, "im Kontakt" oder "schon bei", nenne sie trotzdem und schreibe es in reason.',
    '',
    'GELD:',
    '- Höchstens ein Vorschlag "gebot" je Nachricht, und amountKind IMMER setzen:',
    '  "gebot" = der Käufer nennt, was er zahlen will, und es ist nicht unser Preis.',
    '  "unser_preis" = die Beträge sind unsere eigenen Preise für genau diese Ware. Dann NIMMT er an, er bietet nicht.',
    '  "unklar" = ein Betrag steht da, aber es ist nicht zu erkennen, wessen er ist.',
    '- Eine Zahl ist Geld, wenn ein Währungszeichen oder das Wort Euro dabeisteht oder der Satz vom Zahlen handelt.',
    '  Eine Telefonnummer, eine Postleitzahl, eine Jahreszahl, eine Uhrzeit, eine Literzahl und eine Stückzahl sind',
    '  kein Betrag — auch nicht neben einem Zahlungswort ("ich zahle bar: 0176 …").',
    '- Kein "gebot" ohne Zahl. "zu Ihrem Preis" und "einverstanden" nennen keinen Betrag: das gehört unter "notes".',
    '',
    'WAS DER KÄUFER VON UNS WILL:',
    '- Alles, worauf er eine Antwort erwartet, kommt unter "asks" — mit Zitat und, wenn erkennbar, den Nummern.',
    '  Das ging bisher komplett verloren, und der Verkäufer antwortete an der Frage vorbei.',
    '',
    'WAS SONST HÄNGEN BLEIBT:',
    '- Abholung, Termin, Ort, Betrieb, Zahlungsart, Aussagen über unseren Preis und Vorbehalte ("falls …") kommen',
    '  unter "notes", jeweils mit Zitat. Nimm den Satz, wie er dasteht, statt daraus ein Datum zu raten.',
    '  Grußformeln und Höflichkeitssätze sind keine Notiz.',
    '',
    'SONST:',
    '- Passt die Nachricht zu einem bestehenden Interessenten (gleiche E-Mail oder Telefonnummer), gib dessen leadId an',
    '  und schlage lead.notiz statt lead.neu vor.',
    '- "verkauf.vorbereiten" nur, wenn der Käufer schreibt, dass bezahlt oder abgeholt wurde. Es bucht nichts.',
    '- "reservieren" nur bei einer ausdrücklichen, unbedingten Zusage zu einer eindeutig benannten Position.',
    '- Ist es nur eine Frage, schlage höchstens vor, den Interessenten anzulegen — plus die "asks".',
    ...(images.length ? ['- Ein Bild liegt bei: schreibe zuerst seinen Text unter transcript wörtlich ab.'] : []),
    ...(extra.trim() ? ['', 'ZUSÄTZLICH VOM VERKÄUFER:', extra.trim()] : []),
    '',
    'BESTAND:',
    stockForProposals(db),
    '',
    'BESTEHENDE INTERESSENTEN:',
    leadList(db),
    '',
    'NACHRICHT:',
    text || '(kein Text — nur das Bild)',
  ].join('\n')

  // 4096 statt 2048: eine Sammelanfrage über viele Gruppen sprengt 2048, und ein
  // Abriss kostet nichts weniger als die halbe Bestellung. Ausgabe-Token werden
  // nur nach tatsächlicher Erzeugung berechnet — die höhere Grenze ist gratis.
  const input = (await call(apiKey, model, prompt, PROPOSAL_TOOL, images, 4096)) as Partial<AiRead>
  return {
    transcript: String(input.transcript ?? ''),
    intent: (['kaufinteresse', 'frage', 'absage', 'sonstiges'] as const).includes(input.intent as AiIntent)
      ? (input.intent as AiIntent)
      : 'sonstiges',
    summary: String(input.summary ?? ''),
    proposals: Array.isArray(input.proposals) ? (input.proposals as RawProposal[]) : [],
    asks: Array.isArray(input.asks) ? (input.asks as RawAsk[]) : [],
    notes: Array.isArray(input.notes) ? (input.notes as RawNote[]) : [],
  }
}

/** Ein Antwortentwurf. Schreibt nichts in die Datenbank — er landet in der Zwischenablage. */
const REPLY_TOOL = {
  name: 'antwort',
  description: 'Formuliert eine Antwort an den Käufer.',
  input_schema: {
    type: 'object' as const,
    properties: { text: { type: 'string', description: 'Die Antwort auf Deutsch, höflich, kurz, ohne Floskeln.' } },
    required: ['text'],
  },
}

export async function draftReply(
  message: string,
  db: DB,
  tankIds: string[],
  apiKey: string,
  model: string,
  quote?: Quote | null,
): Promise<string> {
  const s = db.settings
  const picked = db.tanks.filter((t) => tankIds.includes(t.id))
  /*
   * Der Entwurf muss dieselben Preise nennen wie das Angebot.
   *
   * Bisher bekam er stur die Bestands-VB. Lag dem Käufer schriftlich ein
   * ausgehandelter Zeilenpreis vor, zitierte ihm die Antwort im selben
   * Schriftwechsel den alten Preis zurück — ein Widerspruch, den ausgerechnet
   * die Regel „Nenne nur Preise, die unten stehen" erzwang.
   *
   * Ohne Angebot bleibt es bei der VB: dann gibt es nichts Ausgehandeltes.
   */
  const preisVon = (t: Tank) => (quote ? linePrice(quote, t) : t.vb)

  /*
   * Der Entwurf bekommt die MASSE und die Ausstattung.
   *
   * Bisher standen dort nur Name, Liter und Preis. Auf „Ich bräuchte noch Tiefe
   * und Breite der Tanks sowie die Gesamthöhe des höchsten Stapels" konnte die
   * Antwort deshalb nur lauten, man sehe nach — obwohl jede Zahl gepflegt ist.
   * Genau diese Frage war die Bedingung, an der ein Geschäft über 5.400 € hing.
   */
  const zeile = (t: (typeof picked)[number]) => {
    const size = fmtDims(t.dims)
    const tags = t.tags.length ? ` · ${t.tags.join(', ')}` : ''
    return `- ${t.id}: ${t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}`
      + `${t.litres > 0 ? `, ${t.litres} l` : ''}: ${preisVon(t)} EUR${quote && preisVon(t) !== t.vb ? '' : ' VB'}`
      + `${size ? `, ${size}` : ''}${tags}`
  }
  // Was sich aus mehreren Positionen ausrechnen lässt und der Käufer sonst selbst
  // addieren müsste: die Wandlänge nebeneinander und die einheitliche Tiefe.
  const breiten = picked.map((t) => t.dims?.w).filter((n): n is number => typeof n === 'number')
  const tiefen = [...new Set(picked.map((t) => t.dims?.d).filter((n): n is number => typeof n === 'number'))]
  const hoehen = picked.map((t) => t.dims?.h).filter((n): n is number => typeof n === 'number')
  const zusammen = [
    breiten.length === picked.length && picked.length > 1
      ? `Alle ${picked.length} nebeneinander: ${breiten.reduce((a, b) => a + b, 0)} cm Wandlänge.`
      : '',
    tiefen.length === 1 && picked.length > 1 ? `Tiefe bei allen gleich: ${tiefen[0]} cm.` : '',
    hoehen.length ? `Höchster Einzeltank: ${Math.max(...hoehen)} cm.` : '',
  ].filter(Boolean)

  const prompt = [
    'Formuliere eine kurze, höfliche Antwort auf die folgende Anfrage. Auf Deutsch, per Sie.',
    '',
    'REGELN:',
    '- Nenne nur Preise und Angaben, die unten stehen. Erfinde keine Zahlen, keine Termine, keine Zusagen.',
    '- Keine Floskeln, keine Werbesprache.',
    '- Beantworte JEDE Frage der Anfrage, soweit die Angaben unten sie hergeben. Fragt er nach Maßen, nenne sie',
    '  — am besten als kurze Aufstellung je Position, nicht in einem Fließsatz.',
    '- Steht etwas nicht unten, behaupte es nicht, sondern schreibe, dass du es nachsiehst. Das gilt besonders für',
    '  Stapelhöhen: rechne keine zusammen, wenn bei den Positionen nicht ausdrücklich „stapelbar" steht.',
    '',
    `VERKÄUFER: ${s.seller.name}${s.seller.location ? `, ${s.seller.plz} ${s.seller.location}` : ''}`,
    s.seller.pickupInfo ? `ABHOLUNG: ${s.seller.pickupInfo}` : '',
    '',
    picked.length ? 'GEFRAGTE POSITIONEN:' : 'KEINE POSITION ZUGEORDNET — hier der freie Bestand:',
    /*
     * NIE `stockForProposals` hier hineinschieben.
     *
     * Die Liste ist für das Modell gebaut, das den Vorgang plant: sie nennt
     * „RESERVIERT", „im Kontakt" und „schon bei Dr. Katrin Berger". In einem
     * Antwortentwurf an einen fremden Käufer stünde damit der Name eines anderen
     * Interessenten und unser Verhandlungsstand — zwei Zeilen unter der Regel
     * „Nenne nur Preise und Angaben, die unten stehen".
     *
     * Der Entwurf sieht deshalb nur, was ohnehin im öffentlichen Katalog steht:
     * freie Positionen, ohne jede Zuordnung.
     */
    ...(picked.length
      ? picked.map(zeile)
      : db.tanks.filter((t) => t.status === 'verfuegbar').map(zeile)),
    ...(zusammen.length ? ['', 'AUSGERECHNET:', ...zusammen.map((z) => `- ${z}`)] : []),
    // Der Gesamtpreis ist die Zahl, um die verhandelt wird — ohne sie
    // beantwortet der Entwurf jede Frage nach dem Paketpreis mit Schweigen.
    ...(quote && picked.length > 1
      ? ['', `UNSER ANGEBOTSPREIS FÜR ALLE ${picked.length} ZUSAMMEN: ${quote.askPrice} EUR`]
      : []),
    '',
    'ANFRAGE:',
    message,
  ]
    .filter(Boolean)
    .join('\n')

  const input = (await call(apiKey, model, prompt, REPLY_TOOL, [], 1024)) as { text?: string }
  return String(input.text ?? '')
}
