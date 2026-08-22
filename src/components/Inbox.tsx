import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Pill, Textarea, cx } from './ui'
import { IconCamera, IconCheck, IconClose, IconCopy, IconInbox, IconSpark, IconWarn } from './icons'
import { AiError, draftReply, readProposals, type AiImage } from '../lib/ai'
import { checkProposals, type Proposal } from '../lib/inbox'
import { applyProposal } from '../lib/actions'
import { prepareImage } from '../lib/photos'
import { useStore } from '../lib/store'

/**
 * Nachrichten einlesen.
 *
 * Eine eingegangene Nachricht — getippt, eingefügt oder als Bildschirmfoto —
 * wird gelesen, und was daraus folgen soll, steht als einzeln bestätigbare
 * Vorschläge da. Jeder trägt das Zitat, auf das er sich stützt, und was er im
 * Bestand anrichtet.
 *
 * Es gibt bewusst kein "Alles übernehmen". Der Knopf unten rechts heißt "Fertig"
 * und schreibt nichts — der reflexhafte Griff dorthin ist damit folgenlos.
 */

const DRAFT_KEY = 'tankverkauf.inbox.draft'

export function Inbox({ open, onClose, initialText }: { open: boolean; onClose: () => void; initialText?: string }) {
  const { db, mode } = useStore()
  const [text, setText] = useState('')
  const [images, setImages] = useState<{ img: AiImage; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [read, setRead] = useState<{ summary: string; intent: string; transcript: string; dropped: string[] } | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [applied, setApplied] = useState<Record<string, string>>({})
  const [leadId, setLeadId] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const key = db.settings.ai.apiKey
  const readOnly = mode === 'demo'

  // Der Entwurf überlebt das versehentliche Schließen und die PIN-Abfrage — er
  // steckt sonst nur in useState und ist mit einem Klick auf den Rand weg.
  useEffect(() => {
    if (!open) return
    const saved = sessionStorage.getItem(DRAFT_KEY)
    if (initialText) setText(initialText)
    else if (saved) setText(saved)
  }, [open, initialText])

  useEffect(() => {
    if (open) sessionStorage.setItem(DRAFT_KEY, text)
  }, [open, text])

  function reset() {
    setText('')
    images.forEach((i) => URL.revokeObjectURL(i.url))
    setImages([])
    setRead(null)
    setProposals([])
    setApplied({})
    setLeadId(null)
    setReply(null)
    setAsk('')
    setError(null)
    sessionStorage.removeItem(DRAFT_KEY)
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return
    for (const f of Array.from(files).slice(0, 3)) {
      try {
        const prepared = await prepareImage(f)
        setImages((prev) => [
          ...prev,
          { img: { base64: prepared.base64, mediaType: 'image/jpeg' }, url: URL.createObjectURL(f) },
        ])
      } catch {
        setError('Das Bild konnte nicht gelesen werden.')
      }
    }
  }

  async function analyse(extra = '') {
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      const res = await readProposals(text, images.map((i) => i.img), db, key, db.settings.ai.model, extra)
      // Bei einem Bild ist das Transkript der Text, gegen den geprüft wird —
      // ohne ihn hätte die Prüfung nichts, woran sie sich halten könnte.
      const against = [text, res.transcript].filter(Boolean).join('\n')
      const checked = checkProposals(res.proposals, against, db)
      setRead({ summary: res.summary, intent: res.intent, transcript: res.transcript, dropped: checked.dropped })
      setProposals(checked.proposals)
    } catch (err) {
      setError(err instanceof AiError ? err.message : 'Die Nachricht konnte nicht gelesen werden.')
    } finally {
      setBusy(false)
    }
  }

  const message = [text, read?.transcript].filter(Boolean).join('\n')

  function take(p: Proposal) {
    const res = applyProposal(p, leadId, message)
    if (res.leadId) setLeadId(res.leadId)
    setApplied((prev) => ({ ...prev, [p.id]: res.done || p.title }))
  }

  async function makeReply() {
    if (!key) return
    setBusy(true)
    try {
      const ids = proposals.flatMap((p) => p.tankIds)
      setReply(await draftReply(message, db, ids, key, db.settings.ai.model))
    } catch (err) {
      setError(err instanceof AiError ? err.message : 'Der Antwortentwurf hat nicht geklappt.')
    } finally {
      setBusy(false)
    }
  }

  // Was zuerst passieren muss: ein Vorschlag, der einen Interessenten braucht,
  // bleibt gesperrt, solange keiner da ist.
  const needsLead = (p: Proposal) => ['lead.notiz', 'lead.phase', 'positionen', 'angebot'].includes(p.kind)
  const blocked = (p: Proposal) => needsLead(p) && !p.leadId && !leadId

  const sure = useMemo(() => proposals.filter((p) => p.proven && !p.publishes), [proposals])
  const unsure = useMemo(() => proposals.filter((p) => !p.proven || p.publishes), [proposals])

  return (
    <Modal open={open} onClose={onClose} title="Nachricht einlesen" wide>
      <div className="space-y-4">
        {!key && (
          <p className="rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-[13px]">
            <strong className="text-amber">Kein API-Schlüssel hinterlegt.</strong> Ohne den kann die Nachricht nicht
            gelesen werden — einzutragen in den Einstellungen unter „Nachrichten mit KI lesen“.
          </p>
        )}

        {proposals.length === 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    setText(await navigator.clipboard.readText())
                  } catch {
                    setError('Die Zwischenablage ließ sich nicht lesen — bitte von Hand einfügen.')
                  }
                }}
              >
                <IconCopy />Aus Zwischenablage
              </Button>
              <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
                <IconCamera />Bildschirmfoto
              </Button>
              {(text || images.length > 0) && (
                <Button size="sm" variant="ghost" onClick={reset}>Leeren</Button>
              )}
            </div>

            <Textarea
              rows={6}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => void addImages(e.clipboardData.files)}
              placeholder={'Nachricht hier einfügen — aus Kleinanzeigen, per Mail, aus WhatsApp.\nOder ein Bildschirmfoto einfügen.'}
            />

            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((i, n) => (
                  <span key={i.url} className="relative">
                    <img src={i.url} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-line" />
                    <button
                      type="button"
                      aria-label="Bild entfernen"
                      onClick={() => {
                        URL.revokeObjectURL(i.url)
                        setImages((prev) => prev.filter((_, k) => k !== n))
                      }}
                      className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white"
                    >
                      <IconClose />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <Button
              variant="primary"
              className="w-full"
              disabled={busy || readOnly || !key || (!text.trim() && images.length === 0)}
              onClick={() => void analyse()}
            >
              <IconSpark />{busy ? 'Liest …' : 'Lesen und Vorschläge machen'}
            </Button>
          </>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-[13px]">
            <IconWarn className="mt-0.5 shrink-0 text-amber" />
            {error}
          </p>
        )}

        {read && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={read.intent === 'kaufinteresse' ? 'green' : read.intent === 'absage' ? 'rose' : 'sky'}>
                {read.intent === 'kaufinteresse' ? 'Kaufinteresse' : read.intent === 'frage' ? 'Nur eine Frage' : read.intent === 'absage' ? 'Absage' : 'Sonstiges'}
              </Pill>
              <span className="text-[13px] text-muted">{read.summary}</span>
            </div>

            {read.transcript && (
              <details className="rounded-xl bg-surface-2 p-3 text-[13px]">
                <summary className="cursor-pointer font-semibold">Aus dem Bild gelesen</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{read.transcript}</pre>
              </details>
            )}

            {sure.length > 0 && (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-muted">Am Text belegt</p>
                {sure.map((p) => (
                  <ProposalCard key={p.id} p={p} done={applied[p.id]} blocked={blocked(p)} onTake={() => take(p)} />
                ))}
              </div>
            )}

            {unsure.length > 0 && (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-amber">
                  Vermutung — bitte selbst nachsehen
                </p>
                {unsure.map((p) => (
                  <ProposalCard key={p.id} p={p} done={applied[p.id]} blocked={blocked(p)} onTake={() => take(p)} />
                ))}
              </div>
            )}

            {proposals.length === 0 && (
              <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
                Aus dieser Nachricht folgt nichts, was sich belegen ließe.
              </p>
            )}

            {read.dropped.length > 0 && (
              <details className="rounded-xl border border-line p-3 text-[13px]">
                <summary className="cursor-pointer font-semibold text-muted">
                  {read.dropped.length} Vorschlag{read.dropped.length === 1 ? '' : 'e'} verworfen
                </summary>
                <ul className="mt-2 list-inside list-disc text-muted">
                  {read.dropped.map((d) => <li key={d}>{d}</li>)}
                </ul>
              </details>
            )}

            <div className="space-y-2 border-t border-line pt-4">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !key} onClick={() => void makeReply()}>
                  <IconSpark />Antwort vorschlagen
                </Button>
              </div>
              {reply != null && (
                <div className="rounded-xl bg-surface-2 p-3">
                  <Textarea rows={5} value={reply} onChange={(e) => setReply(e.target.value)} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void navigator.clipboard.writeText(reply)}>
                      <IconCopy />Kopieren
                    </Button>
                    {typeof navigator.share === 'function' && (
                      <Button size="sm" variant="ghost" onClick={() => void navigator.share({ text: reply }).catch(() => {})}>
                        Teilen
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] text-muted">
                    Preise und Abholhinweise stammen aus dem Bestand, nicht von der KI. Trotzdem vor dem Abschicken lesen.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="Was soll ich sonst noch damit tun?"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-primary"
                />
                <Button size="sm" disabled={busy || !ask.trim()} onClick={() => void analyse(ask)}>
                  Nochmal lesen
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          {proposals.length > 0 && <Button onClick={reset}>Nächste Nachricht</Button>}
          {/* Schreibt nichts. Der Griff unten rechts ist damit folgenlos. */}
          <Button variant="primary" onClick={() => { reset(); onClose() }}>Fertig</Button>
        </div>
      </div>

      <input
        ref={file}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addImages(e.target.files)
          e.target.value = ''
        }}
      />
    </Modal>
  )
}

