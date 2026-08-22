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
        tank.maker !== 'Sonstige' && hay.includes(tank.maker.toLowerCase()),
      ]
      if (!hits.some(Boolean)) {
        verworfen.push(`Position ${id} (${tank.type}) wird in der Nachricht nicht erwähnt`)
        return false
      }
      return true
    })

  let offer = raw.offer
  if (offer != null) {
    // The number has to appear in the mail, in one of the ways Germans write it.
    const forms = [String(offer), offer.toLocaleString('de-DE'), String(offer).replace(/(\d)(?=(\d{3})+$)/g, '$1.')]
    if (!forms.some((f) => text.includes(f))) {
      verworfen.push(`Betrag ${offer} steht nicht in der Nachricht`)
      offer = null
    }
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

export class AiError extends Error {
  constructor(message: string, readonly kind: 'key' | 'credit' | 'rate' | 'net' | 'shape') {
    super(message)
  }
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
        max_tokens: 1024,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: prompt }],
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
  const call = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name)
  if (!call?.input) throw new AiError('Die KI hat nicht im erwarteten Format geantwortet.', 'shape')

  const input = call.input as Partial<AiResult>
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
