import { useMemo, useState } from 'react'
import { Button, Card, Field, Input, Modal, Pill, SectionTitle, Select, Textarea, Toggle, cx } from './ui'
import { IconPlus, IconTrash } from './icons'
import { patchSettings } from '../lib/actions'
import { eur, itemLabel, num } from '../lib/format'
import { nicePrice, resolveBundle } from '../lib/bundles'
import { isOpen } from '../lib/stats'
import { useStore } from '../lib/store'
import type { Bundle, DB, PriceTier, Tank } from '../types'

/**
 * Angebotspakete pflegen.
 *
 * Der Käufer sieht nur den Preis. Hier steht daneben, was das Paket gegen die
 * eigene Preisleiter bedeutet — genau die Zahl, die auf der Käuferseite nichts zu
 * suchen hat und ohne die man ein Paket schnürt, das man später bereut.
 */

const newBundle = (): Bundle => ({
  id: `paket-${Math.random().toString(36).slice(2, 8)}`,
  label: 'Neues Paket',
  blurb: '',
  ids: [],
  giftIds: [],
  discount: 0.1,
  minItems: 2,
  active: false,
})

export function BundleEditor() {
  const { db, mode } = useStore()
  const readOnly = mode === 'demo'
  const [edit, setEdit] = useState<Bundle | null>(null)

  const open = useMemo(() => db.tanks.filter(isOpen), [db.tanks])
  const stock = useMemo(
    () => new Map(open.filter((t) => t.status !== 'reserviert').map((t) => [t.id, { id: t.id, category: t.category, vb: t.vb }])),
    [open],
  )
  const byId = useMemo(() => new Map(db.tanks.map((t) => [t.id, t])), [db.tanks])

  function save(next: Bundle) {
    const list = db.settings.bundles.some((b) => b.id === next.id)
      ? db.settings.bundles.map((b) => (b.id === next.id ? next : b))
      : [...db.settings.bundles, next]
    patchSettings({ bundles: list }, `Paket gespeichert: ${next.label}`)
  }

  function remove(id: string) {
    patchSettings({ bundles: db.settings.bundles.filter((b) => b.id !== id) }, 'Paket gelöscht')
  }

  return (
    <>
      <Card>
        <SectionTitle
          title="Angebotspakete"
          hint="Erscheinen auf der Käuferliste. Verkaufte und reservierte Positionen fallen von selbst heraus, der Preis rechnet sich neu."
          action={
            <Button size="sm" disabled={readOnly} onClick={() => setEdit(newBundle())}>
              <IconPlus />Neues Paket
            </Button>
          }
        />
        {db.settings.bundles.length === 0 ? (
          <p className="text-sm text-muted">Noch keine Pakete geschnürt.</p>
        ) : (
          <ul className="space-y-2">
            {db.settings.bundles.map((b) => {
              const resolved = resolveBundle({ ...b, active: true }, stock)
              const paid = (resolved?.ids ?? []).map((id) => byId.get(id)).filter((t): t is Tank => Boolean(t))
              const gifts = (resolved?.giftIds ?? []).map((id) => byId.get(id)).filter((t): t is Tank => Boolean(t))
              // Die Untergrenze zählt für das, was bezahlt wird. Eine Zugabe hat keine
              // Untergrenze — sie wird stattdessen mit ihrem Listenwert ausgewiesen,
              // damit sichtbar bleibt, was da mitgeht.
              const floor = paid.reduce((a, t) => a + t.floor, 0)
              const target = paid.reduce((a, t) => a + t.target, 0)
              const giftValue = gifts.reduce((a, t) => a + t.vb, 0)
              const gone = b.ids.filter((id) => !stock.has(id)).length
              return (
                <li key={b.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{b.label}</span>
                        {!b.active && <Pill>ausgeblendet</Pill>}
                        {resolved == null && b.active && <Pill tone="amber">wird nicht angezeigt</Pill>}
                        {resolved != null && resolved.price < floor && <Pill tone="rose">unter Untergrenze</Pill>}
                        {resolved != null && resolved.price >= floor && resolved.price < target && <Pill tone="amber">unter Zielpreis</Pill>}
                        {resolved != null && resolved.price >= target && <Pill tone="green">über Zielpreis</Pill>}
                      </div>
                      <div className="tnum mt-1 text-[13px] text-muted">
                        {resolved
                          ? `${resolved.ids.length + resolved.giftIds.length} Positionen · ${eur(resolved.full)} einzeln · Ziel ${eur(target)} · Limit ${eur(floor)}`
                          : `${b.ids.length} Positionen — zu wenige davon noch frei (mindestens ${b.minItems})`}
                        {gone > 0 && ` · ${gone} verkauft oder reserviert`}
                        {giftValue > 0 && ` · Zugabe im Listenwert von ${eur(giftValue)}`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {resolved && (
                        <span className="text-right">
                          <span className="tnum block text-lg font-extrabold">{eur(resolved.price)}</span>
                          <span className="tnum block text-[11px] text-muted">{eur(resolved.full - resolved.price)} unter Einzelsumme</span>
                        </span>
                      )}
                      <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setEdit({ ...b })}>Ändern</Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <TierEditor db={db} readOnly={readOnly} />

      {edit && (
        <BundleModal
          bundle={edit}
          open={open}
          categories={db.settings.categories}
          onClose={() => setEdit(null)}
          onSave={(b) => { save(b); setEdit(null) }}
          onRemove={db.settings.bundles.some((b) => b.id === edit.id) ? () => { remove(edit.id); setEdit(null) } : undefined}
        />
      )}
    </>
  )
}

function BundleModal({
  bundle, open, categories, onClose, onSave, onRemove,
}: {
  bundle: Bundle
  open: Tank[]
  categories: DB['settings']['categories']
  onClose: () => void
  onSave: (b: Bundle) => void
  onRemove?: () => void
}) {
  const [draft, setDraft] = useState<Bundle>(bundle)
  const patch = (p: Partial<Bundle>) => setDraft((d) => ({ ...d, ...p }))

  const groups = useMemo(() => {
    const m = new Map<string, Tank[]>()
    for (const t of open) m.set(t.category, [...(m.get(t.category) ?? []), t])
    return [...m.entries()]
  }, [open])

  const chosen = open.filter((t) => draft.ids.includes(t.id))
  const paidSum = chosen.filter((t) => !draft.giftIds.includes(t.id)).reduce((a, t) => a + t.vb, 0)
  // Dieselbe Rundung wie beim Veröffentlichen, sonst zeigt die Vorschau einen
  // anderen Preis als die Käuferliste.
  const price = nicePrice(paidSum * (1 - draft.discount))

  function toggle(id: string) {
    patch(
      draft.ids.includes(id)
        ? { ids: draft.ids.filter((x) => x !== id), giftIds: draft.giftIds.filter((x) => x !== id) }
        : { ids: [...draft.ids, id] },
    )
  }

  return (
    <Modal open onClose={onClose} title={bundle.label === 'Neues Paket' ? 'Paket schnüren' : 'Paket ändern'} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Field label="Name">
            <Input value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
          </Field>
          <Field label="Nachlass (%)" hint="auf die bezahlten Positionen">
            <Input
              type="number" min={0} max={60} step={1} className="tnum w-28"
              value={Math.round(draft.discount * 100)}
              onChange={(e) => patch({ discount: Math.min(60, Math.max(0, Number(e.target.value) || 0)) / 100 })}
            />
          </Field>
          <Field label="Mindestens" hint="sonst ausgeblendet">
            <Input
              type="number" min={1} step={1} className="tnum w-28"
              value={draft.minItems}
              onChange={(e) => patch({ minItems: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
        </div>
        <Field label="Beschreibung" hint="Steht so auf der Käuferliste.">
          <Textarea rows={3} value={draft.blurb} onChange={(e) => patch({ blurb: e.target.value })} />
        </Field>
        <Toggle checked={draft.active} onChange={(v) => patch({ active: v })} label="Auf der Käuferliste zeigen" />

        <div className="rounded-xl bg-surface-2 p-3">
          <div className="tnum flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] text-muted">
              {chosen.length} Positionen · {eur(chosen.reduce((a, t) => a + t.vb, 0))} einzeln
              {chosen.some((t) => t.litres > 0) && ` · ${num(chosen.reduce((a, t) => a + t.litres, 0))} l`}
            </span>
            <span className="text-lg font-extrabold">{eur(price)}</span>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Ziel {eur(chosen.filter((t) => !draft.giftIds.includes(t.id)).reduce((a, t) => a + t.target, 0))} ·
            {' '}Limit {eur(chosen.filter((t) => !draft.giftIds.includes(t.id)).reduce((a, t) => a + t.floor, 0))}
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-muted">
            Positionen — ankreuzen, was dazugehört. Das Sternchen macht eine Position zur Zugabe ohne Aufpreis.
          </p>
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-line p-3">
            {groups.map(([cat, tanks]) => (
              <div key={cat}>
                <p className="mb-1 text-[11px] font-bold text-muted uppercase">{categories.find((c) => c.id === cat)?.label ?? cat}</p>
                <ul className="space-y-1">
                  {tanks.map((t) => {
                    const inBundle = draft.ids.includes(t.id)
                    const isGift = draft.giftIds.includes(t.id)
                    return (
                      <li key={t.id} className="flex items-center gap-2">
                        <label className="flex min-w-0 flex-1 items-center gap-2">
                          <input type="checkbox" checked={inBundle} onChange={() => toggle(t.id)} className="h-4 w-4 shrink-0 accent-[var(--primary)]" />
                          <span className={cx('truncate text-[13px]', !inBundle && 'text-muted')}>
                            {t.id} · {itemLabel(t)}
                          </span>
                        </label>
                        <span className="tnum shrink-0 text-[13px] text-muted">{eur(t.vb)}</span>
                        <button
                          type="button"
                          disabled={!inBundle}
                          aria-label="Als Zugabe ohne Aufpreis"
                          onClick={() => patch({ giftIds: isGift ? draft.giftIds.filter((x) => x !== t.id) : [...draft.giftIds, t.id] })}
                          className={cx(
                            'h-7 w-7 shrink-0 rounded-lg border text-sm font-bold transition disabled:opacity-30',
                            isGift ? 'border-primary bg-primary text-primary-text' : 'border-line',
                          )}
                        >
                          ★
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          {onRemove && <Button variant="danger" onClick={onRemove}><IconTrash />Löschen</Button>}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={draft.ids.length === 0} onClick={() => onSave(draft)}>Speichern</Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Die Mengenstaffel. Auf der Käuferseite steht davon nur der fertige Preis — der
 * Prozentsatz bleibt hier. Eine veröffentlichte Rabatthöhe wird sonst zur Zahl,
 * ab der jede spätere Einzelverhandlung beginnt.
 */
function TierEditor({ db, readOnly }: { db: DB; readOnly: boolean }) {
  const tiers = db.settings.tiers
  const set = (next: PriceTier[]) =>
    patchSettings({ tiers: [...next].sort((a, b) => a.category.localeCompare(b.category) || a.minCount - b.minCount) }, 'Mengenstaffel geändert')

  return (
    <Card>
      <SectionTitle
        title="Mengenstaffel"
        hint="Greift, wenn jemand mehrere Positionen einer Kategorie ankreuzt. Der Käufer sieht nur den Preis, nie den Prozentsatz."
        action={
          <Button
            size="sm"
            disabled={readOnly}
            onClick={() => set([...tiers, { category: db.settings.categories[0]?.id ?? 'tank', minCount: 2, discount: 0.05 }])}
          >
            <IconPlus />Stufe
          </Button>
        }
      />
      {tiers.length === 0 ? (
        <p className="text-sm text-muted">Keine Staffel hinterlegt — es gelten die Einzelpreise.</p>
      ) : (
        <ul className="space-y-2">
          {tiers.map((t, i) => (
            <li key={`${t.category}-${t.minCount}-${i}`} className="grid grid-cols-[1fr_5rem_5rem_auto] items-center gap-2">
              <Select
                value={t.category}
                disabled={readOnly}
                onChange={(e) => set(tiers.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
              >
                {db.settings.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
              <Input
                type="number" min={2} step={1} className="tnum" aria-label="ab Stückzahl"
                value={t.minCount}
                disabled={readOnly}
                onChange={(e) => set(tiers.map((x, j) => (j === i ? { ...x, minCount: Math.max(2, Number(e.target.value) || 2) } : x)))}
              />
              <Input
                type="number" min={0} max={60} step={1} className="tnum" aria-label="Nachlass in Prozent"
                value={Math.round(t.discount * 100)}
                disabled={readOnly}
                onChange={(e) => set(tiers.map((x, j) => (j === i ? { ...x, discount: Math.min(60, Math.max(0, Number(e.target.value) || 0)) / 100 } : x)))}
              />
              <Button size="sm" variant="ghost" disabled={readOnly} aria-label="Stufe entfernen" onClick={() => set(tiers.filter((_, j) => j !== i))}>
                <IconTrash />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[13px] text-muted">
        Ab wie vielen Stück, wie viel Prozent. Eine Kategorie ohne Stufe bekommt keinen Mengenrabatt — das ist der einzige
        Weg, eine Position wie die Exzenterschneckenpumpe aus jedem Nachlass herauszuhalten.
      </p>
    </Card>
  )
}