function ProposalCard({ p, done, blocked, onTake }: { p: Proposal; done?: string; blocked: boolean; onTake: () => void }) {
  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary-soft/40 px-3 py-2.5 text-[13px]">
        <IconCheck className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 font-semibold">{done}</span>
        <span className="shrink-0 text-muted">übernommen</span>
      </div>
    )
  }
  return (
    <div className={cx('rounded-xl border p-3', p.publishes ? 'border-amber/50 bg-amber-soft/30' : 'border-line')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 font-semibold">{p.title}</span>
        {p.publishes && <Pill tone="amber">wird öffentlich</Pill>}
      </div>
      {p.effect && <p className="mt-1 text-[13px] text-muted">{p.effect}</p>}
      {p.warning && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[13px] font-semibold text-amber">
          <IconWarn className="mt-0.5 shrink-0" />{p.warning}
        </p>
      )}
      {/* Der Beleg gehört an den Vorschlag, nicht in eine Fußnote. */}
      <blockquote className="mt-2 border-l-2 border-line-strong pl-2.5 text-[13px] text-muted italic">
        {p.quote}
      </blockquote>
      <div className="mt-2.5 flex justify-end">
        <Button size="sm" variant={p.publishes ? 'danger' : 'primary'} disabled={blocked} onClick={onTake}>
          {blocked ? 'Erst den Interessenten anlegen' : p.publishes ? 'Prüfen & übernehmen' : 'Übernehmen'}
        </Button>
      </div>
    </div>
  )
}

/** Der Knopf, der von jeder Ansicht aus erreichbar ist. */
export function InboxButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Nachricht einlesen"
      className="tx press fixed right-4 bottom-20 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-primary bg-primary text-primary-text shadow-card hover:brightness-110 lg:bottom-6"
    >
      <IconInbox className="h-6 w-6" />
    </button>
  )
}
