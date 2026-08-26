import { useMemo, useState } from 'react'
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SectionTitle, Select, Textarea, cx, type Tone } from '../components/ui'
import { IconCheck, IconPlus, IconSpark, IconTrash } from '../components/icons'
import { addLead, attachTanks, createQuote, detachTanks, noteOnLead, patchLead, patchQuote, removeLead, setLeadWatch, setQuoteTanks } from '../lib/actions'
import { parseMessage } from '../lib/ads'
import { AiError, readMessage, type AiResult } from '../lib/ai'
import { itemLabel, dateDE, eur, num, relativeDE, todayISO } from '../lib/format'
import { openQuotesOf, quoteRelation, totals } from '../lib/stats'
import { Verlauf } from '../components/Verlauf'
import { MAX_PER_LEAD } from '../lib/inbox'
import { askFor } from '../lib/inbox'
import { useStore } from '../lib/store'
import { STAGE_LABEL, SOURCE_LABEL, QUOTE_STATUS_LABEL, type Lead, type LeadSource, type LeadStage } from '../types'
import type { Go, ViewProps } from '../App'

const STAGES: LeadStage[] = ['neu', 'kontakt', 'angebot', 'reserviert', 'gewonnen', 'verloren']
const SOURCES: LeadSource[] = ['kleinanzeigen', 'telefon', 'email', 'empfehlung', 'vorort', 'sonstige']

const STAGE_TONE: Record<LeadStage, Tone> = {
  neu: 'sky', kontakt: 'amber', angebot: 'amber', reserviert: 'sky', gewonnen: 'green', verloren: 'neutral',
}

export default function Leads({ go, focus }: ViewProps) {
  const { db } = useStore()
  const readOnly = false
  /*
   * Ein Sprung auf einen Menschen öffnet seine Karte.
   *
   * Die Übersicht schickte bei „N Wiedervorlagen fällig" bisher nur auf die
   * Liste; welcher der Menschen gemeint war, musste man erneut ablesen. Und vom
   * Angebot oder Verkauf zurück gab es überhaupt keinen Weg.
   */
  const [edit, setEdit] = useState<Lead | null>(() => db.leads.find((l) => l.id === focus.leadId) ?? null)
  const [creating, setCreating] = useState(false)
  const [parsing, setParsing] = useState(false)

  const open = db.leads.filter((l) => l.stage !== 'gewonnen' && l.stage !== 'verloren')
  const closed = db.leads.filter((l) => l.stage === 'gewonnen' || l.stage === 'verloren')
  const due = open.filter((l) => l.nextFollowUp && new Date(l.nextFollowUp) <= new Date())

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="Interessenten"
          hint={`${open.length} offen · ${due.length} Wiedervorlage${due.length === 1 ? '' : 'n'} fällig · ${closed.length} abgeschlossen`}
          action={
            !readOnly && (
              <div className="flex gap-2">
                <Button onClick={() => setParsing(true)}><IconSpark />Aus Nachricht</Button>
                <Button variant="primary" onClick={() => setCreating(true)}><IconPlus />Interessent</Button>
              </div>
            )
          }
        />
        {db.leads.length === 0 && (
          <EmptyState
            title="Noch keine Interessenten"
            hint="Trag Anfragen hier ein — oder kopier eine Kleinanzeigen-Nachricht hinein, dann werden Name, Telefonnummer und der gefragte Tank automatisch erkannt."
            action={!readOnly && <Button variant="primary" onClick={() => setParsing(true)}><IconSpark />Nachricht einfügen</Button>}
          />
        )}
      </Card>

      {due.length > 0 && (
        <Card className="border-amber/40">
          <SectionTitle title="Heute dran" hint="Wiedervorlage ist fällig oder überfällig." />
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {due.map((l) => <LeadCard key={l.id} lead={l} onEdit={() => setEdit(l)} highlight />)}
          </div>
        </Card>
      )}

      {open.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {open.map((l) => <LeadCard key={l.id} lead={l} onEdit={() => setEdit(l)} />)}
        </div>
      )}

      {closed.length > 0 && (
        <Card>
          <SectionTitle title="Abgeschlossen" />
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {closed.map((l) => <LeadCard key={l.id} lead={l} onEdit={() => setEdit(l)} />)}
          </div>
        </Card>
      )}

      {edit && <LeadModal lead={edit} onClose={() => setEdit(null)} readOnly={readOnly} go={go} />}
      {creating && <LeadModal lead={null} onClose={() => setCreating(false)} readOnly={false} go={go} />}
      {parsing && <ParseModal onClose={() => setParsing(false)} />}
    </div>
  )
}

