import { useMemo, useRef, useState } from 'react'
import { PriceLadder, STATUS_FILL } from '../components/charts'
import { MiniPhoto, PhotoStrip } from '../components/PhotoStrip'
import { LeadPicker } from '../components/LeadPicker'
import { TagEditor } from '../components/TagEditor'
import { Button, Card, EmptyState, Field, Input, Modal, Pill, Select, Textarea, cx, type Tone } from '../components/ui'
import { IconCamera, IconCheck, IconFilter, IconPlus, IconSearch, IconTrash } from '../components/icons'
import { addTank, createDeal, createQuote, patchTank, removeTank, retypeMany, setTankOffer, setTankStatus, tagMany } from '../lib/actions'
import { itemLabel, centsPerLitre, dateDE, dims as fmtDims, eur, num, todayISO } from '../lib/format'
import { prepareImage } from '../lib/photos'
import { store, useStore } from '../lib/store'
import { VERDICT_LABEL, judgeBundle, judgeOffer, totals } from '../lib/stats'
import { STATUS_LABEL, type Category, type Maker, type Tank, type TankStatus } from '../types'
import type { ViewProps } from '../App'

const STATUSES: TankStatus[] = ['vorbereitung', 'verfuegbar', 'kontakt', 'reserviert', 'verkauft']

const STATUS_TONE: Record<TankStatus, Tone> = { verfuegbar: 'green', kontakt: 'amber', reserviert: 'sky', verkauft: 'neutral', vorbereitung: 'neutral' }

type SortKey = 'id' | 'maker' | 'type' | 'litres' | 'vb' | 'ctl' | 'status' | 'offer' | 'lead'

