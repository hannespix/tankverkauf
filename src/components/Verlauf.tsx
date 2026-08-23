/**
 * Der Schriftwechsel mit einem Interessenten — lesen und antworten.
 *
 * Dieselbe Komponente am Interessenten und am Angebot. Die Historie hängt am
 * MENSCHEN, nicht am Angebot: sonst stünde sie doppelt da, und wer zwei
 * Angebote hat, hätte zwei halbe Verläufe. Das Angebot zeigt den Verlauf seines
 * Interessenten und schreibt in denselben.
 *
 * Ein Entwurf landete bisher in der Zwischenablage und war damit weg. Wer eine
 * Woche später nachsah, fand die Frage des Käufers, aber nicht, was man ihm
 * geantwortet hatte.
 */
import { useState } from 'react'
import { Button, Pill, Textarea, cx } from './ui'
import { IconCheck, IconCopy, IconSpark } from './icons'
import { AiError, draftReply } from '../lib/ai'
import { saveReply } from '../lib/actions'
import { quoteMail, mailtoLink } from '../lib/mail'
import { dateTimeDE } from '../lib/format'
import { useStore } from '../lib/store'
import type { Lead, Quote } from '../types'

export function Verlauf({ lead, quote, readOnly }: { lead: Lead; quote?: Quote | null; readOnly: boolean }) {
  const { db } = useStore()
  const live = db.leads.find((l) => l.id === lead.id) ?? lead
  const messages = live.messages ?? []

  const [offen, setOffen] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [kopiert, setKopiert] = useState(false)

  const key = db.settings.ai.apiKey

  function beginnen(mit: { subject: string; text: string }) {
    setSubject(mit.subject)
    setText(mit.text)
    setOffen(true)
    setFehler(null)
  }

  /**
   * Der Antwortentwurf der KI.
   *
   * Er bekommt die letzte eingegangene Nachricht als Bezug — ohne die schriebe
   * er ins Leere. Die Positionen kommen aus dem Angebot, wenn eines da ist,
   * sonst aus dem, woran der Interessent Interesse angemeldet hat.
   */
  async function vorschlagen() {
    if (!key) return
    setBusy(true)
    setFehler(null)
    try {
      const letzte = messages.find((m) => m.dir !== 'aus')
      const ids = quote?.tankIds.length ? quote.tankIds : live.tankIds
      const entwurf = await draftReply(letzte?.text ?? live.note, db, ids, key, db.settings.ai.model, quote)
      setText(entwurf)
      setSubject((s) => s || (quote ? `Angebot ${quote.id}` : 'Ihre Anfrage'))
      setOffen(true)
    } catch (err) {
      setFehler(err instanceof AiError ? err.message : 'Der Entwurf konnte nicht erzeugt werden.')
    } finally {
      setBusy(false)
    }
  }

  function speichern() {
    saveReply(live.id, text, subject, quote?.id)
    setOffen(false)
    setText('')
    setSubject('')
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text)
      setKopiert(true)
      setTimeout(() => setKopiert(false), 1600)
    } catch {
      setFehler('Kopieren hat nicht geklappt — bitte von Hand markieren.')
    }
  }

  return (
    <div className="space-y-2">
      {messages.length === 0 && !offen && (
        <p className="text-[13px] text-muted">Noch kein Schriftwechsel.</p>
      )}

      {messages.length > 0 && (
        <ul className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-line bg-surface-2 p-2">
          {messages.map((m, i) => {
            const raus = m.dir === 'aus'
            return (
              <li
                key={i}
                className={cx(
                  'rounded-lg p-2.5 text-[13px]',
                  // Wer schrieb, muss man auf einen Blick sehen. Ausgehendes
                  // rückt ein und trägt einen Rand — wie in jedem Mailprogramm.
                  raus ? 'ml-5 border-l-2 border-primary bg-primary-soft/25' : 'bg-surface',
                )}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                  <Pill tone={raus ? 'green' : 'neutral'}>{raus ? 'geschrieben' : 'eingegangen'}</Pill>
                  <span className="tnum">{dateTimeDE(m.at)}</span>
                  {m.fromImage && <Pill tone="neutral">aus einem Bild</Pill>}
                  {m.quoteId && <Pill tone="sky">{m.quoteId}</Pill>}
                </div>
                {m.subject && <p className="mt-1 font-semibold">{m.subject}</p>}
                <p className="mt-1 whitespace-pre-wrap text-muted">{m.text}</p>
                {m.applied.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.applied.map((a) => <Pill key={a} tone="green">{a}</Pill>)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && !offen && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => beginnen({ subject: quote ? `Angebot ${quote.id}` : 'Ihre Anfrage', text: '' })}>
            Antwort schreiben
          </Button>
          {quote && (
            <Button size="sm" onClick={() => beginnen(quoteMail(db, quote))}>
              Angebots-E-Mail
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={!key || busy} onClick={vorschlagen}>
            <IconSpark />{busy ? 'einen Moment …' : 'Entwurf per KI'}
          </Button>
        </div>
      )}
      {!readOnly && !offen && !key && (
        <p className="text-xs text-faint">
          Der KI-Entwurf braucht einen Schlüssel.
          {quote && ' Die Angebots-E-Mail wird aus den Daten gerechnet und geht auch ohne.'}
        </p>
      )}

      {offen && (
        <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Betreff"
            aria-label="Betreff"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] font-semibold"
          />
          <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ihre Antwort …" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={!text.trim()} onClick={speichern}>
              <IconCheck />Im Verlauf speichern
            </Button>
            <Button size="sm" disabled={!text.trim()} onClick={kopieren}>
              <IconCopy />{kopiert ? 'kopiert' : 'Kopieren'}
            </Button>
            {live.email && (
              // Das Speichern übernimmt der Knopf daneben — ein Mailprogramm
              // meldet uns nicht zurück, ob wirklich gesendet wurde.
              <a
                href={mailtoLink(live.email, subject, text)}
                className="tx press inline-flex min-h-9 items-center rounded-full border border-line-strong px-3 text-[13px] font-semibold hover:border-primary hover:text-primary"
              >
                In Mailprogramm öffnen
              </a>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setOffen(false); setText(''); setSubject('') }}>
              Verwerfen
            </Button>
            {key && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={vorschlagen}>
                <IconSpark />{busy ? '…' : 'neu vorschlagen'}
              </Button>
            )}
          </div>
          <p className="text-xs text-faint">
            Gespeichert wird, was hier steht — auch wenn du es von Hand änderst. Versendet wird nichts von selbst.
          </p>
        </div>
      )}

      {fehler && <p className="text-[13px] text-amber">{fehler}</p>}
    </div>
  )
}
