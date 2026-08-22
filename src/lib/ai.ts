import type { DB } from '../types'
import { isOpen } from './stats'

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
      const at = line.indexOf(f)
      if (at < 0) return false
      // Keine Ziffer und kein Trennzeichen direkt daneben — sonst ist es ein
      // Ausschnitt aus einer größeren Zahl.
      const before = line[at - 1] ?? ' '
      const after = line[at + f.length] ?? ' '
      return !/[\d.,]/.test(before) && !/\d/.test(after)
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
}

export interface AiRead {
  /** Bei einem Bild: was die KI abgelesen hat. Sonst leer. */
  transcript: string
  intent: AiIntent
  summary: string
  proposals: RawProposal[]
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
        description: 'Was übernommen werden soll. Lieber weniger und sicher als viel und geraten.',
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
              description: 'Positionsnummern NUR wenn sie dastehen oder die Angabe genau eine Position trifft.',
            },
            count: { type: 'number', description: 'Bei baugleicher Ware die Stückzahl statt einer erfundenen Nummer.' },
            what: { type: 'string', description: 'Womit die Ware benannt wurde, z. B. "Barriquefässer 225 l".' },
          },
          required: ['kind', 'quote'],
        },
      },
    },
    required: ['transcript', 'intent', 'summary', 'proposals'],
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

  const data = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] }
  const hit = data.content?.find((c) => c.type === 'tool_use' && c.name === tool.name)
  if (!hit?.input) throw new AiError('Die KI hat nicht im erwarteten Format geantwortet.', 'shape')
  return hit.input as Record<string, unknown>
}

export async function readMessage(text: string, db: DB, apiKey: string, model: string): Promise<AiResult> {
  const prompt = [
    'Du liest eine eingegangene Nachricht zu einer Betriebsauflösung und trägst die Angaben ein.',
    '',
    'REGELN:',
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
function stockForProposals(db: DB): string {
  const byLead = new Map(db.leads.map((l) => [l.id, l.name]))
  return db.tanks
    .filter(isOpen)
    .map((t) => {
      const name = t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`
      const held = t.leadId ? ` — schon bei ${byLead.get(t.leadId) ?? 'jemandem'}` : ''
      const state = t.status === 'reserviert' ? ' — RESERVIERT' : t.status === 'kontakt' ? ' — im Kontakt' : ''
      return `${t.id}: ${name}${t.litres > 0 ? `, ${t.litres} l` : ''}, ${t.vb} EUR${state}${held}`
    })
    .join('\n')
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
    'REGELN:',
    '- Jeder Vorschlag braucht ein wörtliches Zitat aus der Nachricht. Kein Zitat, kein Vorschlag.',
    '- Erfinde nichts. Im Zweifel weniger vorschlagen.',
    '- Der Kopfblock einer weitergeleiteten Mail (Von/An/Gesendet/Betreff) gehört dem Portal, nicht dem Käufer.',
    '- noreply-Adressen sind nie die Adresse des Käufers.',
    '- Ein Name unter einer Grußformel ist ein Name, auch wenn er wie ein Hersteller klingt.',
    '- Nenne eine Positionsnummer NUR, wenn sie dasteht oder die genannte Angabe genau eine Position trifft.',
    '  Gibt es mehrere gleiche (29 Barriquefässer, drei 1.650-l-Tanks), nutze count und what statt einer Nummer.',
    '- Ein Betrag ist nur dann ein Gebot, wenn der KÄUFER ihn nennt. Zeilen, die mit "Positionen:", "Paketpreis:"',
    '  oder "Summe" beginnen, stammen aus unserer eigenen Liste und sind niemals sein Gebot.',
    '- Passt die Nachricht zu einem bestehenden Interessenten (gleiche E-Mail oder Telefonnummer), gib dessen leadId an',
    '  und schlage lead.notiz statt lead.neu vor.',
    '- "verkauf.vorbereiten" nur, wenn der Käufer schreibt, dass bezahlt oder abgeholt wurde. Es bucht nichts.',
    '- Ist es nur eine Frage, schlage höchstens vor, den Interessenten anzulegen.',
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

  const input = (await call(apiKey, model, prompt, PROPOSAL_TOOL, images, 2048)) as Partial<AiRead>
  return {
    transcript: String(input.transcript ?? ''),
    intent: (['kaufinteresse', 'frage', 'absage', 'sonstiges'] as const).includes(input.intent as AiIntent)
      ? (input.intent as AiIntent)
      : 'sonstiges',
    summary: String(input.summary ?? ''),
    proposals: Array.isArray(input.proposals) ? (input.proposals as RawProposal[]) : [],
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
): Promise<string> {
  const s = db.settings
  const picked = db.tanks.filter((t) => tankIds.includes(t.id))
  const prompt = [
    'Formuliere eine kurze, höfliche Antwort auf die folgende Anfrage. Auf Deutsch, per Sie.',
    '',
    'REGELN:',
    '- Nenne nur Preise und Angaben, die unten stehen. Erfinde keine Zahlen, keine Termine, keine Zusagen.',
    '- Keine Floskeln, keine Werbesprache. Zwei bis fünf Sätze.',
    '- Wenn der Käufer nach etwas fragt, das unten nicht steht, schreibe, dass du es nachsiehst.',
    '',
    `VERKÄUFER: ${s.seller.name}${s.seller.location ? `, ${s.seller.plz} ${s.seller.location}` : ''}`,
    s.seller.pickupInfo ? `ABHOLUNG: ${s.seller.pickupInfo}` : '',
    '',
    picked.length ? 'GEFRAGTE POSITIONEN:' : 'KEINE POSITION ZUGEORDNET.',
    ...picked.map((t) => `- ${t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}${t.litres > 0 ? `, ${t.litres} l` : ''}: ${t.vb} EUR VB`),
    '',
    'ANFRAGE:',
    message,
  ]
    .filter(Boolean)
    .join('\n')

  const input = (await call(apiKey, model, prompt, REPLY_TOOL, [], 1024)) as { text?: string }
  return String(input.text ?? '')
}
