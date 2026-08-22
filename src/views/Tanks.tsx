import { useMemo, useState } from 'react'
import { PriceLadder, STATUS_FILL } from '../components/charts'
import { Button, Card, EmptyState, Field, Input, Modal, Pill, Select, Textarea, cx, type Tone } from '../components/ui'
import { IconFilter, IconPlus, IconSearch, IconTrash } from '../components/icons'
import { addTank, createDeal, createQuote, patchTank, removeTank, setTankOffer, setTankStatus } from '../lib/actions'
import { centsPerLitre, eur, num, todayISO } from '../lib/format'
import { useStore } from '../lib/store'
import { VERDICT_LABEL, judgeBundle, judgeOffer, totals } from '../lib/stats'
import { CATEGORY_LABEL, STATUS_LABEL, type Category, type Maker, type Tank, type TankStatus } from '../types'

const STATUSES: TankStatus[] = ['verfuegbar', 'kontakt', 'reserviert', 'verkauft']
const MAKERS: Maker[] = ['Speidel', 'Möschle', 'Clemens', 'Sonstige']

const STATUS_TONE: Record<TankStatus, Tone> = { verfuegbar: 'green', kontakt: 'amber', reserviert: 'sky', verkauft: 'neutral' }

type SortKey = 'id' | 'litres' | 'vb' | 'ctl' | 'status' | 'offer'

