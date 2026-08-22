import { useState } from 'react'
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SectionTitle, Select, Textarea, cx, type Tone } from '../components/ui'
import { IconCheck, IconPlus, IconSpark, IconTrash } from '../components/icons'
import { addLead, createQuote, patchLead, patchQuote, removeLead } from '../lib/actions'
import { parseMessage } from '../lib/ads'
import { itemLabel, dateDE, eur, num, relativeDE, todayISO } from '../lib/format'
import { totals } from '../lib/stats'
import { useStore } from '../lib/store'
import { STAGE_LABEL, SOURCE_LABEL, type Lead, type LeadSource, type LeadStage } from '../types'

const STAGES: LeadStage[] = ['neu', 'kontakt', 'angebot', 'reserviert', 'gewonnen', 'verloren']
const SOURCES: LeadSource[] = ['kleinanzeigen', 'telefon', 'email', 'empfehlung', 'vorort', 'sonstige']

const STAGE_TONE: Record<LeadStage, Tone> = {
  neu: 'sky', kontakt: 'amber', angebot: 'amber', reserviert: 'sky', gewonnen: 'green', verloren: 'neutral',
}

export default function Leads() {
  const { db } = useStore()
  const readOnly = false
  const [edit, setEdit] = useState<Lead | null>(null)
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

      {edit && <LeadModal lead={edit} onClose={() => setEdit(null)} readOnly={readOnly} />}
      {creating && <LeadModal lead={null} onClose={() => setCreating(false)} readOnly={false} />}
      {parsing && <ParseModal onClose={() => setParsing(false)} />}
    </div>
  )
}

function LeadCard({ lead, onEdit, highlight }: { lead: Lead; onEdit: () => void; highlight?: boolean }) {
  const { db } = useStore()
  const tanks = lead.tankIds.map((id) => db.tanks.find((t) => t.id === id)).filter(Boolean)
  const sum = tanks.reduce((a, t) => a + (t?.vb ?? 0), 0)

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
    </button>
  )
}

function LeadModal({ lead, onClose, readOnly }: { lead: Lead | null; onClose: () => void; readOnly: boolean }) {
  const { db } = useStore()
  const [draft, setDraft] = useState<Partial<Lead>>(
    lead ?? { name: '', phone: '', email: '', location: '', source: 'kleinanzeigen', stage: 'neu', tankIds: [], note: '', lastContact: todayISO() },
  )
  const set = (patch: Partial<Lead>) => setDraft((d) => ({ ...d, ...patch }))
  const openTanks = db.tanks.filter((t) => t.status !== 'verkauft' || (draft.tankIds ?? []).includes(t.id))

  function save() {
    if (lead) patchLead(lead.id, draft, `Interessent aktualisiert: ${draft.name ?? lead.name}`)
    else addLead(draft)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={lead ? lead.name : 'Neuer Interessent'} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={draft.name ?? ''} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} autoFocus={!lead} /></Field>
          <Field label="Telefon"><Input value={draft.phone ?? ''} disabled={readOnly} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" /></Field>
          <Field label="E-Mail"><Input value={draft.email ?? ''} disabled={readOnly} onChange={(e) => set({ email: e.target.value })} inputMode="email" /></Field>
          <Field label="Ort"><Input value={draft.location ?? ''} disabled={readOnly} onChange={(e) => set({ location: e.target.value })} /></Field>
          <Field label="Quelle">
            <Select value={draft.source} disabled={readOnly} onChange={(e) => set({ source: e.target.value as LeadSource })}>
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Phase">
            <Select value={draft.stage} disabled={readOnly} onChange={(e) => set({ stage: e.target.value as LeadStage })}>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Budget (€)"><Input type="number" className="tnum" value={draft.budget ?? ''} disabled={readOnly} onChange={(e) => set({ budget: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Letzter Kontakt"><Input type="date" value={draft.lastContact ?? ''} disabled={readOnly} onChange={(e) => set({ lastContact: e.target.value || null })} /></Field>
          <Field label="Wiedervorlage" hint="Taucht auf der Übersicht auf, sobald das Datum erreicht ist.">
            <Input type="date" value={draft.nextFollowUp ?? ''} disabled={readOnly} onChange={(e) => set({ nextFollowUp: e.target.value || null })} />
          </Field>
        </div>

        <Field label="Interesse an">
          <div className="max-h-44 overflow-y-auto rounded-xl border border-line bg-surface-2 p-2">
            <div className="grid gap-1 sm:grid-cols-2">
              {openTanks.map((t) => {
                const on = (draft.tankIds ?? []).includes(t.id)
                return (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-3">
                    <input type="checkbox" checked={on} disabled={readOnly} className="h-4 w-4 accent-[var(--primary)]"
                      onChange={() => set({ tankIds: on ? (draft.tankIds ?? []).filter((x) => x !== t.id) : [...(draft.tankIds ?? []), t.id] })} />
                    <span className="truncate">{t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`} · {num(t.litres)} l</span>
                    <span className="tnum ml-auto shrink-0 text-muted">{eur(t.vb)}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </Field>

        <Field label="Notiz"><Textarea rows={3} value={draft.note ?? ''} disabled={readOnly} onChange={(e) => set({ note: e.target.value })} placeholder="Gesprächsverlauf, Preisvorstellung, Abholung …" /></Field>

        {!readOnly && (
          <div className="flex justify-between border-t border-line pt-4">
            {lead ? (
              <Button variant="danger" onClick={() => { if (confirm(`${lead.name} löschen?`)) { removeLead(lead); onClose() } }}><IconTrash />Löschen</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button onClick={onClose}>Abbrechen</Button>
              <Button variant="primary" onClick={save} disabled={!draft.name?.trim()}>Speichern</Button>
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
  const parsed = text.trim() ? parseMessage(text, db) : null
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
          Kopier die Nachricht aus Kleinanzeigen hier hinein. Name, Telefonnummer, E-Mail und der gefragte Tank werden erkannt — du prüfst nur noch nach.
        </p>
        <Textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setAttachBroad(false) }} autoFocus
          placeholder={'Hallo,\nist der Raumspar-Koffertank 1650 l noch zu haben? Ich würde ihn nächste Woche abholen.\nTel. 0176 12345678\nViele Grüße\nMax Mustermann'} />

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
                    <span className="text-muted">Passende Tanks: </span>
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
                tankIds, note: text.trim(),
              })
              // A named price is already a negotiation — record it as an offer straight away.
              if (tankIds.length > 0) {
                const picked = db.tanks.filter((t) => tankIds.includes(t.id))
                const t = totals(picked)
                const quoteId = createQuote({
                  label: `Anfrage ${parsed.name || 'Käuferliste'} · ${picked.length} Positionen`,
                  tankIds,
                  askPrice: t.vb,
                  leadId,
                  portalId: null,
                  note: text.trim(),
                })
                if (parsed.offer != null) patchQuote(quoteId, { buyerOffer: parsed.offer, status: 'verhandlung' })
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
