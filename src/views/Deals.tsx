import { useState } from 'react'
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SectionTitle, Select, Textarea, Toggle, cx } from '../components/ui'
import { IconPlus, IconTrash } from '../components/icons'
import { addLead, assignDealLead, patchDeal, removeDeal } from '../lib/actions'
import { centsPerLitre, dateDE, eur, num } from '../lib/format'
import { useStore } from '../lib/store'
import { progress } from '../lib/stats'

export default function Deals() {
  const { db } = useStore()
  const readOnly = false
  // Deal id we are creating a brand-new buyer for.
  const [newBuyerFor, setNewBuyerFor] = useState<string | null>(null)
  const p = progress(db)
  const openMoney = db.deals.filter((d) => !d.paid).reduce((a, d) => a + d.price, 0)
  const toCollect = db.deals.filter((d) => !d.pickedUp)

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="!p-3.5">
          <div className="text-[12px] font-semibold text-muted uppercase">Verkäufe</div>
          <div className="tnum mt-1 text-2xl font-extrabold">{db.deals.length}</div>
        </Card>
        <Card className="!p-3.5">
          <div className="text-[12px] font-semibold text-muted uppercase">Erlös brutto</div>
          <div className="tnum mt-1 text-2xl font-extrabold text-primary">{eur(p.revenue)}</div>
        </Card>
        <Card className="!p-3.5">
          <div className="text-[12px] font-semibold text-muted uppercase">Offen (unbezahlt)</div>
          <div className={cx('tnum mt-1 text-2xl font-extrabold', openMoney > 0 && 'text-amber')}>{eur(openMoney)}</div>
        </Card>
        <Card className="!p-3.5">
          <div className="text-[12px] font-semibold text-muted uppercase">Noch abzuholen</div>
          <div className={cx('tnum mt-1 text-2xl font-extrabold', toCollect.length > 0 && 'text-amber')}>{toCollect.length}</div>
        </Card>
      </section>

      {db.deals.length === 0 ? (
        <Card>
          <EmptyState title="Noch keine Verkäufe gebucht" hint="In der Tankliste mehrere Tanks anhaken und „Als Verkauf buchen“ wählen — auch für Paketverkäufe." />
        </Card>
      ) : (
        <div className="space-y-3">
          {db.deals.map((d) => {
            const tanks = d.tankIds.map((id) => db.tanks.find((t) => t.id === id)).filter(Boolean)
            const litres = tanks.reduce((a, t) => a + (t?.litres ?? 0), 0)
            const listPrice = tanks.reduce((a, t) => a + (t?.vb ?? 0), 0)
            const lead = db.leads.find((l) => l.id === d.leadId)
            return (
              <Card key={d.id}>
                <SectionTitle
                  title={d.label}
                  hint={`${dateDE(d.date)}${lead ? ` · ${lead.name}` : ''} · ${tanks.length} Tank${tanks.length > 1 ? 's' : ''} · ${num(litres)} l`}
                  action={
                    <div className="flex items-center gap-2">
                      <Pill tone={d.paid ? 'green' : 'amber'}>{d.paid ? 'bezahlt' : 'offen'}</Pill>
                      <Pill tone={d.pickedUp ? 'green' : 'sky'}>{d.pickedUp ? 'abgeholt' : 'Abholung offen'}</Pill>
                    </div>
                  }
                />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-surface-2 p-3">
                    <div className="text-[11px] font-bold text-muted uppercase">Verkaufspreis</div>
                    <div className="tnum mt-0.5 text-xl font-extrabold text-primary">{eur(d.price)}</div>
                    <div className="text-[13px] text-muted">{litres ? centsPerLitre(d.price, litres) : '–'}</div>
                  </div>
                  <div className="rounded-xl bg-surface-2 p-3">
                    <div className="text-[11px] font-bold text-muted uppercase">Summe Einzel-VB</div>
                    <div className="tnum mt-0.5 text-xl font-extrabold">{eur(listPrice)}</div>
                    <div className="text-[13px] text-muted">{listPrice ? `${(((listPrice - d.price) / listPrice) * 100).toFixed(0)} % Nachlass` : '–'}</div>
                  </div>
                  <div className="flex flex-col justify-center gap-2.5 rounded-xl bg-surface-2 p-3">
                    <Toggle checked={d.paid} label="Bezahlt" onChange={(v) => !readOnly && patchDeal(d.id, { paid: v }, `${d.label}: ${v ? 'bezahlt' : 'Zahlung offen'}`)} />
                    <Toggle checked={d.pickedUp} label="Abgeholt" onChange={(v) => !readOnly && patchDeal(d.id, { pickedUp: v }, `${d.label}: ${v ? 'abgeholt' : 'Abholung offen'}`)} />
                  </div>
                </div>

                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {tanks.map((t) => (
                    <li key={t!.id}>
                      <Pill tone="neutral">{t!.maker === 'Sonstige' ? t!.type : `${t!.maker} ${t!.type}`} · {num(t!.litres)} l</Pill>
                    </li>
                  ))}
                </ul>

                {!readOnly && (
                  <div className="mt-3 space-y-3 border-t border-line pt-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
                      <Field label="Käufer" hint={db.leads.length === 0 ? 'Noch keine Interessenten — „Neu“ legt direkt einen an.' : undefined}>
                        <div className="flex gap-2">
                          <Select value={d.leadId ?? ''} onChange={(e) => assignDealLead(d.id, e.target.value || null)} className="min-w-0 flex-1">
                            <option value="">– kein Käufer hinterlegt –</option>
                            {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </Select>
                          <Button onClick={() => setNewBuyerFor(d.id)} className="shrink-0"><IconPlus />Neu</Button>
                        </div>
                      </Field>
                      <Field label="Preis korrigieren">
                        <Input type="number" className="tnum" value={d.price} onChange={(e) => patchDeal(d.id, { price: Number(e.target.value) || 0 })} />
                      </Field>
                      <div className="flex items-end">
                        <Button variant="danger" className="mb-0.5"
                          onClick={() => { if (confirm(`„${d.label}“ zurücknehmen? Die Tanks werden wieder als verfügbar geführt.`)) removeDeal(d.id) }}>
                          <IconTrash />
                        </Button>
                      </div>
                    </div>
                    <Field label="Notiz">
                      <Textarea rows={2} value={d.note} onChange={(e) => patchDeal(d.id, { note: e.target.value })} placeholder="Zahlungsart, Abholtermin, Kontaktdaten …" />
                    </Field>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {newBuyerFor && <NewBuyerModal dealId={newBuyerFor} onClose={() => setNewBuyerFor(null)} />}
    </div>
  )
}

/** Record who bought something after the fact, without a detour via Interessenten. */
function NewBuyerModal({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  function save() {
    const id = addLead({ name: name.trim(), phone, source: 'sonstige', stage: 'gewonnen' })
    assignDealLead(dealId, id)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Käufer anlegen">
      <div className="space-y-4">
        <p className="text-sm text-muted">Wird als Interessent angelegt, direkt auf „Gewonnen“ gesetzt und diesem Verkauf zugeordnet.</p>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Name oder Firma" /></Field>
        <Field label="Telefon (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>Anlegen &amp; zuordnen</Button>
        </div>
      </div>
    </Modal>
  )
}
