import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Pill, Textarea, cx } from './ui'
import { IconCamera, IconCheck, IconClose, IconCopy, IconInbox, IconSpark, IconWarn } from './icons'
import { AiError, draftReply, readProposals, type AiImage } from '../lib/ai'
import { buildPlan, checkProposals, type MessageContext, type Plan, type Proposal } from '../lib/inbox'
import { applyProposal, quoteToDeal } from '../lib/actions'
import { parseMessage } from '../lib/ads'
import { eur } from '../lib/format'
import { openQuotesOf } from '../lib/stats'
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
  const { db } = useStore()
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
  /** Was der eine Knopf getan hat, Zeile für Zeile. */
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([])
  const [ran, setRan] = useState(false)
  const [confirmSale, setConfirmSale] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const key = db.settings.ai.apiKey

  // Der Entwurf überlebt das versehentliche Schließen und die PIN-Abfrage — er
  // steckt sonst nur in useState und ist mit einem Klick auf den Rand weg.
  useEffect(() => {
    if (!open) return
    const saved = sessionStorage.getItem(DRAFT_KEY)
    if (initialText) {
      setText(initialText)
      readSoon(initialText)
    } else if (saved) setText(saved)
  }, [open, initialText])

  useEffect(() => {
    if (open) sessionStorage.setItem(DRAFT_KEY, text)
  }, [open, text])

  /**
   * Eingefügt heißt: fertig — getippt heißt: noch nicht.
   *
   * Der erste Entwurf merkte sich das Einfügen in einem Zustand und ließ einen
   * Effekt darauf reagieren. Das ging schief: React arbeitet den Effekt ab,
   * bevor es das Rendern mit dem neuen Text verarbeitet — der Effekt sah den
   * ALTEN Text, löschte die Merkfahne, und der Lauf mit dem neuen Text kam nie.
   * Beim zweiten Einfügen las er dann den Stand von davor und kostete Geld für
   * eine Analyse des falschen Texts.
   *
   * Deshalb wird der fertige Text direkt übergeben, statt auf den Zustand zu warten.
   */
  const pending = useRef<number | null>(null)
  function readSoon(full: string) {
    if (!key || busy || !full.trim()) return
    if (pending.current) window.clearTimeout(pending.current)
    // Eine kurze Pause: mehrere Bilder oder Text plus Bild sollen einen Lauf
    // ergeben, nicht drei.
    pending.current = window.setTimeout(() => void analyse('', full), 250)
  }
  useEffect(() => () => { if (pending.current) window.clearTimeout(pending.current) }, [])

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
    setLog([])
    setRan(false)
    setConfirmSale(false)
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

  async function analyse(extra = '', override?: string) {
    if (!key) return
    const source = override ?? text
    setBusy(true)
    setError(null)
    try {
      const res = await readProposals(source, images.map((i) => i.img), db, key, db.settings.ai.model, extra)
      // Bei einem Bild ist das Transkript der Text, gegen den geprüft wird —
      // ohne ihn hätte die Prüfung nichts, woran sie sich halten könnte.
      const against = [source, res.transcript].filter(Boolean).join('\n')
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

  /**
   * Der Vorgang steht auch ohne API-Schlüssel: `parseMessage` liest Kontaktdaten,
   * Positionsnummern und ein Gebot wörtlich aus dem Text. Die KI füllt, was
   * darüber hinausgeht — sie ist Verstärkung, keine Voraussetzung.
   */
  const parsed = useMemo(() => (message.trim() ? parseMessage(message, db) : null), [message, db])
  const plan = useMemo<Plan>(
    () => (parsed ? buildPlan(proposals, parsed, db, message) : { steps: [], risky: [], notes: [], summary: '' }),
    [proposals, parsed, db, message],
  )

  /**
   * Was aus dieser Nachricht über die Schritte hinaus hängen bleibt.
   *
   * Befund, Hinweise und die Liste der Schritte lebten nur, solange der Dialog
   * offen war. Sie gehen jetzt mit an den Interessenten: der Wortlaut in die
   * Nachrichtenliste, das Gelesene in die Notiz.
   */
  function context(): MessageContext {
    return {
      summary: read?.summary?.trim() ?? '',
      notes: plan.notes,
      steps: plan.steps.map((s) => s.title),
      fromImage: !!read?.transcript,
    }
  }

  /**
   * Ein Vorschlag einzeln. `done` leer heißt: es ist nichts passiert — vorher
   * sprang die Karte trotzdem auf „übernommen“.
   */
  function take(p: Proposal) {
    const res = applyProposal(p, leadId, message, context())
    if (res.leadId) setLeadId(res.leadId)
    if (res.done) setApplied((prev) => ({ ...prev, [p.id]: res.done }))
    else setError(`„${p.title}“ hat nichts geändert${res.skipped ? ` — ${res.skipped}` : ''}.`)
  }

  /**
   * Der eine Knopf: alles Billige in einem Zug.
   *
   * Die Kette wird hier durchgereicht, nicht über den Zustand — `setLeadId` wirkt
   * erst im nächsten Render, und der zweite Schritt bekäme sonst `null` und liefe
   * ins Leere, während die Oberfläche Vollzug meldete.
   */
  function runPlan() {
    // Jeder Schritt schreibt sofort. Bricht einer ab, dürfen die vorherigen nicht
    // ein zweites Mal laufen — sonst entsteht beim nächsten Druck ein zweiter
    // Interessent mit einem zweiten Angebot über dieselbe Ware.
    if (ran) return
    setRan(true)
    let carry = leadId
    const out: { text: string; ok: boolean }[] = []
    try {
      for (const step of plan.steps) {
        const res = applyProposal(step, carry, message, context())
        if (res.leadId) carry = res.leadId
        out.push(res.done ? { text: res.done, ok: true } : { text: `${step.title} — ${res.skipped ?? 'nichts geändert'}`, ok: false })
      }
    } catch (err) {
      out.push({ text: `Abgebrochen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`, ok: false })
    }
    setLeadId(carry)
    setLog(out)
  }

  /**
   * Der Verkauf hängt am Angebot — damit gilt derselbe Preis wie dort.
   *
   * `angenommen` gehört zu den erledigten: nach dem Buchen steht das Angebot dort,
   * und ohne diese Bedingung fand die Suche es weiter. Der rote Knopf kam sofort
   * zurück, und drei Klicks ergaben drei Verkäufe über dieselben zwei Tanks —
   * 11.700 € Umsatz für ein Geschäft. Die Angebotsansicht hat die Regel längst
   * (`closed` in views/Quotes.tsx), sie fehlte nur hier.
   */
  const quote = useMemo(
    () => openQuotesOf(db, leadId)[0] ?? null,
    [db.quotes, leadId],
  )

  function bookSale() {
    if (!quote) return
    const id = quoteToDeal(quote.id)
    setConfirmSale(false)
    setLog((prev) => [...prev, id
      ? { text: `Verkauf gebucht: ${quote.label} für ${eur(quote.buyerOffer ?? quote.askPrice)}`, ok: true }
      : { text: 'Verkauf konnte nicht gebucht werden', ok: false }])
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

  // Was im Vorgang steht, gehört nicht ein zweites Mal darunter. Übrig bleibt,
  // was der Zug bewusst auslässt — und alles, was er nach dem Lauf nicht deckt.
  const inPlan = useMemo(() => new Set([...plan.steps, ...plan.risky].map((p) => p.id)), [plan])
  const rest = useMemo(() => proposals.filter((p) => !inPlan.has(p.id)), [proposals, inPlan])
  const sure = useMemo(() => rest.filter((p) => p.proven && !p.publishes), [rest])
  const unsure = useMemo(() => rest.filter((p) => !p.proven || p.publishes), [rest])

  /**
   * Über den Rand oder Escape geschlossen räumte der Dialog nichts weg: beim
   * nächsten Öffnen stand das „Erledigt" der alten Nachricht da, samt scharfem
   * „Verkauf buchen" für den vorigen Käufer. Ein abgearbeiteter Vorgang gehört
   * nicht in die nächste Nachricht.
   */
  function close() {
    if (ran) reset()
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Nachricht einlesen" wide>
      <div className="space-y-4">
        {!key && !ran && (
          <p className="rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-muted">
            <strong className="text-ink">Ohne API-Schlüssel.</strong> Kontaktdaten, Positionsnummern und ein Gebot
            werden trotzdem wörtlich aus der Nachricht gelesen — der Vorgang unten steht. Was darüber hinausgeht
            (Absicht, Bildschirmfotos, Antwortentwurf), braucht einen Schlüssel: Einstellungen, „Nachrichten mit KI lesen“.
          </p>
        )}

        {proposals.length === 0 && !ran && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const clip = await navigator.clipboard.readText()
                    setText(clip)
                    readSoon(clip)
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
              onPaste={(e) => {
                void addImages(e.clipboardData.files)
                // Was nach dem Einfügen im Feld steht, aus dem Ereignis gerechnet —
                // der Zustand trägt es an dieser Stelle noch nicht.
                const el = e.currentTarget
                const dropped = e.clipboardData.getData('text')
                if (dropped) {
                  const next = el.value.slice(0, el.selectionStart ?? 0) + dropped + el.value.slice(el.selectionEnd ?? 0)
                  readSoon(next)
                }
              }}
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

            {/*
              Ohne Schlüssel gar nicht erst zeigen: ein toter Balken in der Farbe
              der Hauptaktion zieht den Blick auf sich und tut nichts. Steht der
              Vorgang schon, ist Lesen nur noch die Ergänzung — dann tritt der
              Knopf zurück und überlässt dem Übernehmen die Farbe.
            */}
            {key && (
              <Button
                variant={plan.steps.length > 0 ? 'default' : 'primary'}
                className="w-full"
                disabled={busy || (!text.trim() && images.length === 0)}
                onClick={() => void analyse()}
              >
                <IconSpark />{busy ? 'Liest …' : plan.steps.length > 0 ? 'Genauer lesen (KI)' : 'Lesen und Vorschläge machen'}
              </Button>
            )}
          </>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-[13px]">
            <IconWarn className="mt-0.5 shrink-0 text-amber" />
            {error}
          </p>
        )}

        {/*
          Der Vorgang. Ein Knopf für alles, was billig und rücknehmbar ist —
          anlegen, anhängen, Angebot, Gebot. Was binnen einer Minute öffentlich
          wird, steht getrennt darunter und bleibt zweistufig.
        */}
        {/* Was in der Nachricht steht, aber nirgends hin kann — lieber sagen als schlucken. */}
        {plan.notes.length > 0 && !ran && (
          <ul className="space-y-1 rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
            {plan.notes.map((n) => (
              <li key={n} className="flex items-start gap-2">
                <IconWarn className="mt-0.5 h-4 w-4 shrink-0 text-amber" />{n}
              </li>
            ))}
          </ul>
        )}

        {/*
          Auch ohne Zug sichtbar. Vorher hingen sie am `ran`-Block: gab es keinen
          Zug — etwa weil der Kontaktweg fehlt —, verschwand der einzige Vorschlag,
          den die KI geliefert hat, wortlos. Bezahlt und weggeworfen.
        */}
        {plan.risky.length > 0 && !ran && (
          <div className="rounded-xl border border-amber/50 bg-amber-soft/30 p-3">
            <p className="text-[11px] font-bold text-amber uppercase">Wird öffentlich sichtbar</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.risky.map((p) => (
                <Button key={p.id} size="sm" variant="danger" disabled={!!applied[p.id] || !leadId} onClick={() => take(p)}>
                  {applied[p.id] ? `✓ ${p.title}` : !leadId ? `${p.title} — erst den Interessenten` : p.title}
                </Button>
              ))}
            </div>
            {!leadId && (
              <p className="mt-1.5 text-[13px] text-muted">
                Erst muss jemand da sein, für den die Reservierung gilt — sonst wäre die Ware öffentlich weg und
                intern niemandem zugeordnet.
              </p>
            )}
          </div>
        )}

        {plan.steps.length > 0 && !ran && (
          <div className="rounded-xl border border-primary/40 bg-primary-soft/25 p-3">
            <p className="text-[11px] font-bold text-muted uppercase">Vorgang</p>
            <ol className="mt-1.5 space-y-1 text-[13px]">
              {plan.steps.map((p, i) => (
                <li key={p.id} className="flex gap-2">
                  <span className="tnum shrink-0 text-faint">{i + 1}.</span>
                  <span className="min-w-0">
                    <span className="font-semibold">{p.title}</span>
                    {p.warning && (
                      <span className="mt-0.5 flex items-start gap-1.5 font-semibold text-amber">
                        <IconWarn className="mt-0.5 h-3.5 w-3.5 shrink-0" />{p.warning}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <Button variant="primary" className="mt-3 w-full" onClick={runPlan}>
              <IconCheck />{plan.steps.length === 1 ? 'Übernehmen' : `Alle ${plan.steps.length} übernehmen`}
            </Button>
            <p className="mt-1.5 text-xs text-faint">
              Nichts davon ist für Käufer sichtbar, und alles lässt sich zurücknehmen.
            </p>
          </div>
        )}

        {ran && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-1.5 text-[11px] font-bold text-muted uppercase">Erledigt</p>
            <ul className="space-y-1 text-[13px]">
              {log.map((l, i) => (
                <li key={i} className={cx('flex items-start gap-2', !l.ok && 'text-amber')}>
                  {l.ok ? <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <IconWarn className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span className="min-w-0">{l.text}</span>
                </li>
              ))}
            </ul>

            {/* Ab hier wird es öffentlich. Getrennter Block, eigener Griff. */}
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[11px] font-bold text-amber uppercase">Wird öffentlich sichtbar</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {plan.risky.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant="danger"
                    // Ohne Interessenten hätte eine Reservierung niemanden, für den
                    // sie gilt — die Ware wäre öffentlich weg und intern niemandem
                    // zugeordnet.
                    disabled={!!applied[p.id] || !leadId}
                    onClick={() => take(p)}
                  >
                    {applied[p.id] ? `✓ ${p.title}` : !leadId ? `${p.title} — erst den Interessenten` : p.title}
                  </Button>
                ))}
                {quote && !confirmSale && (
                  <Button size="sm" variant="danger" onClick={() => setConfirmSale(true)}>
                    Verkauf buchen
                  </Button>
                )}
              </div>
              {!quote && plan.risky.length === 0 && (
                <p className="mt-1 text-[13px] text-muted">
                  Nichts, was jetzt öffentlich würde. Ein Verkauf braucht erst ein Angebot, und ein bereits
                  gebuchtes ist erledigt.
                </p>
              )}
              {confirmSale && quote && (
                <div className="mt-2 rounded-xl border border-rose/50 bg-rose-soft/30 p-3 text-[13px]">
                  <p>
                    <strong>{quote.tankIds.length} {quote.tankIds.length === 1 ? 'Position' : 'Positionen'} für {eur(quote.buyerOffer ?? quote.askPrice)}</strong>{' '}
                    als verkauft buchen. Sie verschwinden binnen etwa einer Minute aus der Käuferliste, auch aus jedem Paket.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="danger" onClick={bookSale}>Ja, buchen</Button>
                    <Button size="sm" onClick={() => setConfirmSale(false)}>Abbrechen</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
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
          {(proposals.length > 0 || ran) && <Button onClick={reset}>Nächste Nachricht</Button>}
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