export default function Tanks() {
  const { db } = useStore()
  // Demo edits live only in memory, so nothing needs locking down — the banner says so.
  const readOnly = false

  const [q, setQ] = useState('')
  const [catSel, setCatSel] = useState<Category[]>([])
  const [statusSel, setStatusSel] = useState<TankStatus[]>([])
  const [makerSel, setMakerSel] = useState<Maker[]>([])
  const [minL, setMinL] = useState('')
  const [maxL, setMaxL] = useState('')
  const [withOffer, setWithOffer] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'id', dir: 1 })
  const [showFilters, setShowFilters] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dealOpen, setDealOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const lo = Number(minL) || 0
    const hi = Number(maxL) || Infinity
    const list = db.tanks.filter((t) => {
      if (catSel.length && !catSel.includes(t.category)) return false
      if (statusSel.length && !statusSel.includes(t.status)) return false
      if (makerSel.length && !makerSel.includes(t.maker)) return false
      if (t.litres < lo || t.litres > hi) return false
      if (withOffer && !(t.offer && t.offer > 0)) return false
      if (!needle) return true
      const lead = db.leads.find((l) => l.id === t.leadId)?.name ?? ''
      return [t.id, t.maker, t.type, String(t.litres), t.note, lead].some((v) => v.toLowerCase().includes(needle))
    })
    const val = (t: Tank): number | string => {
      switch (sort.key) {
        case 'litres': return t.litres
        case 'vb': return t.vb
        case 'ctl': return t.vb / t.litres
        case 'offer': return t.offer ?? -1
        case 'status': return STATUSES.indexOf(t.status)
        default: return Number(t.id.replace(/\D/g, '')) || 0
      }
    }
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [db, q, catSel, statusSel, makerSel, minL, maxL, withOffer, sort])

  const pickedTanks = db.tanks.filter((t) => picked.has(t.id))
  // "Alle auswählen" applies to what the filter currently shows, minus what is already sold.
  const selectable = rows.filter((t) => t.status !== 'verkauft')
  const pickedTotals = totals(pickedTanks)
  // With barrels in the same list, "Tanks" is only right when nothing else is shown.
  const kinds = new Set(rows.map((t) => t.category))
  const noun = kinds.size === 1 ? (kinds.has('fass') ? 'Fässer' : 'Tanks') : 'Positionen'
  const totalNoun = db.tanks.some((t) => t.category === 'fass') ? 'Positionen' : 'Tanks'
  const active = catSel.length + statusSel.length + makerSel.length + (minL ? 1 : 0) + (maxL ? 1 : 0) + (withOffer ? 1 : 0)
  const shown = totals(rows)

  const toggle = <T,>(arr: T[], v: T, set: (a: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const head = (key: SortKey, label: string, cls = '') => (
    <th className={cx('cursor-pointer px-2.5 py-2 text-left text-[11px] font-bold tracking-wide uppercase select-none hover:text-ink', cls)}
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))}>
      {label}
      {sort.key === key && <span className="ml-1 text-primary">{sort.dir === 1 ? '▴' : '▾'}</span>}
    </th>
  )

  return (
    <div className="space-y-4">
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[200px] flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tank, Interessent, Notiz …" className="pl-9" />
          </div>
          <Button variant={showFilters || active ? 'primary' : 'default'} onClick={() => setShowFilters((v) => !v)}>
            <IconFilter />
            Filter{active > 0 && ` (${active})`}
          </Button>
          {!readOnly && (
            <Button onClick={() => setAddOpen(true)}>
              <IconPlus />
              Tank
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="animate-rise space-y-3 border-t border-line bg-surface-2 p-3">
            <ChipRow label="Art" items={(['tank', 'fass'] as Category[]).map((c) => ({ v: c, l: CATEGORY_LABEL[c] }))} sel={catSel} onToggle={(v) => toggle(catSel, v, setCatSel)} />
            <ChipRow label="Status" items={STATUSES.map((s) => ({ v: s, l: STATUS_LABEL[s] }))} sel={statusSel} onToggle={(v) => toggle(statusSel, v, setStatusSel)} />
            <ChipRow label="Hersteller" items={MAKERS.map((m) => ({ v: m, l: m }))} sel={makerSel} onToggle={(v) => toggle(makerSel, v, setMakerSel)} />
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Liter ab" className="w-28"><Input type="number" value={minL} onChange={(e) => setMinL(e.target.value)} placeholder="0" /></Field>
              <Field label="Liter bis" className="w-28"><Input type="number" value={maxL} onChange={(e) => setMaxL(e.target.value)} placeholder="∞" /></Field>
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={withOffer} onChange={(e) => setWithOffer(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                nur mit Gebot
              </label>
              {active > 0 && (
                <Button variant="ghost" onClick={() => { setCatSel([]); setStatusSel([]); setMakerSel([]); setMinL(''); setMaxL(''); setWithOffer(false) }}>
                  Zurücksetzen
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px]">
          <span className="flex flex-wrap items-center gap-2 text-muted">
            <span>
              <strong className="tnum text-ink">{rows.length}</strong> {noun} von {db.tanks.length} {totalNoun} · <span className="tnum">{num(shown.litres)} l</span> · <span className="tnum">{eur(shown.vb)}</span> VB
            </span>
            {selectable.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(selectable.map((t) => t.id)))}>
                Alle {selectable.length} auswählen
              </Button>
            )}
          </span>
          {picked.size > 0 && (
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone="sky">{picked.size} ausgewählt · {num(pickedTotals.litres)} l</Pill>
              <span className="tnum">
                VB <strong>{eur(pickedTotals.vb)}</strong> · Ziel <strong>{eur(pickedTotals.target)}</strong> ·{' '}
                <span className="text-rose">Limit <strong>{eur(pickedTotals.floor)}</strong></span>
              </span>
              <Button size="sm" variant="primary" onClick={() => setQuoteOpen(true)}>Angebot erstellen</Button>
              <Button size="sm" onClick={() => setDealOpen(true)}>Als Verkauf buchen</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Leeren</Button>
            </span>
          )}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState title="Keine Tanks gefunden" hint="Suche oder Filter anpassen." /></Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card pad={false} className="hidden overflow-hidden lg:block">
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-surface-3 text-muted">
                  <tr>
                    <th className="w-9 px-2.5 py-2" />
                    {head('id', '#', 'w-14')}
                    <th className="px-2.5 py-2 text-left text-[11px] font-bold tracking-wide uppercase">Tank</th>
                    {head('litres', 'Liter', 'text-right')}
                    {head('vb', 'VB', 'text-right')}
                    {head('ctl', 'ct/l', 'text-right')}
                    {head('status', 'Status')}
                    <th className="px-2.5 py-2 text-left text-[11px] font-bold tracking-wide uppercase">Interessent</th>
                    {head('offer', 'Gebot', 'text-right')}
                    <th className="px-2.5 py-2 text-left text-[11px] font-bold tracking-wide uppercase">Abholung</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const verdict = judgeOffer(t, t.offer)
                    const lead = db.leads.find((l) => l.id === t.leadId)
                    return (
                      <tr key={t.id} className={cx('border-t border-line transition hover:bg-surface-2', t.status === 'verkauft' && 'opacity-55')}>
                        <td className="px-2.5 py-1.5">
                          <input type="checkbox" checked={picked.has(t.id)} disabled={t.status === 'verkauft'}
                            onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(t.id) : n.delete(t.id); return n })}
                            className="h-4 w-4 accent-[var(--primary)] disabled:opacity-30" aria-label={`${t.id} auswählen`} />
                        </td>
                        <td className="tnum px-2.5 py-1.5 text-xs text-faint">{t.id}</td>
                        <td className="px-2.5 py-1.5">
                          <button type="button" onClick={() => setDetail(t.id)} className="text-left font-semibold whitespace-nowrap hover:text-primary hover:underline">
                            {t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}
                          </button>
                        </td>
                        <td className="tnum px-2.5 py-1.5 text-right font-bold">{num(t.litres)}</td>
                        <td className="tnum px-2.5 py-1.5 text-right">{eur(t.vb)}</td>
                        <td className="tnum px-2.5 py-1.5 text-right text-xs whitespace-nowrap text-muted">{centsPerLitre(t.vb, t.litres)}</td>
                        <td className="px-2.5 py-1.5">
                          <Select value={t.status} disabled={readOnly} onChange={(e) => setTankStatus(t, e.target.value as TankStatus)} className="min-w-[124px] py-1.5 text-[13px]">
                            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </Select>
                        </td>
                        <td className="px-2.5 py-1.5 text-[13px]">
                          {lead ? <button type="button" onClick={() => setDetail(t.id)} className="font-medium hover:underline">{lead.name}</button> : <span className="text-faint">–</span>}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <Input type="number" min={0} step={50} disabled={readOnly} value={t.offer ?? ''} placeholder="–"
                              onChange={(e) => setTankOffer(t, e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
                              className="tnum w-24 py-1.5 text-right text-[13px]" />
                            {verdict && <span className={cx('h-2 w-2 shrink-0 rounded-full', verdict === 'unter-limit' ? 'bg-rose' : verdict === 'ok' ? 'bg-c-kontakt' : 'bg-c-verfuegbar')} title={VERDICT_LABEL[verdict]} />}
                          </div>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <Input type="date" disabled={readOnly} value={t.pickup ?? ''} onChange={(e) => patchTank(t.id, { pickup: e.target.value || null })} className="w-[140px] py-1.5 text-[13px]" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 lg:hidden">
            {rows.map((t) => {
              const verdict = judgeOffer(t, t.offer)
              const lead = db.leads.find((l) => l.id === t.leadId)
              return (
                <Card key={t.id} className={cx('!p-3.5', t.status === 'verkauft' && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => setDetail(t.id)} className="text-left">
                      <div className="font-bold">{t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}</div>
                      <div className="tnum text-[13px] text-muted">{num(t.litres)} l · {eur(t.vb)} · {centsPerLitre(t.vb, t.litres)}</div>
                    </button>
                    <span className="flex flex-col items-end gap-1.5">
                      <Pill tone={STATUS_TONE[t.status]}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_FILL[t.status] }} />
                        {STATUS_LABEL[t.status]}
                      </Pill>
                      {t.status !== 'verkauft' && (
                        <input type="checkbox" checked={picked.has(t.id)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(t.id) : n.delete(t.id); return n })}
                          className="h-4 w-4 accent-[var(--primary)]" aria-label={`${t.id} auswählen`} />
                      )}
                    </span>
                  </div>
                  {lead && <div className="mt-2 text-[13px] text-muted">Interessent: <strong className="text-ink">{lead.name}</strong></div>}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Select value={t.status} disabled={readOnly} onChange={(e) => setTankStatus(t, e.target.value as TankStatus)} className="py-2 text-[13px]">
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </Select>
                    <div className="relative">
                      <Input type="number" min={0} step={50} disabled={readOnly} value={t.offer ?? ''} placeholder="Gebot €"
                        onChange={(e) => setTankOffer(t, e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
                        className="tnum py-2 pr-7 text-[13px]" />
                      {verdict && <span className={cx('absolute top-1/2 right-2.5 h-2 w-2 -translate-y-1/2 rounded-full', verdict === 'unter-limit' ? 'bg-rose' : verdict === 'ok' ? 'bg-c-kontakt' : 'bg-c-verfuegbar')} />}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      <TankDetail id={detail} onClose={() => setDetail(null)} readOnly={readOnly} />
      <DealModal open={dealOpen} onClose={() => { setDealOpen(false); setPicked(new Set()) }} tanks={pickedTanks} />
      <QuoteModal open={quoteOpen} onClose={() => { setQuoteOpen(false); setPicked(new Set()) }} tanks={pickedTanks} />
      <AddTankModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function ChipRow<T extends string>({ label, items, sel, onToggle }: { label: string; items: { v: T; l: string }[]; sel: T[]; onToggle: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-[13px] font-semibold text-muted">{label}</span>
      {items.map((i) => (
        <button key={i.v} type="button" onClick={() => onToggle(i.v)}
          className={cx('min-h-8 rounded-full border px-3 text-[13px] font-semibold transition',
            sel.includes(i.v) ? 'border-primary bg-primary text-primary-text' : 'border-line bg-surface hover:border-line-strong')}>
          {i.l}
        </button>
      ))}
    </div>
  )
}

function TankDetail({ id, onClose, readOnly }: { id: string | null; onClose: () => void; readOnly: boolean }) {
  const { db } = useStore()
  const t = db.tanks.find((x) => x.id === id)
  if (!t) return null
  const verdict = judgeOffer(t, t.offer)
  const lead = db.leads.find((l) => l.id === t.leadId)
  const deal = db.deals.find((d) => d.id === t.dealId)

  return (
    <Modal open onClose={onClose} title={`${t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`} · ${num(t.litres)} l`}>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          {[['Untergrenze', t.floor], ['Zielpreis', t.target], ['VB', t.vb]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-surface-2 p-3">
              <div className="text-[11px] font-bold text-muted uppercase">{l}</div>
              <div className="tnum mt-0.5 font-extrabold">{eur(v as number)}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1 text-[13px] font-semibold text-muted">Wo liegt das Gebot?</div>
          <PriceLadder floor={t.floor} target={t.target} vb={t.vb} offer={t.offer} format={eur} />
          {verdict && (
            <Pill tone={verdict === 'unter-limit' ? 'rose' : verdict === 'ok' ? 'amber' : 'green'}>{VERDICT_LABEL[verdict]}</Pill>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preisvorstellung (VB)"><Input type="number" disabled={readOnly} value={t.vb} onChange={(e) => patchTank(t.id, { vb: Number(e.target.value) || 0 }, `VB geändert: ${t.maker} ${t.litres} l`)} className="tnum" /></Field>
          <Field label="Aktuelles Gebot"><Input type="number" disabled={readOnly} value={t.offer ?? ''} onChange={(e) => setTankOffer(t, e.target.value === '' ? null : Number(e.target.value))} className="tnum" /></Field>
          <Field label="Zielpreis"><Input type="number" disabled={readOnly} value={t.target} onChange={(e) => patchTank(t.id, { target: Number(e.target.value) || 0 })} className="tnum" /></Field>
          <Field label="Untergrenze"><Input type="number" disabled={readOnly} value={t.floor} onChange={(e) => patchTank(t.id, { floor: Number(e.target.value) || 0 })} className="tnum" /></Field>
          <Field label="Interessent">
            <Select disabled={readOnly} value={t.leadId ?? ''} onChange={(e) => patchTank(t.id, { leadId: e.target.value || null })}>
              <option value="">– keiner –</option>
              {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Abholung"><Input type="date" disabled={readOnly} value={t.pickup ?? ''} onChange={(e) => patchTank(t.id, { pickup: e.target.value || null })} /></Field>
        </div>

        <Field label="Notiz">
          <Textarea rows={3} disabled={readOnly} value={t.note} onChange={(e) => patchTank(t.id, { note: e.target.value })} placeholder="Telefonat, Bedingungen, Zustand …" />
        </Field>

        {deal && <div className="rounded-xl bg-surface-2 p-3 text-sm">Teil von <strong>{deal.label}</strong> · {eur(deal.price)}{lead ? ` · ${lead.name}` : ''}</div>}

        {!readOnly && (
          <div className="flex justify-between border-t border-line pt-4">
            <Button variant="danger" onClick={() => { if (confirm(`${t.maker} ${t.litres} l wirklich löschen?`)) { removeTank(t); onClose() } }}>
              <IconTrash /> Löschen
            </Button>
            <Button variant="primary" onClick={onClose}>Fertig</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function DealModal({ open, onClose, tanks }: { open: boolean; onClose: () => void; tanks: Tank[] }) {
  const { db } = useStore()
  const t = totals(tanks)
  const [price, setPrice] = useState('')
  const [leadId, setLeadId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')

  if (!open) return null
  const value = Number(price) || 0
  const label = tanks.length === 1
    ? `${tanks[0].maker} ${tanks[0].litres} l`
    : `Paket ${tanks.length} Tanks (${num(t.litres)} l)`

  return (
    <Modal open onClose={onClose} title="Verkauf buchen">
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="font-bold">{label}</div>
          <div className="tnum mt-1 text-muted">Summe Einzel-VB {eur(t.vb)} · Ziel {eur(t.target)} · Untergrenze {eur(t.floor)}</div>
          <ul className="mt-2 space-y-0.5 text-[13px] text-muted">
            {tanks.map((x) => <li key={x.id}>{x.maker === 'Sonstige' ? x.type : `${x.maker} ${x.type}`} · {num(x.litres)} l · {eur(x.vb)}</li>)}
          </ul>
        </div>

        <Field label="Verkaufspreis brutto gesamt" hint={value > 0 && t.litres ? `${centsPerLitre(value, t.litres)} · ${value < t.floor ? 'unter der Summe der Untergrenzen' : 'über der Summe der Untergrenzen'}` : undefined}>
          <Input type="number" min={0} step={50} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(t.target)} className="tnum text-lg font-bold" autoFocus />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Käufer">
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">– kein Interessent hinterlegt –</option>
              {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Datum"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>

        <Field label="Notiz"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Zahlungsart, Abholtermin …" /></Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={value <= 0}
            onClick={() => { createDeal({ label, tankIds: tanks.map((x) => x.id), price: value, leadId: leadId || null, date, note }); onClose() }}>
            {tanks.length} Tank{tanks.length > 1 ? 's' : ''} als verkauft buchen
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AddTankModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [maker, setMaker] = useState<Maker>('Möschle')
  const [type, setType] = useState('Edelstahltank')
  const [litres, setLitres] = useState('')
  const [vb, setVb] = useState('')
  if (!open) return null
  const l = Number(litres) || 0
  const p = Number(vb) || 0

  return (
    <Modal open onClose={onClose} title="Tank hinzufügen">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hersteller">
            <Select value={maker} onChange={(e) => setMaker(e.target.value as Maker)}>
              {MAKERS.map((m) => <option key={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Typ"><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Edelstahltank" /></Field>
          <Field label="Volumen (l)"><Input type="number" value={litres} onChange={(e) => setLitres(e.target.value)} className="tnum" /></Field>
          <Field label="VB brutto (€)" hint={l && p ? centsPerLitre(p, l) : undefined}><Input type="number" value={vb} onChange={(e) => setVb(e.target.value)} className="tnum" /></Field>
        </div>
        <p className="text-[13px] text-muted">Zielpreis und Untergrenze werden automatisch geschätzt (86 % bzw. 72 % der VB) und lassen sich danach anpassen.</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!l || !p} onClick={() => { addTank({ maker, type, litres: l, vb: p }); onClose(); setLitres(''); setVb('') }}>Hinzufügen</Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The sales-call workflow: tanks are already picked, so the only open questions
 * are what to ask for them and who is asking. Every price level stays visible
 * while that number is being typed.
 */
function QuoteModal({ open, onClose, tanks }: { open: boolean; onClose: () => void; tanks: Tank[] }) {
  const { db } = useStore()
  const t = totals(tanks)
  const [ask, setAsk] = useState('')
  const [leadId, setLeadId] = useState('')
  const [portalId, setPortalId] = useState('')
  const [note, setNote] = useState('')

  if (!open) return null
  const value = Number(ask) || 0
  const verdict = judgeBundle(t, value)
  const makers = [...new Set(tanks.map((x) => x.maker))]
  const label = makers.length === 1 ? `${makers[0]}-Paket · ${tanks.length} Tanks` : `Paket ${tanks.length} Tanks (${num(t.litres)} l)`

  return (
    <Modal open onClose={onClose} title="Angebot erstellen" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {([['Untergrenze', t.floor, 'text-rose'], ['Zielpreis', t.target, 'text-amber'], ['Summe VB', t.vb, '']] as const).map(([l, v, tone]) => (
            <div key={l} className="rounded-xl bg-surface-2 p-3">
              <div className="text-[11px] font-bold text-muted uppercase">{l}</div>
              <div className={cx('tnum mt-0.5 font-extrabold', tone)}>{eur(v)}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
          <div className="font-bold">{tanks.length} Tanks · {num(t.litres)} l</div>
          <ul className="mt-1.5 space-y-0.5 text-muted">
            {tanks.map((x) => (
              <li key={x.id}>{x.maker === 'Sonstige' ? x.type : `${x.maker} ${x.type}`} · {num(x.litres)} l · VB {eur(x.vb)} · Limit {eur(x.floor)}</li>
            ))}
          </ul>
        </div>

        <Field
          label="Angebotspreis brutto gesamt"
          hint={value > 0 && t.litres ? `${centsPerLitre(value, t.litres)} · ${eur(t.vb - value)} unter Einzel-VB` : 'Leer lassen und die Vorschläge unten nutzen.'}
        >
          <Input type="number" min={0} step={50} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={String(t.target)} className="tnum text-lg font-bold" autoFocus />
        </Field>

        <div className="flex flex-wrap gap-2">
          {([['Untergrenze', t.floor], ['Zielpreis', t.target], ['Summe VB', t.vb]] as const).map(([l, v]) => (
            <Button key={l} size="sm" onClick={() => setAsk(String(v))}>{l} · {eur(v)}</Button>
          ))}
        </div>

        {value > 0 && (
          <div>
            <PriceLadder floor={t.floor} target={t.target} vb={t.vb} offer={value} format={eur} />
            {verdict && (
              <Pill tone={verdict === 'unter-limit' ? 'rose' : verdict === 'ok' ? 'amber' : 'green'}>{VERDICT_LABEL[verdict]}</Pill>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Interessent">
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">– keiner –</option>
              {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Anfrage über">
            <Select value={portalId} onChange={(e) => setPortalId(e.target.value)}>
              <option value="">– unbekannt –</option>
              {db.settings.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Notiz"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Was wurde besprochen, bis wann gilt es …" /></Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={value <= 0}
            onClick={() => { createQuote({ label, tankIds: tanks.map((x) => x.id), askPrice: value, leadId: leadId || null, portalId: portalId || null, note }); onClose() }}>
            Angebot speichern
          </Button>
        </div>
      </div>
    </Modal>
  )
}
