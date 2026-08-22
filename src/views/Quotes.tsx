import { useState } from 'react'
import { PriceLadder } from '../components/charts'
import { LeadPicker } from '../components/LeadPicker'
import { Button, Card, EmptyState, Field, Input, Pill, SectionTitle, Select, Stat, Textarea, cx, type Tone } from '../components/ui'
import { IconHandshake, IconTrash } from '../components/icons'
import { patchQuote, quoteToDeal, removeQuote } from '../lib/actions'
import { centsPerLitre, dateDE, eur, num, todayISO } from '../lib/format'
import { useStore } from '../lib/store'
import { VERDICT_LABEL, quoteMetrics } from '../lib/stats'
import { QUOTE_STATUS_LABEL, type Quote, type QuoteStatus } from '../types'

const STATUSES: QuoteStatus[] = ['entwurf', 'gesendet', 'verhandlung', 'angenommen', 'abgelehnt']
const STATUS_TONE: Record<QuoteStatus, Tone> = {
  entwurf: 'neutral', gesendet: 'sky', verhandlung: 'amber', angenommen: 'green', abgelehnt: 'neutral',
}

export default function Quotes() {
  const { db } = useStore()
  const [filter, setFilter] = useState<QuoteStatus | ''>('')
  const [leadSel, setLeadSel] = useState('')
  const [portalSel, setPortalSel] = useState('')

  const openQuotes = db.quotes.filter((q) => q.status !== 'angenommen' && q.status !== 'abgelehnt')
  const shown = db.quotes.filter((q) => {
    if (filter && q.status !== filter) return false
    if (leadSel === '__none' ? q.leadId : leadSel && q.leadId !== leadSel) return false
    if (portalSel && q.portalId !== portalSel) return false
    return true
  })

  const openValue = openQuotes.reduce((a, q) => a + (q.buyerOffer ?? q.askPrice), 0)
  const openLitres = openQuotes.reduce(
    (a, q) => a + q.tankIds.reduce((x, id) => x + (db.tanks.find((t) => t.id === id)?.litres ?? 0), 0), 0)
  const belowFloor = openQuotes.filter((q) => quoteMetrics(db, q.tankIds, q.askPrice, q.buyerOffer).verdict === 'unter-limit')

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Offene Angebote" value={openQuotes.length} sub={`${db.quotes.length} insgesamt`} />
        <Stat label="Im Angebot" value={`${num(openLitres)} l`} sub={`${openQuotes.reduce((a, q) => a + q.tankIds.length, 0)} Tanks gebunden`} />
        <Stat label="Angebotswert" value={eur(openValue)} sub="offene Angebote, brutto" tone="green" />
        <Stat label="Unter Untergrenze" value={belowFloor.length} sub="genauer ansehen" tone={belowFloor.length ? 'rose' : undefined} />
      </section>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <SectionTitle title="Angebote" hint="Was wem zu welchem Preis angeboten wurde — und wie viel Luft noch bleibt." />
          <div className="flex flex-wrap gap-2">
            <Select value={filter} onChange={(e) => setFilter(e.target.value as QuoteStatus | '')} className="w-auto min-w-[150px]">
              <option value="">Alle Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
            </Select>
            <Select value={leadSel} onChange={(e) => setLeadSel(e.target.value)} className="w-auto min-w-[170px]">
              <option value="">Alle Interessenten</option>
              <option value="__none">ohne Interessent</option>
              {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={portalSel} onChange={(e) => setPortalSel(e.target.value)} className="w-auto min-w-[150px]">
              <option value="">Alle Portale</option>
              {db.settings.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            title={db.quotes.length === 0 ? 'Noch kein Angebot erstellt' : 'Keine Angebote mit diesem Status'}
            hint="In der Tankliste filtern (z. B. Hersteller Speidel), alle auswählen und „Angebot erstellen“ wählen. Summen, Zielpreis und Untergrenze siehst du dabei live."
          />
        </Card>
      ) : (
        <div className="space-y-3">{shown.map((q) => <QuoteCard key={q.id} quote={q} />)}</div>
      )}
    </div>
  )
}