function LeadCard({ lead, onEdit, highlight }: { lead: Lead; onEdit: () => void; highlight?: boolean }) {
  const { db } = useStore()
  const tanks = lead.tankIds.map((id) => db.tanks.find((t) => t.id === id)).filter(Boolean)
  const sum = tanks.reduce((a, t) => a + (t?.vb ?? 0), 0)
  // Angebot und Verkauf gehören auf dieselbe Karte wie das Interesse. Sonst
  // zeigt sie eine Summe, die mit dem, was der Mensch bekommen hat, nichts zu
  // tun hat — und der Weg dorthin führt über zwei andere Ansichten.
  const open = openQuotesOf(db, lead.id)
  const quote = open[0] ?? null
  const deal = db.deals.find((d) => d.leadId === lead.id) ?? null
  const messages = lead.messages ?? []

  return (
    <button type="button" onClick={onEdit}
      className={cx('rounded-2xl border bg-surface p-3.5 text-left shadow-card transition hover:border-line-strong hover:shadow-lg',
        highlight ? 'border-amber/50' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold">{lead.name}</div>
          <div className="truncate text-[13px] text-muted">{[lead.phone, lead.location].filter(Boolean).join(' · ') || SOURCE_LABEL[lead.source]}</div>
        </div>
        <Pill tone={STAGE_TONE[lead.stage]}>{STAGE_LABEL[lead.stage]}</Pill>
      </div>

      {tanks.length > 0 && (
        <div className="mt-2.5 text-[13px]">
          <span className="text-muted">Interesse: </span>
          <strong>{tanks.length === 1 ? itemLabel(tanks[0]!) : `${tanks.length} Positionen${tanks.reduce((a, t) => a + (t?.litres ?? 0), 0) > 0 ? ` · ${num(tanks.reduce((a, t) => a + (t?.litres ?? 0), 0))} l` : ''}`}</strong>
          <span className="tnum text-muted"> · {eur(sum)} VB</span>
        </div>
      )}

      {quote && (
        <div className="tnum mt-1 text-[13px]">
          <span className="text-muted">Angebot: </span>
          <strong>{eur(quote.askPrice)}</strong>
          {quote.buyerOffer != null && <span className="text-muted"> · geboten {eur(quote.buyerOffer)}</span>}
          <span className="text-muted"> · {quoteRelation(quote.tankIds, lead.tankIds)}</span>
          {open.length > 1 && <span className="text-muted"> · +{open.length - 1} {open.length === 2 ? 'weiteres' : 'weitere'}</span>}
        </div>
      )}
      {deal && (
        <div className="tnum mt-1 text-[13px]">
          <span className="text-muted">Verkauft: </span>
          <strong>{eur(deal.price)}</strong>
          <span className="text-muted"> · {deal.paid ? 'bezahlt' : 'Zahlung offen'} · {deal.pickedUp ? 'abgeholt' : 'Abholung offen'}</span>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
        {lead.lastContact && <span>Kontakt {relativeDE(lead.lastContact)}</span>}
        {lead.nextFollowUp && (
          <span className={cx(new Date(lead.nextFollowUp) <= new Date() && 'font-bold text-amber')}>
            Wiedervorlage {dateDE(lead.nextFollowUp)}
          </span>
        )}
        {lead.budget != null && <span className="tnum">Budget {eur(lead.budget)}</span>}
      </div>
      {lead.note && <p className="mt-2 line-clamp-2 text-[13px] text-muted">{lead.note}</p>}
      {messages.length > 0 && (
        <p className="mt-1 text-xs text-faint">
          {messages.length} eingelesene {messages.length === 1 ? 'Nachricht' : 'Nachrichten'}
        </p>
      )}
    </button>
  )
}

function LeadModal({ lead, onClose, readOnly, go }: { lead: Lead | null; onClose: () => void; readOnly: boolean; go: Go }) {
  const { db } = useStore()

  /**
   * Der Entwurf hält nur, was im Formular angefasst wurde — alles andere kommt
   * live aus der Datenbank.
   *
   * Vorher lag beim Öffnen eine Kopie des ganzen Datensatzes im Entwurf, und
   * `save()` schrieb sie per Object.assign zurück: Notiz, Nachrichten und
   * letzter Kontakt mit dem Stand von vorhin. Wer die Karte nur öffnete, um
   * eine Telefonnummer zu korrigieren, machte damit alles zunichte, was der
   * Posteingang inzwischen an diesem Interessenten vermerkt hatte. Für die
   * Positionen war das schon geflickt — es galt aber für jedes andere Feld
   * genauso.
   */
  const live = lead ? db.leads.find((l) => l.id === lead.id) ?? lead : null
  const [draft, setDraft] = useState<Partial<Lead>>(
    lead ? {} : { name: '', phone: '', email: '', location: '', source: 'kleinanzeigen', stage: 'neu', tankIds: [], note: '', lastContact: todayISO() },
  )
  const set = (patch: Partial<Lead>) => setDraft((d) => ({ ...d, ...patch }))
  const [filter, setFilter] = useState('')

  /** Angefasst schlägt gespeichert; ungefasst zeigt den Live-Stand. */
  function cur<K extends keyof Lead>(k: K): Lead[K] | undefined {
    return k in draft ? (draft[k] as Lead[K]) : live?.[k]
  }

  const picked = live ? live.tankIds : (draft.tankIds ?? [])
  /*
   * Der ganze Vorgang, nicht nur sein Anfang.
   *
   * `openQuotesOf` gibt seit jeher eine LISTE zurück, hier wurde überall nur
   * `[0]` genommen: die Kachel zählte „+N weitere", der Dialog zeigte sie nicht.
   * Und den Verkauf sah man auf der Kachel, im geöffneten Dialog aber nicht mehr
   * — wer ihn öffnete, um eine Telefonnummer zu ändern, verlor die Information,
   * dass der Mensch längst gekauft hat.
   */
  const alleAngebote = openQuotesOf(db, live?.id ?? null)
  const verkaeufe = live ? db.deals.filter((d) => d.leadId === live.id) : []
  // Die eigenen reservierten Positionen. In der Ankreuzliste tragen sie keine
  // Marke — `foreign` greift nur bei FREMDEN Zusagen —, der Zustand war hier
  // also gar nicht zu sehen.
  const reserviertHier = live ? db.tanks.filter((t) => t.leadId === live.id && t.status === 'reserviert') : []
  const quote = alleAngebote[0] ?? null
  const quoteIds = useMemo(() => new Set(quote?.tankIds ?? []), [quote])
  // Was auseinandergeht, und in welche Richtung. „2 von 1 Position“ stand da,
  // solange ich das Angebot für eine Teilmenge der Auswahl hielt — nach dem
  // Abwählen einer Position stimmt das nicht mehr.
  const onlyQuote = quote ? quote.tankIds.filter((id) => !picked.includes(id)) : []
  const onlyPicked = quote ? picked.filter((id) => !quote.tankIds.includes(id)) : []
  const differs = onlyQuote.length > 0 || onlyPicked.length > 0
  const relation = quote ? quoteRelation(quote.tankIds, picked) : ''

  // `openTanks` entstand bei jedem Render neu, deshalb griff der Memo darunter
  // nie — bei 58 Positionen und einem Filterfeld ist das jede Taste.
  // „In Vorbereitung" gehört NICHT in diese Liste: dafür gibt es die
  // Bescheid-Liste darunter. Stünde beides hier, gäbe es „will diese Maschine"
  // in zwei Listen mit verschiedener Bedeutung, einen Klick auseinander.
  const openTanks = useMemo(
    () => db.tanks.filter((t) => (t.status !== 'verkauft' && t.status !== 'vorbereitung') || picked.includes(t.id)),
    [db.tanks, picked],
  )
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return openTanks
    return openTanks.filter((t) => [t.id, t.maker, t.type, String(t.litres)].some((v) => v.toLowerCase().includes(q)))
  }, [openTanks, filter])
  const pickedSum = db.tanks.filter((t) => picked.includes(t.id)).reduce((a, t) => a + t.vb, 0)
  const leadName = useMemo(() => new Map(db.leads.map((l) => [l.id, l.name])), [db.leads])
  // Der Preis für eine noch nicht abgeschickte Auswahl — nicht bei jedem
  // Tastendruck im Namensfeld neu durch den ganzen Katalog rechnen.
  const wouldAsk = useMemo(() => (picked.length ? askFor(db, picked) : 0), [db, picked])

  function toggleTank(id: string, on: boolean) {
    // Ohne Interessenten gibt es noch nichts zu schreiben — dann trägt der Entwurf.
    if (!live) {
      set({ tankIds: on ? [...(draft.tankIds ?? []), id] : (draft.tankIds ?? []).filter((x) => x !== id) })
      return
    }
    if (on) attachTanks(live.id, [id])
    else detachTanks(live.id, [id])
  }

  function syncFromQuote(ids: string[]) {
    if (!live) return
    const add = ids.filter((id) => !picked.includes(id))
    const drop = picked.filter((id) => !ids.includes(id))
    if (add.length) attachTanks(live.id, add)
    if (drop.length) detachTanks(live.id, drop)
  }

  function makeQuote() {
    if (!live || picked.length === 0) return
    createQuote({
      label: `Anfrage ${live.name}`.trim(),
      tankIds: picked,
      askPrice: askFor(db, picked),
      leadId: live.id,
      portalId: null,
      note: '',
    })
  }

  function save() {
    if (lead) {
      // Nur die angefassten Felder — der Entwurf enthält keine anderen mehr.
      // `tankIds` bleibt trotzdem draußen: die Häkchen schreiben sofort.
      const { tankIds: _ignored, ...rest } = draft
      patchLead(lead.id, rest, `Interessent aktualisiert: ${cur('name') ?? lead.name}`)
    } else addLead(draft)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={lead ? lead.name : 'Neuer Interessent'} wide>
      <div className="space-y-4">
        {/*
          Der Vorgang auf einen Blick, ganz oben.
          Angebot und Verkauf standen bisher unter der Ankreuzliste über alle 58
          Positionen — wer wissen wollte, wo der Mensch steht, musste erst an
          58 Zeilen vorbeiscrollen. Und der Verkauf fehlte im Dialog ganz,
          obwohl die Kachel darüber ihn zeigt.
        */}
        {lead && (alleAngebote.length > 0 || verkaeufe.length > 0 || reserviertHier.length > 0 || (live?.watch ?? []).length > 0) && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
            <span className="font-semibold text-muted">Stand:</span>
            {alleAngebote.length > 0 && (
              <Pill tone="sky">
                {alleAngebote.length === 1 ? '1 offenes Angebot' : `${alleAngebote.length} offene Angebote`}
              </Pill>
            )}
            {reserviertHier.length > 0 && <Pill tone="amber">{reserviertHier.length} reserviert</Pill>}
            {(live?.watch ?? []).length > 0 && (
              <Pill tone={(live?.watch ?? []).some((w) => {
                // Ein Eintrag auf eine gelöschte Position ist nicht „fällig" —
                // `undefined !== 'vorbereitung'` wäre sonst wahr.
                const st = db.tanks.find((t) => t.id === w.tankId)?.status
                return st !== undefined && st !== 'vorbereitung'
              }) ? 'amber' : 'neutral'}>
                wartet auf {(live?.watch ?? []).length === 1 ? '1 Position' : `${(live?.watch ?? []).length} Positionen`}
              </Pill>
            )}
            {verkaeufe.length > 0 && (
              <Pill tone="green">
                {verkaeufe.length === 1 ? 'verkauft' : `${verkaeufe.length} Verkäufe`} · {eur(verkaeufe.reduce((a, d) => a + d.price, 0))}
              </Pill>
            )}
            <span className="ml-auto flex flex-wrap gap-2">
              {quote && (
                <Button size="sm" onClick={() => { onClose(); go('quotes', { leadId: lead.id, quoteId: quote.id }) }}>
                  Zum Angebot
                </Button>
              )}
              {verkaeufe.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => { onClose(); go('deals', { leadId: lead.id }) }}>
                  Zum Verkauf
                </Button>
              )}
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={cur('name') ?? ''} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} autoFocus={!lead} /></Field>
          <Field label="Telefon"><Input value={cur('phone') ?? ''} disabled={readOnly} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" /></Field>
          <Field label="E-Mail"><Input value={cur('email') ?? ''} disabled={readOnly} onChange={(e) => set({ email: e.target.value })} inputMode="email" /></Field>
          <Field label="Ort"><Input value={cur('location') ?? ''} disabled={readOnly} onChange={(e) => set({ location: e.target.value })} /></Field>
          <Field label="Quelle">
            <Select value={cur('source')} disabled={readOnly} onChange={(e) => set({ source: e.target.value as LeadSource })}>
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Phase">
            <Select value={cur('stage')} disabled={readOnly} onChange={(e) => set({ stage: e.target.value as LeadStage })}>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Budget (€)"><Input type="number" className="tnum" value={cur('budget') ?? ''} disabled={readOnly} onChange={(e) => set({ budget: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Letzter Kontakt"><Input type="date" value={cur('lastContact') ?? ''} disabled={readOnly} onChange={(e) => set({ lastContact: e.target.value || null })} /></Field>
          <Field label="Wiedervorlage" hint="Taucht auf der Übersicht auf, sobald das Datum erreicht ist.">
            <Input type="date" value={cur('nextFollowUp') ?? ''} disabled={readOnly} onChange={(e) => set({ nextFollowUp: e.target.value || null })} />
          </Field>
        </div>

        <Field
          as="div"
          label="Interesse an"
          hint={lead
            ? 'Änderungen wirken sofort — die Karte, der Bestand und ein bestehendes Angebot lesen dieselben Daten.'
            : 'Wird beim Anlegen übernommen.'}
        >
          <div className="space-y-2">
            {openTanks.length > 8 && (
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filtern — ${openTanks.length} Positionen`}
              />
            )}
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line bg-surface-2 p-2">
              {/* `min-w-0`: ohne das richten sich die Spalten nach ihrem Inhalt,
                  `truncate` greift nie, und die Preisspalte steht auf dem Handy
                  außerhalb des Kastens — gemessen 48 px daneben, ohne Balken. */}
              <div className="grid gap-1 sm:grid-cols-2">
                {shown.map((t) => {
                  const on = picked.includes(t.id)
                  const inQuote = quoteIds.has(t.id)
                  /* Wem die Position sonst gehört. Vorher bot die Liste jede
                     nicht verkaufte Position gleich aussehend an: eine für
                     jemand anderen reservierte wanderte per Häkchen still in
                     dieses Angebot und ließ sich von dort verkaufen — der
                     erste Käufer verlor seine Zusage ohne einen Hinweis. */
                  const foreign = t.leadId && t.leadId !== live?.id ? leadName.get(t.leadId) ?? null : null
                  const taken = !on && t.status === 'reserviert' && !!foreign
                  // Nur der Rufname auf der Marke: mit dem vollen Namen blieb von
                  // „Rundtank · 3.700 l" ein „Rundtank · 3...." übrig, und bei
                  // Tanks sind die Liter das Unterscheidende. Der ganze Name
                  // steht im Tooltip der Zeile.
                  const kurz = foreign ? foreign.split(/\s+/)[0] : null
                  return (
                    <label key={t.id}
                      title={foreign ? (taken ? `Für ${foreign} reserviert — erst dort lösen.` : `Im Kontakt mit ${foreign}.`) : undefined}
                      className={cx('flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]',
                        taken ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-surface-3')}>
                      <input type="checkbox" checked={on} disabled={readOnly || taken} className="h-4 w-4 accent-[var(--primary)]"
                        onChange={() => toggleTank(t.id, !on)} />
                      {/* Ohne die Nummer stehen zwei gleiche Tanks als zwei
                          identische Zeilen da — und die Nummer ist ohnehin das,
                          was in Anzeigen und Anfragen genannt wird. */}
                      {/* Die Nummer trägt hier die Identität — in text-faint hatte
                          sie 2,9 : 1 auf hellem Grund, das schwächste Zeichen der
                          Zeile. */}
                      <span className="tnum shrink-0 text-muted">{t.id}</span>
                      <span className="min-w-0 truncate">{itemLabel(t)}</span>
                      {/* Wo eine Position schon im Angebot steckt, muss man es sehen —
                          sonst wirkt „Interesse“ und „angeboten“ wie dasselbe. */}
                      {inQuote && <Pill tone="sky">im Angebot</Pill>}
                      {t.status === 'verkauft' && <Pill tone="neutral">verkauft</Pill>}
                      {t.status === 'reserviert' && kurz && <Pill tone="amber">für {kurz}</Pill>}
                      {t.status === 'kontakt' && kurz && <Pill tone="neutral">bei {kurz}</Pill>}
                      <span className="tnum ml-auto shrink-0 text-muted">{eur(t.vb)}</span>
                    </label>
                  )
                })}
                {shown.length === 0 && <p className="px-2 py-1.5 text-[13px] text-muted">Nichts gefunden.</p>}
              </div>
            </div>
            <p className="tnum text-[13px] text-muted">
              {picked.length} {picked.length === 1 ? 'Position' : 'Positionen'} · {eur(pickedSum)} VB
            </p>
          </div>
        </Field>

        {/*
          „Bescheid geben, sobald im Verkauf" — der Zukunftswunsch, getrennt vom
          Interesse am laufenden Verkauf.

          Zur Auswahl steht nur, was in Vorbereitung ist: für Verkäufliches gibt
          es „Interesse an" und das Angebot, ein Bescheid-Wunsch darauf wäre
          dasselbe in grün und sofort „fällig". Bereits eingetragene Wünsche
          bleiben sichtbar, auch wenn die Position inzwischen im Verkauf oder
          verkauft ist — das Abhaken IST das Erledigen.
        */}
        {live && (db.tanks.some((t) => t.status === 'vorbereitung') || (live.watch ?? []).length > 0) && (
          <Field as="div" label="Bescheid geben, sobald im Verkauf" hint="für Positionen, die noch in Vorbereitung sind">
            <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
              {db.tanks
                .filter((t) => t.status === 'vorbereitung' || (live.watch ?? []).some((w) => w.tankId === t.id))
                .map((t) => {
                  const eintrag = (live.watch ?? []).find((w) => w.tankId === t.id)
                  return (
                    <label key={t.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-surface-2">
                      <input type="checkbox" checked={Boolean(eintrag)}
                        onChange={(e) => setLeadWatch(live.id, t.id, e.target.checked)}
                        className="h-4 w-4 accent-[var(--primary)]" />
                      <span className="tnum text-xs text-muted">{t.id}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{itemLabel(t)}</span>
                      {t.status === 'vorbereitung'
                        ? <Pill tone="neutral">in Vorbereitung</Pill>
                        : t.status === 'verkauft'
                          ? <Pill tone="neutral">verkauft — absagen?</Pill>
                          : <Pill tone="amber">jetzt im Verkauf</Pill>}
                      {/* Am Handy weicht das Datum: Pill und Datum zusammen
                          quetschten den Positionsnamen auf „Willme…". */}
                      {eintrag && <span className="tnum hidden text-[11px] text-muted sm:inline">{dateDE(eintrag.at)}</span>}
                    </label>
                  )
                })}
            </div>
          </Field>
        )}

        {/*
          Angebot und Interesse sind zwei Fragen: worüber redet der Mensch, und
          worüber wurde ein Preis genannt. Sie werden deshalb nicht heimlich
          gleichgezogen — der Unterschied steht da, und beide Richtungen sind ein
          ausdrücklicher Griff mit Verlaufseintrag.
        */}
        {lead && !readOnly && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            {quote ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px]">
                    <strong>Angebot {quote.id}</strong> · {relation === 'deckungsgleich' ? 'wie die Auswahl' : relation} · {eur(quote.askPrice)} gefordert
                    {quote.buyerOffer != null && ` · ${eur(quote.buyerOffer)} geboten`}
                  </span>
                  <Pill tone={quote.status === 'verhandlung' ? 'amber' : 'sky'}>{QUOTE_STATUS_LABEL[quote.status]}</Pill>
                </div>
                {differs && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/* Beide Knöpfe überschreiben Daten, in entgegengesetzte
                        Richtungen — die Namen dürfen sich nicht bloß in der
                        Wortstellung unterscheiden, und der zweite darf nicht wie
                        eine Bildunterschrift aussehen. */}
                    <Button size="sm" disabled={picked.length === 0} onClick={() => setQuoteTanks(quote.id, picked)}>
                      Angebot anpassen ({picked.length})
                    </Button>
                    <Button size="sm" onClick={() => syncFromQuote(quote.tankIds)}>
                      Auswahl anpassen ({quote.tankIds.length})
                    </Button>
                  </div>
                )}

                {/* Preis, Status, Einzelpreise, Reservieren und Buchen leben
                    in der Angebotsansicht. Statt sie hier zu verdoppeln, führt
                    ein Weg dorthin — mit vorgewähltem Kontakt und aufgeklappter
                    Karte, sodass man nicht erst sucht. */}
                <div className="mt-2">
                  <Button size="sm" onClick={() => { onClose(); go('quotes', { leadId: lead.id, quoteId: quote.id }) }}>
                    Angebot bearbeiten
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] text-muted">
                  {picked.length === 0
                    ? 'Noch kein Angebot. Erst etwas auswählen.'
                    : `Aus der Auswahl wird ein Angebot über ${eur(wouldAsk)} — nach Katalogregel mit Paketen und Staffel.`}
                </span>
                <Button size="sm" variant="primary" disabled={picked.length === 0} onClick={makeQuote}>
                  <IconPlus />Angebot erstellen
                </Button>
              </div>
            )}

            {/* Die Kachel zählte sie („+N weitere"), der Dialog zeigte nur das
                erste — die übrigen waren ausschließlich über die Angebotsansicht
                erreichbar. */}
            {alleAngebote.length > 1 && (
              <ul className="mt-2 space-y-1 border-t border-line pt-2">
                {alleAngebote.slice(1).map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="text-muted">
                      <strong className="text-ink">{q.id}</strong> · {q.tankIds.length} Position{q.tankIds.length === 1 ? '' : 'en'} · {eur(q.askPrice)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill tone="neutral">{QUOTE_STATUS_LABEL[q.status]}</Pill>
                      <Button size="sm" variant="ghost" onClick={() => { onClose(); go('quotes', { leadId: lead.id, quoteId: q.id }) }}>
                        öffnen
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Der Verkauf stand auf der Kachel, im Dialog aber nirgends. */}
        {lead && verkaeufe.length > 0 && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-1.5 text-[11px] font-bold text-muted uppercase">
              {verkaeufe.length === 1 ? 'Verkauft' : `${verkaeufe.length} Verkäufe`}
            </p>
            <ul className="space-y-1">
              {verkaeufe.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="text-muted">
                    <strong className="text-ink">{eur(d.price)}</strong> · {d.tankIds.length} Position{d.tankIds.length === 1 ? '' : 'en'} · {dateDE(d.date)}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={d.paid ? 'green' : 'amber'}>{d.paid ? 'bezahlt' : 'offen'}</Pill>
                    <Pill tone={d.pickedUp ? 'green' : 'sky'}>{d.pickedUp ? 'abgeholt' : 'Abholung offen'}</Pill>
                    <Button size="sm" variant="ghost" onClick={() => { onClose(); go('deals', { leadId: lead.id }) }}>
                      öffnen
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Notiz"><Textarea rows={3} value={cur('note') ?? ''} disabled={readOnly} onChange={(e) => set({ note: e.target.value })} placeholder="Gesprächsverlauf, Preisvorstellung, Abholung …" /></Field>

        {/*
          Die eingelesenen Nachrichten hatten bisher keinen Leser: `noteOnLead`
          schrieb sie treu in die Datenbank, und keine Ansicht zeigte sie. Wer
          über den Posteingang angelegt wurde, hatte damit einen leeren
          Interessenten — der Wortlaut lag da, unsichtbar.
        */}
        {/*
          Aus der Leseliste ist ein Schriftwechsel geworden: eingegangen und
          geschrieben in derselben Reihenfolge, und von hier aus lässt sich
          antworten. Dieselbe Komponente steht am Angebot — die Historie hängt
          am Menschen, nicht am Angebot.
        */}
        {live && (
          <Field as="div" label="Schriftwechsel" hint={`Höchstens die letzten ${MAX_PER_LEAD}. Versendet wird nichts von selbst.`}>
            {/* Das offene Angebot reicht mit hinein: dann steht auch hier der
                Knopf für die fertige Angebots-E-Mail, und man muss dafür nicht
                erst in die Angebotsansicht wechseln. */}
            <Verlauf lead={live} quote={quote} readOnly={readOnly} />
          </Field>
        )}

        {!readOnly && (
          <div className="flex justify-between border-t border-line pt-4">
            {lead ? (
              <Button variant="danger" onClick={() => {
                // Wer einen scheinbar toten Kontakt löscht, löscht sonst still
                // eine Zusage („wir geben Bescheid").
                const zusagen = (live?.watch ?? []).length
                if (confirm(`${lead.name} löschen?${zusagen ? `\n\nAchtung: ${zusagen === 1 ? 'eine Bescheid-Zusage' : `${zusagen} Bescheid-Zusagen`} für kommende Positionen ${zusagen === 1 ? 'geht' : 'gehen'} mit verloren.` : ''}`)) { removeLead(lead); onClose() }
              }}><IconTrash />Löschen</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button onClick={onClose}>Abbrechen</Button>
              <Button variant="primary" onClick={save} disabled={!cur('name')?.trim()}>Speichern</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Paste an enquiry, get a pre-filled lead. Kleinanzeigen has no API, so this is the shortcut. */
function ParseModal({ onClose }: { onClose: () => void }) {
  const { db } = useStore()
  const [text, setText] = useState('')
  const [attachBroad, setAttachBroad] = useState(false)
  const [ai, setAi] = useState<AiResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const rule = text.trim() ? parseMessage(text, db) : null
  // The model only ever overwrites a field it actually found. Whatever it did not
  // see stays on what the rule read — the two together beat either alone.
  const parsed = rule && ai
    ? {
        ...rule,
        name: ai.name || rule.name,
        email: ai.email || rule.email,
        phone: ai.phone || rule.phone,
        /*
         * Der Regelweg hat Vorrang, aber nur für die Beträge, die er als
         * PREISLISTE gelesen hat.
         *
         * Sonst käme der teuerste Fehler durch die zweite Tür zurück: der
         * Käufer zitiert unsere eigenen Preise zurück, `parseMessage` erkennt
         * das und liefert bewusst `null` — und ein Modellwert überschriebe es
         * hier mit einem der Listenpreise als vermeintlichem Gebot.
         *
         * Nennt die KI dagegen eine Zahl, die NICHT in der Liste steht — „Ich
         * biete 1.800 EUR für alle drei zusammen" —, ist das ein echtes Gebot
         * und bleibt. Ein pauschales Veto hätte es verworfen und daneben
         * „Angebot — keines genannt" geschrieben, während es im Text steht.
         */
        offer: rule.priceList && (ai.offer == null || rule.amounts.includes(ai.offer))
          ? null
          : (ai.offer ?? rule.offer),
        matchedTankIds: ai.positionIds.length ? ai.positionIds : rule.matchedTankIds,
        exact: rule.exact || ai.positionIds.length > 0,
        broadMatch: ai.positionIds.length ? ai.positionIds.length > 3 : rule.broadMatch,
      }
    : rule

  async function askAi() {
    const key = db.settings.ai.apiKey
    if (!key) return
    setAiBusy(true)
    setAiError(null)
    try {
      setAi(await readMessage(text, db, key, db.settings.ai.model))
    } catch (err) {
      setAi(null)
      setAiError(err instanceof AiError ? err.message : 'Die KI konnte die Nachricht nicht lesen.')
    } finally {
      setAiBusy(false)
    }
  }
  // A guess that hits many positions at once is almost never what the buyer meant:
  // "225 l Fässer" matches all 29 barrels, and attaching them sets every one to
  // "kontakt" — locked away from other buyers. So a wide guess attaches nothing
  // until it is confirmed.
  const holdBack = !!parsed?.broadMatch && !attachBroad
  const tankIds = parsed && !holdBack ? parsed.matchedTankIds : []

  return (
    <Modal open onClose={onClose} title="Anfrage übernehmen" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Kopier die Nachricht aus Kleinanzeigen hier hinein. Name, Telefonnummer, E-Mail und die gefragte Position werden erkannt — du prüfst nur noch nach.
        </p>
        <Textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setAttachBroad(false); setAi(null); setAiError(null) }} autoFocus
          placeholder={'Hallo,\nist der Raumspar-Koffertank 1650 l noch zu haben? Ich würde ihn nächste Woche abholen.\nTel. 0176 12345678\nViele Grüße\nMax Mustermann'} />

        {db.settings.ai.apiKey && text.trim() && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={aiBusy} onClick={() => void askAi()}>
              <IconSpark />{aiBusy ? 'Liest …' : ai ? 'Noch einmal lesen' : 'Zusätzlich mit KI lesen'}
            </Button>
            {ai && <Pill tone={ai.intent === 'kaufinteresse' ? 'green' : ai.intent === 'absage' ? 'rose' : 'sky'}>
              {ai.intent === 'kaufinteresse' ? 'Kaufinteresse' : ai.intent === 'frage' ? 'Nur eine Frage' : ai.intent === 'absage' ? 'Absage' : 'Sonstiges'}
            </Pill>}
            {ai?.summary && <span className="text-[13px] text-muted">{ai.summary}</span>}
          </div>
        )}

        {aiError && (
          <p className="rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-[13px]">
            <strong className="text-amber">{aiError}</strong> Die Erkennung ohne KI unten läuft weiter.
          </p>
        )}

        {ai && ai.verworfen.length > 0 && (
          <div className="rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-[13px]">
            <strong className="text-amber">Von der KI verworfen, weil es nicht in der Nachricht steht:</strong>
            <ul className="mt-1 list-inside list-disc">{ai.verworfen.map((v) => <li key={v}>{v}</li>)}</ul>
          </div>
        )}

        {parsed && (
          <div className={cx('rounded-xl border p-3 text-sm', parsed.exact ? 'border-primary/50 bg-primary-soft/40' : 'border-line bg-surface-2')}>
            <div className="mb-2 flex items-center gap-2 font-bold">
              {parsed.exact ? <><IconCheck className="text-primary" />Exakt gelesen</> : 'Erkannt'}
            </div>
            {parsed.exact && (
              <p className="mb-2 text-[13px] text-muted">
                Die Nachricht stammt aus deiner Käuferliste — Positionen und Angebot wurden übernommen, nicht geraten.
              </p>
            )}
            <dl className="grid gap-1.5 sm:grid-cols-2">
              <Detail label="Name" value={parsed.name || '– nicht erkannt –'} />
              <Detail label="Telefon" value={parsed.phone || '–'} />
              <Detail label="E-Mail" value={parsed.email || '–'} />
              <Detail label={parsed.exact ? 'Angebot' : 'Genannte Größen'}
                value={parsed.exact
                  ? (parsed.offer != null ? eur(parsed.offer) : 'keines genannt')
                  : (parsed.litresMentioned.length ? parsed.litresMentioned.map((l) => `${num(l)} l`).join(', ') : '–')} />
            </dl>
            {parsed.matchedTankIds.length > 0 && (
              <div className="mt-2.5 border-t border-line pt-2.5">
                {parsed.broadMatch ? (
                  <div className="space-y-2">
                    <p className="text-[13px]">
                      <strong className="text-amber">Die genannte Größe passt auf {parsed.matchedTankIds.length} Positionen.</strong>{' '}
                      Alle anzuhängen setzt jede davon auf „im Kontakt“ und nimmt sie damit anderen Interessenten weg.
                    </p>
                    <label className="flex items-center gap-2 text-[13px] font-semibold">
                      <input type="checkbox" checked={attachBroad} onChange={(e) => setAttachBroad(e.target.checked)}
                        className="h-4 w-4 accent-[var(--primary)]" />
                      Trotzdem alle {parsed.matchedTankIds.length} anhängen
                    </label>
                    {!attachBroad && (
                      <p className="text-[13px] text-muted">
                        Sonst wird der Interessent ohne Positionen angelegt — du hängst die richtigen danach von Hand an.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="text-muted">Passende Positionen: </span>
                    {parsed.matchedTankIds.map((id) => {
                      const t = db.tanks.find((x) => x.id === id)!
                      return <Pill key={id} tone="green" className="mr-1.5">{t.maker === 'Sonstige' ? t.type : t.maker} {num(t.litres)} l</Pill>
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!parsed}
            onClick={() => {
              if (!parsed) return
              const leadId = addLead({
                name: parsed.name || 'Anfrage aus Käuferliste',
                phone: parsed.phone, email: parsed.email,
                source: 'kleinanzeigen', stage: tankIds.length ? 'angebot' : 'neu',
                tankIds, note: '',
              })
              // Derselbe Ort wie beim Posteingang: der Wortlaut in die
              // Nachrichtenliste, das Gelesene in die Notiz. Vorher legte
              // dieser Weg den ganzen Text in `note` und der andere in
              // `messages` — zwei Ablagen für dieselbe Nachricht.
              noteOnLead(leadId, text.trim(), ['Aus Nachricht angelegt'], false, {
                summary: 'Aus Nachricht angelegt.',
                notes: [
                  parsed.packagePrice != null ? `Genannter Paketpreis: ${eur(parsed.packagePrice)}` : '',
                  parsed.offer != null ? `Gebot in der Nachricht: ${eur(parsed.offer)}` : '',
                ].filter(Boolean),
                steps: ['Aus Nachricht angelegt'],
                fromImage: false,
              })
              // A named price is already a negotiation — record it as an offer straight away.
              if (tankIds.length > 0) {
                const picked = db.tanks.filter((t) => tankIds.includes(t.id))
                const t = totals(picked)
                // Hat die Käuferliste einen Paketpreis mitgeschickt, ist DAS unsere
                // Forderung — nicht die Summe der Einzelpreise. Sonst sähe jeder, der
                // den ausgeschriebenen Paketpreis annimmt, wie ein Preisdrücker aus.
                const askPrice = parsed.packagePrice ?? t.vb
                const quoteId = createQuote({
                  label: `Anfrage ${parsed.name || 'Käuferliste'} · ${picked.length} Positionen`,
                  tankIds,
                  askPrice,
                  leadId,
                  portalId: null,
                  note: text.trim(),
                })
                // Wer genau den geforderten Preis nennt, verhandelt nicht, er nimmt an.
                if (parsed.offer != null) {
                  patchQuote(quoteId, {
                    buyerOffer: parsed.offer,
                    status: parsed.offer >= askPrice ? 'gesendet' : 'verhandlung',
                  })
                }
              }
              onClose()
            }}>
            {parsed?.matchedTankIds.length ? 'Interessent & Angebot anlegen' : 'Interessent anlegen'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted">{label}:</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}