export default function Tanks({ focus }: ViewProps) {
  const { db } = useStore()
  // Wer wartet auf welche Position? Einmal gerechnet, an Zeile, Karte und
  // Dialog gezeigt — im Moment des Umschaltens auf „Verfügbar" ist das die
  // Information, die zählt.
  const wartende = useMemo(() => {
    const m = new Map<string, { name: string; leadId: string; at: string }[]>()
    for (const l of db.leads) {
      for (const w of l.watch ?? []) {
        const list = m.get(w.tankId) ?? []
        list.push({ name: l.name, leadId: l.id, at: w.at })
        m.set(w.tankId, list)
      }
    }
    for (const list of m.values()) list.sort((a, b) => a.at.localeCompare(b.at))
    return m
  }, [db.leads])
  // Demo edits live only in memory, so nothing needs locking down — the banner says so.
  const readOnly = false

  const [q, setQ] = useState('')
  const [catSel, setCatSel] = useState<Category[]>([])
  const [statusSel, setStatusSel] = useState<TankStatus[]>([])
  const [makerSel, setMakerSel] = useState<Maker[]>([])
  const [typeSel, setTypeSel] = useState<string[]>([])
  // Kommt der Sprung von einem Menschen, ist sein Filter schon gesetzt.
  const [leadSel, setLeadSel] = useState(focus.leadId ?? '')
  const [minL, setMinL] = useState('')
  const [maxL, setMaxL] = useState('')
  const [withOffer, setWithOffer] = useState(false)
  const [photoSel, setPhotoSel] = useState<'' | 'mit' | 'ohne'>('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'id', dir: 1 })
  const [showFilters, setShowFilters] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dealOpen, setDealOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [retypeOpen, setRetypeOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const lo = Number(minL) || 0
    const hi = Number(maxL) || Infinity
    const list = db.tanks.filter((t) => {
      if (catSel.length && !catSel.includes(t.category)) return false
      if (statusSel.length && !statusSel.includes(t.status)) return false
      if (makerSel.length && !makerSel.includes(t.maker)) return false
      if (typeSel.length && !typeSel.includes(t.type)) return false
      if (leadSel === '__none' ? t.leadId : leadSel && t.leadId !== leadSel) return false
      if (t.litres < lo || t.litres > hi) return false
      if (withOffer && !(t.offer && t.offer > 0)) return false
      if (photoSel === 'mit' && t.photos.length === 0) return false
      if (photoSel === 'ohne' && t.photos.length > 0) return false
      if (!needle) return true
      const lead = db.leads.find((l) => l.id === t.leadId)?.name ?? ''
      return [t.id, t.maker, t.type, String(t.litres), t.note, lead].some((v) => v.toLowerCase().includes(needle))
    })
    const leadName = (t: Tank) => db.leads.find((l) => l.id === t.leadId)?.name ?? ''
    const val = (t: Tank): number | string => {
      switch (sort.key) {
        case 'maker': return t.maker
        case 'type': return t.type
        case 'lead': return leadName(t) || '\uffff' // empty sorts last
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
  }, [db, q, catSel, statusSel, makerSel, typeSel, leadSel, minL, maxL, withOffer, photoSel, sort])

  const pickedTanks = db.tanks.filter((t) => picked.has(t.id))
  // "Alle auswählen" applies to what the filter currently shows, minus what is already sold.
  const selectable = rows.filter((t) => t.status !== 'verkauft')
  const allPicked = selectable.length > 0 && selectable.every((t) => picked.has(t.id))
  const pickedTotals = totals(pickedTanks)
  // With barrels in the same list, "Tanks" is only right when nothing else is shown.
  const allTypes = [...new Set(db.tanks.map((t) => t.type))].sort((a, b) => a.localeCompare(b, 'de'))
  const allMakers = [...new Set(db.tanks.map((t) => t.maker))].sort((a, b) => a.localeCompare(b, 'de'))
  const cats = db.settings.categories.filter((c) => db.tanks.some((t) => t.category === c.id))
  const kinds = new Set(rows.map((t) => t.category))
  const onlyCat = kinds.size === 1 ? db.settings.categories.find((c) => c.id === [...kinds][0]) : null
  const noun = onlyCat?.label ?? 'Positionen'
  const totalNoun = new Set(db.tanks.map((t) => t.category)).size > 1 ? 'Positionen' : noun
  const active = catSel.length + statusSel.length + makerSel.length + typeSel.length + (leadSel ? 1 : 0) + (minL ? 1 : 0) + (maxL ? 1 : 0) + (withOffer ? 1 : 0) + (photoSel ? 1 : 0)
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
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Position, Interessent, Notiz …" className="pl-9" />
          </div>
          <Button variant={showFilters || active ? 'primary' : 'default'} onClick={() => setShowFilters((v) => !v)}>
            <IconFilter />
            Filter{active > 0 && ` (${active})`}
          </Button>
          {!readOnly && (
            <Button onClick={() => setAddOpen(true)}>
              <IconPlus />
              Position
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="animate-rise space-y-3 border-t border-line bg-surface-2 p-3">
            <ChipRow label="Art" items={cats.map((c) => ({ v: c.id, l: c.label }))} sel={catSel} onToggle={(v) => toggle(catSel, v, setCatSel)} />
            <ChipRow label="Status" items={STATUSES.map((s) => ({ v: s, l: STATUS_LABEL[s] }))} sel={statusSel} onToggle={(v) => toggle(statusSel, v, setStatusSel)} />
            <ChipRow label="Hersteller" items={allMakers.map((m) => ({ v: m, l: m }))} sel={makerSel} onToggle={(v) => toggle(makerSel, v, setMakerSel)} />
            <ChipRow label="Typ" items={allTypes.map((t) => ({ v: t, l: t }))} sel={typeSel} onToggle={(v) => toggle(typeSel, v, setTypeSel)} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-[13px] font-semibold text-muted">Interessent</span>
              <Select value={leadSel} onChange={(e) => setLeadSel(e.target.value)} className="w-auto min-w-[190px] py-1.5 text-[13px]">
                <option value="">Alle</option>
                <option value="__none">ohne Interessent</option>
                {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Liter ab" className="w-28"><Input type="number" value={minL} onChange={(e) => setMinL(e.target.value)} placeholder="0" /></Field>
              <Field label="Liter bis" className="w-28"><Input type="number" value={maxL} onChange={(e) => setMaxL(e.target.value)} placeholder="∞" /></Field>
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={withOffer} onChange={(e) => setWithOffer(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                nur mit Gebot
              </label>
              {/* Finding what still needs photographing is the point — "ohne" comes first. */}
              <span className="flex min-h-11 items-center gap-1.5">
                {([['', 'Foto egal'], ['ohne', 'ohne Foto'], ['mit', 'mit Foto']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setPhotoSel(v)}
                    className={cx(
                      'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                      photoSel === v ? 'border-primary bg-primary text-primary-text' : 'border-line hover:border-line-strong',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </span>
              {active > 0 && (
                <Button variant="ghost" onClick={() => { setCatSel([]); setStatusSel([]); setMakerSel([]); setTypeSel([]); setLeadSel(''); setMinL(''); setMaxL(''); setWithOffer(false); setPhotoSel('') }}>
                  Zurücksetzen
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px]">
          <span className="flex flex-wrap items-center gap-2 text-muted">
            <span>
              <strong className="tnum text-ink">{rows.length}</strong> {noun} von {db.tanks.length} {totalNoun}
              {shown.litres > 0 && <> · <span className="tnum">{num(shown.litres)} l</span></>} · <span className="tnum">{eur(shown.vb)}</span> VB
            </span>
            {selectable.length > 0 && (
              <Button size="sm" onClick={() => setPicked(allPicked ? new Set() : new Set(selectable.map((t) => t.id)))}>
                <IconCheck />{allPicked ? 'Auswahl aufheben' : `Alle ${selectable.length} auswählen`}
              </Button>
            )}
          </span>
          {picked.size > 0 && (
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone="sky">{picked.size} ausgewählt{pickedTotals.litres > 0 && ` · ${num(pickedTotals.litres)} l`}</Pill>
              <span className="tnum">
                VB <strong>{eur(pickedTotals.vb)}</strong> · Ziel <strong>{eur(pickedTotals.target)}</strong> ·{' '}
                <span className="text-rose">Limit <strong>{eur(pickedTotals.floor)}</strong></span>
              </span>
              <Button size="sm" variant="primary" onClick={() => setQuoteOpen(true)}>Angebot erstellen</Button>
              <Button size="sm" onClick={() => setDealOpen(true)}>Als Verkauf buchen</Button>
              <Button size="sm" onClick={() => setTagOpen(true)}>Merkmal setzen</Button>
              <Button size="sm" onClick={() => setRetypeOpen(true)}>Hersteller/Typ ändern</Button>
              <Button size="sm" onClick={() => setPhotoOpen(true)}><IconCamera />Foto für alle</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Leeren</Button>
            </span>
          )}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState title="Keine Positionen gefunden" hint="Suche oder Filter anpassen." /></Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card pad={false} className="hidden overflow-hidden lg:block">
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-surface-3 text-muted">
                  <tr>
                    <th className="w-9 px-2.5 py-2">
                      <input
                        type="checkbox"
                        aria-label={allPicked ? 'Auswahl aufheben' : `Alle ${selectable.length} auswählen`}
                        checked={allPicked}
                        ref={(el) => { if (el) el.indeterminate = picked.size > 0 && !allPicked }}
                        disabled={selectable.length === 0}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.map((t) => t.id)))}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                    </th>
                    <th className="w-10 px-2.5 py-2 text-left text-[11px] font-bold tracking-wide uppercase">Foto</th>
                    {head('id', '#', 'w-16 whitespace-nowrap')}
                    {head('maker', 'Hersteller')}
                    {head('type', 'Typ')}
                    {head('litres', 'Liter', 'text-right')}
                    {head('vb', 'VB', 'text-right')}
                    {head('ctl', 'ct/l', 'text-right')}
                    {head('status', 'Status')}
                    {head('lead', 'Interessent')}
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
                        <td className="px-2.5 py-1.5">
                          {t.photos.length > 0 ? (
                            <button type="button" onClick={() => setDetail(t.id)} className="block" aria-label="Fotos ansehen">
                              <MiniPhoto path={t.photos[0]} className="h-8 w-8" />
                            </button>
                          ) : (
                            /* An empty box says "no picture here" more plainly than a blank cell. */
                            <span className="block h-8 w-8 rounded-md border border-dashed border-line-strong" title="kein Foto" />
                          )}
                        </td>
                        <td className="tnum px-2.5 py-1.5 text-xs whitespace-nowrap text-faint">{t.id}</td>
                        <td className="px-2.5 py-1.5">
                          <button type="button" onClick={() => setDetail(t.id)} className="text-left font-semibold whitespace-nowrap hover:text-primary hover:underline">
                            {t.maker}
                          </button>
                          {t.photos.length > 0 && (
                            <span className="ml-1.5 align-middle text-[11px] text-faint" title={`${t.photos.length} Foto(s)`}>◉ {t.photos.length}</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{t.type}</td>
                        <td className="tnum px-2.5 py-1.5 text-right font-bold">{t.litres > 0 ? num(t.litres) : <span className="text-faint">–</span>}</td>
                        <td className="tnum px-2.5 py-1.5 text-right">{eur(t.vb)}</td>
                        <td className="tnum px-2.5 py-1.5 text-right text-xs whitespace-nowrap text-muted">{t.litres > 0 ? centsPerLitre(t.vb, t.litres) : <span className="text-faint">–</span>}</td>
                        <td className="px-2.5 py-1.5">
                          <Select value={t.status} disabled={readOnly} onChange={(e) => setTankStatus(t, e.target.value as TankStatus)} className="min-w-[124px] py-1.5 text-[13px]">
                            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </Select>
                          {/* Im Moment des Umschaltens sichtbar, nicht erst im Dialog:
                              wer hier auf „Verfügbar" stellt, soll den Wartenden sehen. */}
                          {(wartende.get(t.id)?.length ?? 0) > 0 && (
                            <button type="button" onClick={() => setDetail(t.id)}
                              className="mt-1 block text-[11px] font-semibold text-amber hover:underline"
                              title={wartende.get(t.id)!.map((w) => w.name).join(', ')}>
                              wartet: {wartende.get(t.id)!.map((w) => w.name.split(' ')[0]).join(', ')}
                            </button>
                          )}
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
                    <button type="button" onClick={() => setDetail(t.id)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                      {t.photos.length > 0
                        ? <MiniPhoto path={t.photos[0]} className="mt-0.5 h-10 w-10 shrink-0" />
                        : <span className="mt-0.5 block h-10 w-10 shrink-0 rounded-md border border-dashed border-line-strong" />}
                      <span className="block min-w-0">
                      <div className="font-bold">{t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}</div>
                      <div className="tnum text-[13px] text-muted">{t.litres > 0 && `${num(t.litres)} l · `}{eur(t.vb)}{t.litres > 0 && ` · ${centsPerLitre(t.vb, t.litres)}`}</div>
                      </span>
                    </button>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <Pill tone={STATUS_TONE[t.status]}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_FILL[t.status] }} />
                        {STATUS_LABEL[t.status]}
                      </Pill>
                      {(wartende.get(t.id)?.length ?? 0) > 0 && (
                        <Pill tone="amber">{wartende.get(t.id)!.length} wartet</Pill>
                      )}
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
      <BulkTagModal open={tagOpen} onClose={() => setTagOpen(false)} tanks={pickedTanks} />
      <BulkPhotoModal open={photoOpen} onClose={() => setPhotoOpen(false)} tanks={pickedTanks} />
      <BulkRetypeModal
        open={retypeOpen}
        onClose={() => setRetypeOpen(false)}
        tanks={pickedTanks}
        onApplied={(r) => {
          // A filter still pointing at the old name matches nothing after the rename,
          // and an empty list under "Keine Tanks gefunden" reads like the tanks are gone.
          if (r.maker) setMakerSel((sel) => [...new Set(sel.map((m) => (r.makers.includes(m) ? r.maker : m)))])
          if (r.type) setTypeSel((sel) => [...new Set(sel.map((t) => (r.types.includes(t) ? r.type : t)))])
        }}
      />
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
  // Wer wollte Bescheid, sobald diese Position in den Verkauf geht — der
  // Reihe nach, wer zuerst gefragt hat.
  const wartend = db.leads
    .flatMap((l) => (l.watch ?? []).filter((w) => w.tankId === t.id).map((w) => ({ lead: l, at: w.at })))
    .sort((a, b) => a.at.localeCompare(b.at))

  return (
    <Modal open onClose={onClose} title={`${t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}${t.litres > 0 ? ` · ${num(t.litres)} l` : ''}`}>
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

        <DimsFields tank={t} readOnly={readOnly} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preisvorstellung (VB)"><Input type="number" disabled={readOnly} value={t.vb} onChange={(e) => patchTank(t.id, { vb: Number(e.target.value) || 0 }, `VB geändert: ${t.maker} ${t.litres} l`)} className="tnum" /></Field>
          <Field label="Aktuelles Gebot"><Input type="number" disabled={readOnly} value={t.offer ?? ''} onChange={(e) => setTankOffer(t, e.target.value === '' ? null : Number(e.target.value))} className="tnum" /></Field>
          <Field label="Zielpreis"><Input type="number" disabled={readOnly} value={t.target} onChange={(e) => patchTank(t.id, { target: Number(e.target.value) || 0 })} className="tnum" /></Field>
          <Field label="Untergrenze"><Input type="number" disabled={readOnly} value={t.floor} onChange={(e) => patchTank(t.id, { floor: Number(e.target.value) || 0 })} className="tnum" /></Field>
          <Field label="Interessent">
            <LeadPicker value={t.leadId ?? ''} stage="kontakt" onChange={(id) => patchTank(t.id, { leadId: id || null })} />
          </Field>
          <Field label="Abholung"><Input type="date" disabled={readOnly} value={t.pickup ?? ''} onChange={(e) => patchTank(t.id, { pickup: e.target.value || null })} /></Field>
        </div>

        {wartend.length > 0 && (
          <div className="rounded-xl border border-amber/40 bg-amber-soft/40 p-3 text-[13px]">
            <strong>{wartend.length === 1 ? 'Wartet auf Bescheid' : `${wartend.length} warten auf Bescheid`}, sobald die Position im Verkauf ist:</strong>
            <ul className="mt-1 space-y-0.5 text-muted">
              {wartend.map((w) => (
                <li key={w.lead.id} className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink">{w.lead.name}</span>
                  <span className="tnum text-[12px]">{dateDE(w.at)}</span>
                </li>
              ))}
            </ul>
            {t.status === 'vorbereitung'
              ? <p className="mt-1.5 text-muted">Gepflegt wird die Liste im jeweiligen Interessenten.</p>
              : <p className="mt-1.5 text-muted">Die Position ist nicht mehr in Vorbereitung — die Übersicht führt das als offene Aufgabe.</p>}
          </div>
        )}

        <TagEditor tags={t.tags} category={t.category} onChange={(tags) => patchTank(t.id, { tags })} />

        <PhotoStrip tank={t} />

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
  /*
   * Wer auf eine der Positionen wartet, ist der wahrscheinlichste Käufer — als
   * Vorschlag, nicht als Zwang. Ohne Käufer gebucht bliebe sein Bescheid-Wunsch
   * stehen und die Karte behauptete „für eine Absage", obwohl er gekauft hat.
   */
  const [leadId, setLeadId] = useState(() => {
    const ids = new Set(tanks.map((x) => x.id))
    const w = db.leads
      .flatMap((l) => (l.watch ?? []).filter((x) => ids.has(x.tankId)).map((x) => ({ leadId: l.id, at: x.at })))
      .sort((a, b) => a.at.localeCompare(b.at))[0]
    return w?.leadId ?? ''
  })
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')

  if (!open) return null
  const value = Number(price) || 0
  const label = tanks.length === 1
    ? `${tanks[0].maker} ${tanks[0].litres} l`
    : `Paket ${tanks.length} Positionen${t.litres > 0 ? ` (${num(t.litres)} l)` : ''}`

  return (
    <Modal open onClose={onClose} title="Verkauf buchen">
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="font-bold">{label}</div>
          <div className="tnum mt-1 text-muted">Summe Einzel-VB {eur(t.vb)} · Ziel {eur(t.target)} · Untergrenze {eur(t.floor)}</div>
          <ul className="mt-2 space-y-0.5 text-[13px] text-muted">
            {tanks.map((x) => <li key={x.id}>{itemLabel(x)} · {eur(x.vb)}</li>)}
          </ul>
        </div>

        <Field label="Verkaufspreis brutto gesamt" hint={value > 0 && t.litres ? `${centsPerLitre(value, t.litres)} · ${value < t.floor ? 'unter der Summe der Untergrenzen' : 'über der Summe der Untergrenzen'}` : undefined}>
          <Input type="number" min={0} step={50} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(t.target)} className="tnum text-lg font-bold" autoFocus />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Käufer">
            <LeadPicker value={leadId} stage="gewonnen" emptyLabel="– kein Interessent hinterlegt –" onChange={setLeadId} />
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
  const { db } = useStore()
  const [category, setCategory] = useState<Category>(db.settings.categories[0]?.id ?? 'tank')
  const [maker, setMaker] = useState('')
  const [type, setType] = useState('')
  const [litres, setLitres] = useState('')
  const [vb, setVb] = useState('')
  const [count, setCount] = useState('1')
  const [vorbereiten, setVorbereiten] = useState(false)

  if (!open) return null
  const cat = db.settings.categories.find((c) => c.id === category)
  const l = Number(litres) || 0
  const p = Number(vb) || 0
  const n = Math.max(1, Math.min(200, Number(count) || 1))
  const knownMakers = [...new Set(db.tanks.map((t) => t.maker))].sort((a, b) => a.localeCompare(b, 'de'))

  function submit() {
    // Several identical items at once — 12 Gitterboxen should not need 12 rounds.
    for (let i = 0; i < n; i += 1) {
      addTank({ category, maker: maker.trim() || 'Sonstige', type: type.trim() || (cat?.one ?? 'Position'), litres: l, vb: p, status: vorbereiten ? 'vorbereitung' : 'verfuegbar' })
    }
    onClose()
    setLitres(''); setVb(''); setType(''); setMaker(''); setCount('1'); setVorbereiten(false)
  }

  return (
    <Modal open onClose={onClose} title="Position hinzufügen">
      <div className="space-y-4">
        <Field label="Kategorie">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {db.settings.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hersteller" hint="frei, z. B. Speidel, Bucher, Inoxpa">
            <Input value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="Sonstige" list="bekannte-hersteller" />
            <datalist id="bekannte-hersteller">{knownMakers.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="Bezeichnung"><Input value={type} onChange={(e) => setType(e.target.value)} placeholder={cat?.one ?? 'Position'} /></Field>
          {cat?.hasVolume && (
            <Field label="Volumen (l)"><Input type="number" value={litres} onChange={(e) => setLitres(e.target.value)} className="tnum" /></Field>
          )}
          <Field label="VB brutto (€)" hint={cat?.hasVolume && l && p ? centsPerLitre(p, l) : undefined}>
            <Input type="number" value={vb} onChange={(e) => setVb(e.target.value)} className="tnum" />
          </Field>
          <Field label="Anzahl" hint={n > 1 ? `${n} gleiche Positionen anlegen` : undefined}>
            <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} className="tnum" />
          </Field>
        </div>
        {/*
          Ohne diesen Schalter führte der einzige Anlege-Weg durch „verfügbar" —
          und zwanzig Sekunden später stünde die Zukunftsmaschine über den
          Autopiloten im öffentlichen Katalog, bevor der erste Bescheid-Wunsch
          erfasst ist.
        */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3">
          <input type="checkbox" checked={vorbereiten} onChange={(e) => setVorbereiten(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span className="text-[13px] leading-relaxed">
            <strong>Noch nicht in den Verkauf</strong> — die Position bleibt „In Vorbereitung": nicht im Katalog,
            in keiner Anzeige, in keinem Paket. Interessenten lassen sich schon dafür eintragen
            („Bescheid geben, sobald im Verkauf").
          </span>
        </label>
        <p className="text-[13px] text-muted">Zielpreis und Untergrenze werden automatisch geschätzt (86 % bzw. 72 % der VB) und lassen sich danach anpassen.</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!p} onClick={submit}>
            {n > 1 ? `${n} Positionen hinzufügen` : 'Hinzufügen'}
          </Button>
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
  const label = makers.length === 1 ? `${makers[0]}-Paket · ${tanks.length} Positionen` : `Paket ${tanks.length} Positionen${t.litres > 0 ? ` (${num(t.litres)} l)` : ''}`

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
          <div className="font-bold">{tanks.length} Positionen{t.litres > 0 && ` · ${num(t.litres)} l`}</div>
          <ul className="mt-1.5 space-y-0.5 text-muted">
            {/* Die Nummer gehört nach vorn: T-17, T-18 und T-19 sind baugleich,
                und ohne sie standen hier drei zeichengleiche Zeilen. */}
            {tanks.map((x) => (
              <li key={x.id}>
                <span className="tnum font-semibold">{x.id}</span> {itemLabel(x)} · VB {eur(x.vb)} · Limit {eur(x.floor)}
              </li>
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
            <LeadPicker value={leadId} stage="angebot" onChange={setLeadId} />
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

/**
 * One picture for a whole selection. Twenty-nine barrels standing next to each
 * other are one photograph, not twenty-nine — and the file is stored once, with
 * every position pointing at it.
 */
function BulkPhotoModal({ open, onClose, tanks }: { open: boolean; onClose: () => void; tanks: Tank[] }) {
  const { mode } = useStore()
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  if (!open) return null

  const demo = mode === 'demo'

  async function take(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const prepared = await prepareImage(file)
      setPreview(`data:image/jpeg;base64,${prepared.base64}`)
      await store.addPhotoToMany(tanks.map((t) => t.id), prepared.base64)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Foto konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Ein Foto für ${tanks.length} Positionen`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Das Bild wird einmal hochgeladen und an alle ausgewählten Positionen gehängt — ein Übersichtsfoto reicht,
          jede einzeln zu fotografieren ist nicht nötig. Entfernst du es später an einer Position, bleibt es an den
          übrigen erhalten.
        </p>

        <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
          <span className="text-muted">Bekommt das Foto: </span>
          {[...new Set(tanks.map((t) => (t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`)))].slice(0, 4).join(' · ')}
          {tanks.length > 4 && ` … (${tanks.length} Positionen)`}
        </div>

        {preview && <img src={preview} alt="" className="max-h-48 w-full rounded-xl object-cover" />}

        {demo ? (
          <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
            Fotos brauchen ein eingerichtetes Daten-Repository — im Demo-Modus nicht verfügbar.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => camera.current?.click()}>
              <IconCamera />{busy ? 'Lädt hoch …' : 'Kamera'}
            </Button>
            <Button disabled={busy} onClick={() => library.current?.click()}><IconPlus />Auswählen</Button>
          </div>
        )}

        {error && <p className="text-[13px] font-semibold text-rose">{error}</p>}

        <div className="flex justify-end border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
        </div>

        <input ref={camera} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { void take(e.target.files); e.target.value = '' }} />
        <input ref={library} type="file" accept="image/*" hidden
          onChange={(e) => { void take(e.target.files); e.target.value = '' }} />
      </div>
    </Modal>
  )
}

/**
 * Outer dimensions. Round tanks are measured by diameter, everything else by
 * width and depth — offering all four fields at once invites contradictory
 * entries, so the shape decides which two are shown.
 */
function DimsFields({ tank, readOnly }: { tank: Tank; readOnly: boolean }) {
  const d = tank.dims ?? {}
  const round = d.dia != null
  const set = (patch: Partial<NonNullable<Tank['dims']>>) => {
    const next = { ...d, ...patch }
    // A field cleared back to empty should disappear, not linger as 0.
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (!next[k]) delete next[k]
    patchTank(tank.id, { dims: Object.keys(next).length ? next : null })
  }
  const field = (key: 'w' | 'd' | 'h' | 'dia', label: string) => (
    <Field label={label}>
      <Input
        type="number"
        disabled={readOnly}
        value={d[key] ?? ''}
        placeholder="–"
        className="tnum"
        onChange={(e) => set({ [key]: Number(e.target.value) || undefined })}
      />
    </Field>
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-muted">Maße in cm</span>
        <span className="flex gap-1">
          <Button size="sm" variant={round ? 'ghost' : 'primary'} disabled={readOnly}
            onClick={() => patchTank(tank.id, { dims: { w: d.w ?? d.dia, d: d.d, h: d.h } })}>
            eckig
          </Button>
          <Button size="sm" variant={round ? 'primary' : 'ghost'} disabled={readOnly}
            onClick={() => patchTank(tank.id, { dims: { dia: d.dia ?? d.w, h: d.h } })}>
            rund
          </Button>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {round ? field('dia', 'Durchmesser') : field('w', 'Breite')}
        {!round && field('d', 'Tiefe')}
        {field('h', 'Höhe')}
      </div>
      {fmtDims(tank.dims) && <p className="mt-2 text-[13px] text-muted">Steht in Anzeige und Katalog als: <strong>{fmtDims(tank.dims)}</strong></p>}
    </div>
  )
}

/**
 * Correct maker and type on a whole selection. A wrong maker is not a local typo:
 * it rides along into every ad, the public catalogue and the buyer's mail, so it
 * has to be fixable in one move rather than position by position.
 */
function BulkRetypeModal({ open, onClose, tanks, onApplied }: {
  open: boolean
  onClose: () => void
  tanks: Tank[]
  onApplied: (r: { makers: string[]; types: string[]; maker: string; type: string }) => void
}) {
  const { db } = useStore()
  const [maker, setMaker] = useState('')
  const [type, setType] = useState('')
  if (!open) return null

  const m = maker.trim()
  const t = type.trim()
  const knownMakers = [...new Set(db.tanks.map((x) => x.maker))].sort((a, b) => a.localeCompare(b, 'de'))
  const knownTypes = [...new Set(db.tanks.map((x) => x.type))].sort((a, b) => a.localeCompare(b, 'de'))
  const before = [...new Set(tanks.map((x) => (x.maker === 'Sonstige' ? x.type : `${x.maker} ${x.type}`)))]

  return (
    <Modal open onClose={onClose} title={`Hersteller/Typ für ${tanks.length} Positionen`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Ändert Hersteller und Bezeichnung auf allen ausgewählten Positionen. Ein leeres Feld bleibt unverändert —
          so lässt sich die Bezeichnung setzen, ohne den Hersteller anzufassen.
        </p>

        <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
          <span className="text-muted">Bisher: </span>
          {before.slice(0, 4).join(' · ')}
          {before.length > 4 && ` · und ${before.length - 4} weitere`}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hersteller" hint="„Sonstige“, wenn kein Typenschild vorhanden ist">
            <Input value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="unverändert" list="retype-hersteller" />
            <datalist id="retype-hersteller">{knownMakers.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <Field label="Bezeichnung">
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="unverändert" list="retype-typen" />
            <datalist id="retype-typen">{knownTypes.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        </div>

        {(m || t) && (
          <p className="rounded-xl bg-primary-soft p-3 text-[13px]">
            Wird zu: <strong>{m === 'Sonstige' || (!m && tanks[0]?.maker === 'Sonstige') ? (t || tanks[0]?.type) : `${m || tanks[0]?.maker} ${t || tanks[0]?.type}`}</strong>
            {tanks.length > 1 && ` — auf allen ${tanks.length} Positionen`}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            disabled={!m && !t}
            onClick={() => {
              // Read the old names first — after the mutation they are gone.
              const r = { makers: [...new Set(tanks.map((x) => x.maker))], types: [...new Set(tanks.map((x) => x.type))], maker: m, type: t }
              retypeMany(tanks.map((x) => x.id), m, t)
              onApplied(r)
              onClose()
            }}
          >
            Bei allen ändern
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Set one feature on everything currently selected — 21 tanks in one go. */
function BulkTagModal({ open, onClose, tanks }: { open: boolean; onClose: () => void; tanks: Tank[] }) {
  const [tag, setTag] = useState('')
  if (!open) return null

  const value = tag.trim()
  const already = value ? tanks.filter((t) => t.tags.includes(value)).length : 0
  const category = tanks[0]?.category ?? 'tank'

  return (
    <Modal open onClose={onClose} title={`Merkmal für ${tanks.length} Positionen`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Setzt oder entfernt ein Ausstattungsmerkmal auf allen ausgewählten Positionen. Der Anzeigentext übernimmt es
          automatisch, wenn es auf alle beworbenen Positionen zutrifft.
        </p>

        <TagEditor tags={value ? [value] : []} category={category} label="Merkmal" onChange={(tags) => setTag(tags[tags.length - 1] ?? '')} />

        {value && (
          <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
            {already === 0
              ? `Noch bei keiner der ${tanks.length} Positionen gesetzt.`
              : already === tanks.length
                ? `Bereits bei allen ${tanks.length} Positionen gesetzt.`
                : `Bereits bei ${already} von ${tanks.length} Positionen gesetzt.`}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" disabled={!value || already === 0} onClick={() => { tagMany(tanks.map((t) => t.id), value, false); onClose() }}>
            Entfernen
          </Button>
          <Button variant="primary" disabled={!value || already === tanks.length} onClick={() => { tagMany(tanks.map((t) => t.id), value, true); onClose() }}>
            Bei allen setzen
          </Button>
        </div>
      </div>
    </Modal>
  )
}