function QuoteCard({ quote }: { quote: Quote }) {
  const { db } = useStore()
  const m = quoteMetrics(db, quote.tankIds, quote.askPrice, quote.buyerOffer)
  const lead = db.leads.find((l) => l.id === quote.leadId)
  const portal = db.settings.portals.find((p) => p.id === quote.portalId)
  const [open, setOpen] = useState(false)
  const closed = quote.status === 'angenommen' || quote.status === 'abgelehnt'

  return (
    <Card className={cx(closed && 'opacity-70')}>
      <SectionTitle
        title={quote.label}
        hint={[
          lead ? lead.name : 'kein Interessent',
          portal?.name,
          `${m.count} Tanks · ${num(m.litres)} l`,
          quote.validUntil ? `gültig bis ${dateDE(quote.validUntil)}` : null,
        ].filter(Boolean).join(' · ')}
        action={
          <div className="flex items-center gap-2">
            {m.verdict && (
              <Pill tone={m.verdict === 'unter-limit' ? 'rose' : m.verdict === 'ok' ? 'amber' : 'green'}>
                {VERDICT_LABEL[m.verdict]}
              </Pill>
            )}
            <Pill tone={STATUS_TONE[quote.status]}>{QUOTE_STATUS_LABEL[quote.status]}</Pill>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Summe Einzel-VB" value={eur(m.vb)} sub={`${num(m.litres)} l`} />
        <Figure label="Zielpreis gesamt" value={eur(m.target)} sub="angestrebt" />
        <Figure label="Untergrenze gesamt" value={eur(m.floor)} sub="nicht darunter" tone="rose" />
        <Figure
          label={quote.buyerOffer != null ? 'Käufergebot' : 'Unser Angebot'}
          value={eur(m.decisive)}
          sub={m.litres ? centsPerLitre(m.decisive, m.litres) : '–'}
          tone={m.verdict === 'unter-limit' ? 'rose' : 'green'}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between text-[13px]">
          <span className="font-semibold text-muted">Wo liegt der Preis?</span>
          <span className="tnum text-muted">
            {m.discount > 0 ? `${eur(m.discount)} unter Einzel-VB (${(m.discountPct * 100).toFixed(0)} %)` : 'auf VB-Niveau'}
          </span>
        </div>
        <PriceLadder floor={m.floor} target={m.target} vb={m.vb} offer={m.decisive} format={eur} />
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {quote.tankIds.map((id) => {
          const t = db.tanks.find((x) => x.id === id)
          if (!t) return null
          return (
            <li key={id}>
              <Pill tone={t.status === 'verkauft' ? 'neutral' : 'sky'}>
                {t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`} · {num(t.litres)} l
              </Pill>
            </li>
          )
        })}
      </ul>

      {!open ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          <Button onClick={() => setOpen(true)}>Bearbeiten</Button>
          {!closed && (
            <Button variant="primary" onClick={() => { if (confirm(`„${quote.label}“ zu ${eur(m.decisive)} als Verkauf buchen?`)) quoteToDeal(quote.id) }}>
              <IconHandshake />Als Verkauf buchen
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Unser Angebotspreis (€)">
              <Input type="number" className="tnum" value={quote.askPrice}
                onChange={(e) => patchQuote(quote.id, { askPrice: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Käufergebot (€)" hint="Was der Interessent geboten hat.">
              <Input type="number" className="tnum" value={quote.buyerOffer ?? ''} placeholder="–"
                onChange={(e) => patchQuote(quote.id, { buyerOffer: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <Select value={quote.status}
                onChange={(e) => patchQuote(quote.id, { status: e.target.value as QuoteStatus }, `Angebot ${quote.label}: ${QUOTE_STATUS_LABEL[e.target.value as QuoteStatus]}`)}>
                {STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Gültig bis">
              <Input type="date" value={quote.validUntil ?? ''} min={todayISO()}
                onChange={(e) => patchQuote(quote.id, { validUntil: e.target.value || null })} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interessent">
              <LeadPicker value={quote.leadId ?? ''} stage="angebot" onChange={(id) => patchQuote(quote.id, { leadId: id || null })} />
            </Field>
            <Field label="Anfrage über">
              <Select value={quote.portalId ?? ''} onChange={(e) => patchQuote(quote.id, { portalId: e.target.value || null })}>
                <option value="">– unbekannt –</option>
                {db.settings.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Notiz">
            <Textarea rows={2} value={quote.note} onChange={(e) => patchQuote(quote.id, { note: e.target.value })}
              placeholder="Gesprächsverlauf, Bedingungen, Abholung …" />
          </Field>

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="danger" onClick={() => { if (confirm(`Angebot „${quote.label}“ löschen?`)) removeQuote(quote.id) }}>
              <IconTrash />Löschen
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Fertig</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'green' | 'rose' }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-[11px] font-bold text-muted uppercase">{label}</div>
      <div className={cx('tnum mt-0.5 text-xl font-extrabold', tone === 'green' && 'text-primary', tone === 'rose' && 'text-rose')}>{value}</div>
      <div className="text-[13px] text-muted">{sub}</div>
    </div>
  )
}
