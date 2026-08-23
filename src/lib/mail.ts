/**
 * Texte für den Schriftwechsel mit einem Käufer.
 *
 * Bewusst ohne KI. Ein Angebot ist ein Geschäftsdokument: was drinsteht, steht
 * schon im Bestand, und ein Sprachmodell kann daran nur etwas kaputt machen —
 * eine Zahl umformulieren, eine Position weglassen, eine Zusage erfinden. Die
 * Vorlage rechnet aus den Daten; wer den Ton ändern will, überarbeitet sie
 * danach per KI oder von Hand.
 *
 * Der zweite Grund: ohne API-Schlüssel muss es auch gehen.
 */
import type { DB, Quote, Tank } from '../types'
import { dateDE, eur, itemLabel, num } from './format'
import { dims as fmtDims } from './format'
import { linePrice, lineSum } from './stats'

function zeile(t: Tank, preis: number | null): string {
  const size = fmtDims(t.dims)
  const merkmale = t.tags.length ? ` — ${t.tags.join(', ')}` : ''
  // Der Preis steht am Zeilenende, hinter den Merkmalen: davor gelesen trennte
  // er die Beschreibung von dem, was sie beschreibt.
  return `· ${t.id}  ${itemLabel(t)}${size ? `, ${size}` : ''}${merkmale}${preis == null ? '' : ` · ${eur(preis)}`}`
}

export interface MailEntwurf {
  subject: string
  text: string
}

/**
 * Die Angebots-E-Mail zu einem Angebot.
 *
 * Nennt jede Position mit Nummer, Maßen und Merkmalen — genau die Angaben, nach
 * denen Käufer regelmäßig zurückfragen und die bisher niemand zur Hand hatte,
 * ohne im Bestand nachzusehen.
 *
 * Was NICHT hineingehört und deshalb nirgends vorkommt: Zielpreis, Untergrenze,
 * andere Interessenten, der Verhandlungsstand. Der Text geht an einen Käufer.
 */
export function quoteMail(db: DB, quote: Quote): MailEntwurf {
  const positionen = quote.tankIds
    .map((id) => db.tanks.find((t) => t.id === id))
    .filter((t): t is Tank => !!t)
  const lead = quote.leadId ? db.leads.find((l) => l.id === quote.leadId) ?? null : null
  const s = db.settings.seller
  const summe = lineSum(quote, positionen)
  const spart = summe - quote.askPrice
  /*
   * Einzelpreise nur drucken, wenn welche ausgehandelt wurden.
   *
   * Sonst veröffentlichte jede Angebotsmail einen Preis je Position, ohne dass
   * dafür ein Anlass bestünde — und lüde den Käufer ein, sich die drei
   * günstigsten herauszupicken. Hat der Verkäufer dagegen selbst eine Zeile
   * bewegt, ist die Aufschlüsselung genau das, was er zeigen will.
   *
   * Alles oder nichts: eine Liste, in der zwei Zeilen einen Preis tragen und
   * vier nicht, sieht nach einem Fehler aus.
   */
  const zeigePreise = positionen.length > 1 && Object.keys(quote.prices ?? {}).length > 0
  const liter = positionen.reduce((a, t) => a + t.litres, 0)

  /*
   * Der ganze Name, ohne Anredeform.
   *
   * „Guten Tag Herr Wallhäuser" setzt ein Geschlecht voraus, das aus einem Namen
   * nicht hervorgeht — und „Guten Tag Wallhäuser" allein ist im Deutschen zu
   * knapp. Der volle Name ist beides nicht: höflich und ohne Annahme.
   */
  const anrede = lead?.name?.trim() ? `Guten Tag ${lead.name.trim()},` : 'Guten Tag,'

  const kopf = positionen.length === 1
    ? itemLabel(positionen[0])
    : `${positionen.length} Positionen${liter > 0 ? `, zusammen ${num(liter)} l` : ''}`

  const text = [
    anrede,
    '',
    `gern fasse ich zusammen, worüber wir gesprochen haben — ${kopf}:`,
    '',
    ...positionen.map((t) => zeile(t, zeigePreise ? linePrice(quote, t) : null)),
    '',
    positionen.length > 1 && spart > 0
      ? `Einzeln zusammen ${eur(summe)}. Bei Abnahme aller ${positionen.length} Positionen ${eur(quote.askPrice)} — also ${eur(spart)} weniger.`
      : `Preis: ${eur(quote.askPrice)}${positionen.length === 1 ? ' VB' : ''}.`,
    quote.validUntil ? `Das Angebot gilt bis ${dateDE(quote.validUntil)}.` : '',
    '',
    s.pickupInfo || 'Besichtigung und Abholung nach Absprache.',
    '',
    'Bei Fragen melden Sie sich gern.',
    '',
    'Viele Grüße',
    s.name,
    [s.plz, s.location].filter(Boolean).join(' '),
  ]
    .join('\n')
    /*
     * Absätze bleiben, Lücken nicht.
     *
     * Ein `.filter(Boolean)` über die ganze Liste hätte auch die absichtlichen
     * Leerzeilen verschluckt — der erste Entwurf las sich als ein einziger
     * Block. Jetzt fallen nur die Zeilen weg, die bedingt sind (Gültigkeit),
     * und mehrfache Umbrüche werden auf einen Absatz zusammengezogen.
     */
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { subject: `Angebot: ${kopf}`, text }
}

/**
 * Ein `mailto:`-Link mit Betreff und Text.
 *
 * Öffnet das Mailprogramm des Verkäufers mit allem Ausgefüllten. Lange Texte
 * sprengen in manchen Programmen die Adresszeile — deshalb steht daneben immer
 * auch „Kopieren".
 */
export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
