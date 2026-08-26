import { useMemo } from 'react'
import { RankedBars, ShareBar, STATUS_FILL, type BarRow, type Segment } from '../components/charts'
import { Card, Pill, SectionTitle, Stat, Button, Input, Field, cx } from '../components/ui'
import { IconClock, IconMegaphone, IconWarn } from '../components/icons'
import { adDrift } from '../lib/ads'
import { missingFromSeed, patchSettings } from '../lib/actions'
import { centsPerLitre, eur, num, relativeDE } from '../lib/format'
import { useStore } from '../lib/store'
import { byMaker, dueWatches, isOpen, judgeOffer, progress, totals } from '../lib/stats'
import { STATUS_LABEL, type TankStatus } from '../types'
import type { Focus, View, ViewProps } from '../App'

export default function Overview({ go }: ViewProps) {
  const { db } = useStore()
  const p = useMemo(() => progress(db), [db])
  const open = db.tanks.filter(isOpen)
  const inPackage = new Set(db.settings.categories.filter((c) => c.inPackage).map((c) => c.id))
  const openTanks = open.filter((t) => inPackage.has(t.category))
  const pkg = totals(openTanks)
  const byCat = db.settings.categories
    .map((c) => ({ cat: c, items: open.filter((t) => t.category === c.id) }))
    .filter((g) => g.items.length > 0)

  // 'vorbereitung' steht mit im Balken — unsichtbar im Verkauf, aber nicht in
  // der Arithmetik: sonst summierten die Segmente unter der Gesamtzahl.
  const statusSegments: Segment[] = (['verfuegbar', 'kontakt', 'reserviert', 'verkauft', 'vorbereitung'] as TankStatus[]).map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    value: db.tanks.filter((t) => t.status === s).length,
    fill: STATUS_FILL[s],
  }))
  const inVorbereitung = db.tanks.filter((t) => t.status === 'vorbereitung').length

  const makerRows: BarRow[] = byMaker(openTanks).map((g) => {
    const t = totals(g.tanks)
    return { key: g.maker, label: g.maker, value: t.vb, detail: `${t.count} Positionen${t.litres > 0 ? ` · ${num(t.litres)} l` : ''}` }
  })

  const openOffers = open.filter((t) => t.offer != null && t.offer > 0)
  const belowFloor = openOffers.filter((t) => judgeOffer(t, t.offer) === 'unter-limit')
  const dueFollowUps = db.leads.filter((l) => l.nextFollowUp && new Date(l.nextFollowUp) <= new Date() && l.stage !== 'gewonnen' && l.stage !== 'verloren')
  const staleAds = db.ads.filter((a) => a.status === 'online' && adDrift(db, a).stale)
  const bumpDue = db.ads.filter((a) => {
    if (a.status !== 'online' || !a.bumpedAt) return false
    const days = (Date.now() - new Date(a.bumpedAt).getTime()) / 86_400_000
    return days >= db.settings.ad.bumpAfterDays
  })

  const s = db.settings
  const pkgPerL = pkg.litres ? centsPerLitre(s.packagePrice, pkg.litres) : '–'
  const saving = pkg.vb - s.packagePrice

  /*
   * Fällige Bescheid-Wünsche, je Mensch gebündelt: zehn Karten für einen
   * Interessenten mit zehn Maschinen wären Rauschen. Der Klick springt direkt
   * in seinen Vorgang — abhaken oder Angebot erstellen erledigt den Eintrag.
   */
  const due = dueWatches(db)
  const dueByLead = [...new Map(due.map((d) => [d.lead.id, d.lead])).values()].map((lead) => {
    const mine = due.filter((d) => d.lead.id === lead.id)
    // Ist ALLES Genannte verkauft, trägt der Schluss die Aussage — die
    // Einzelmarke entfällt, sonst stünde „verkauft" zweimal im selben Satz.
    const alleWeg = mine.every((d) => d.sold)
    const namen = mine.map((d) => `${d.tank.maker === 'Sonstige' ? d.tank.type : `${d.tank.maker} ${d.tank.type}`}${d.sold && !alleWeg ? ' (verkauft — absagen?)' : ''}`)
    const schluss = alleWeg ? 'inzwischen verkauft, Absage fällig' : 'jetzt im Verkauf'
    return { lead, text: `${lead.name} wollte Bescheid: ${namen.join(', ')} — ${schluss}` }
  })

  const missing = missingFromSeed(db)
  const todos = [
    missing.length > 0 && { icon: <IconWarn />, tone: 'amber' as const, text: `${missing.length} Positionen aus dem Ausgangsbestand fehlen im Bestand`, go: 'settings' as View },
    dueFollowUps.length > 0 && { icon: <IconClock />, tone: 'amber' as const, text: `${dueFollowUps.length} Wiedervorlage${dueFollowUps.length > 1 ? 'n' : ''} fällig`, go: 'leads' as View },
    ...dueByLead.map((d) => ({ icon: <IconClock />, tone: 'amber' as const, text: d.text, go: 'leads' as View, focus: { leadId: d.lead.id }, key: `bescheid-${d.lead.id}` })),
    belowFloor.length > 0 && { icon: <IconWarn />, tone: 'rose' as const, text: `${belowFloor.length} Gebot${belowFloor.length > 1 ? 'e' : ''} unter Untergrenze`, go: 'tanks' as View },
    staleAds.length > 0 && { icon: <IconMegaphone />, tone: 'amber' as const, text: `${staleAds.length} Anzeige${staleAds.length > 1 ? 'n' : ''} nicht mehr aktuell`, go: 'ads' as View },
    bumpDue.length > 0 && { icon: <IconClock />, tone: 'sky' as const, text: `${bumpDue.length} Anzeige${bumpDue.length > 1 ? 'n' : ''} zum Hochholen`, go: 'ads' as View },
  ].filter(Boolean) as { icon: React.ReactNode; tone: 'amber' | 'rose' | 'sky'; text: string; go: View; focus?: Focus; key?: string }[]

  return (
    <div className="space-y-4">
      {todos.length > 0 && (
        <Card className="border-amber/40 bg-amber-soft/40" pad={false}>
          <ul className="divide-y divide-line">
            {/* Zwei gleichnamige Wartende ergäben denselben Text — der Key
                braucht die Identität, nicht die Beschriftung. */}
            {todos.map((t) => (
              <li key={t.key ?? t.text}>
                <button type="button" onClick={() => go(t.go, t.focus)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-surface-3">
                  <span className={cx(t.tone === 'rose' ? 'text-rose' : t.tone === 'sky' ? 'text-sky' : 'text-amber')}>{t.icon}</span>
                  {t.text}
                  <span className="ml-auto text-muted">›</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Noch da" value={p.open.count} sub={[byCat.map((g) => `${g.items.length} ${g.cat.label}`).join(' · ') || 'alles verkauft', inVorbereitung > 0 ? `+ ${inVorbereitung} in Vorbereitung` : ''].filter(Boolean).join(' · ')} />
        <Stat label="Im Kontakt" value={db.tanks.filter((t) => t.status === 'kontakt').length} sub="laufende Gespräche" />
        <Stat label="Reserviert" value={db.tanks.filter((t) => t.status === 'reserviert').length} sub="fest vorgemerkt" />
        <Stat label="Verkauft" value={p.sold.count} sub={`${num(p.sold.litres)} l abgegeben`} />
        <Stat label="Erlös" value={eur(p.revenue)} sub="brutto bisher" tone="green" />
        <Stat label="Offene Gebote" value={eur(openOffers.reduce((a, t) => a + (t.offer ?? 0), 0))} sub={`${openOffers.length} Positionen mit Gebot`} tone={openOffers.length ? 'amber' : undefined} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {/*
            Über ALLES, nicht über den Verkauf: die Segmente führen auch die
            Vorbereitung, `progress` rechnet ohne sie — mit p.all summierten
            die Balkenanteile über 100 % und die Legende widersprach dem Hint.
          */}
          <SectionTitle title="Bestand nach Status" hint={`${db.tanks.length} Positionen insgesamt${totals(db.tanks).litres > 0 ? ` · ${num(totals(db.tanks).litres)} l` : ''}`} />
          <ShareBar segments={statusSegments} total={db.tanks.length} unit="" />

          <div className="mt-6 border-t border-line pt-5">
            <SectionTitle title="Offener Warenwert nach Hersteller" hint="Summe der Einzel-VB, nur noch verfügbare Positionen" />
            {makerRows.length > 0 ? <RankedBars rows={makerRows} format={eur} /> : <p className="text-sm text-muted">Alles verkauft.</p>}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Verkaufsfortschritt" />
          <div className="space-y-3 text-sm">
            <Row label="Ursprünglich" value={`${p.all.count} Positionen · ${num(p.all.litres)} l`} />
            <Row label="Verkauft" value={`${p.sold.count} Positionen · ${num(p.sold.litres)} l`} />
            <Row label="Erlös brutto" value={eur(p.revenue)} strong />
            <div className="pt-1">
              <div className="mb-1.5 flex justify-between text-xs font-semibold text-muted">
                <span>Volumen abverkauft</span>
                <span className="tnum">{(p.litresPct * 100).toFixed(0)} %</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-c-track">
                <div className="h-full rounded-full" style={{ width: `${Math.max(p.litresPct * 100, 1)}%`, background: 'var(--c-series)' }} />
              </div>
            </div>
            <div className="border-t border-line pt-3">
              <Row label="Noch vorhanden" value={`${p.open.count} Positionen · ${num(p.open.litres)} l`} />
              <Row label="Summe Einzel-VB" value={eur(p.open.vb)} strong />
              <Row label="Summe Zielpreise" value={eur(p.open.target)} />
              <Row label="Summe Untergrenzen" value={eur(p.open.floor)} />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Komplettpaket"
          hint={`Rechnet nur mit Kategorien, die als Paketbestandteil markiert sind (${db.settings.categories.filter((c) => c.inPackage).map((c) => c.label).join(', ') || 'keine'}).`}
          action={<Pill tone={s.packagePrice >= s.packageFloor ? 'green' : 'rose'}>{s.packagePrice >= s.packageFloor ? 'über Untergrenze' : 'unter Untergrenze'}</Pill>}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs font-semibold text-muted uppercase">Im Paket</div>
            <div className="tnum mt-1 text-xl font-extrabold">{pkg.count} Positionen</div>
            <div className="text-[13px] text-muted">{num(pkg.litres)} l</div>
          </div>
          <Field label="Paketpreis brutto (VB)">
            <Input
              type="number"
              min={0}
              step={100}
              value={s.packagePrice}
              onChange={(e) => patchSettings({ packagePrice: Math.max(0, Number(e.target.value) || 0) }, 'Paketpreis angepasst')}
              className="tnum font-bold"
            />
          </Field>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs font-semibold text-muted uppercase">Preis je Liter</div>
            <div className="tnum mt-1 text-xl font-extrabold">{pkgPerL}</div>
            <div className="text-[13px] text-muted">Ziel {eur(s.packageTarget)} · Limit {eur(s.packageFloor)}</div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs font-semibold text-muted uppercase">Nachlass ggü. Einzel-VB</div>
            <div className={cx('tnum mt-1 text-xl font-extrabold', saving > 0 ? 'text-primary' : 'text-rose')}>{eur(saving)}</div>
            <div className="text-[13px] text-muted">{pkg.vb ? `${((saving / pkg.vb) * 100).toFixed(0)} % unter Summe` : '–'}</div>
          </div>
        </div>
      </Card>

      {db.activity.length > 0 && (
        <Card>
          <SectionTitle title="Zuletzt passiert" action={<Button size="sm" variant="ghost" onClick={() => go('settings')}>Alles ansehen</Button>} />
          <ul className="space-y-2">
            {db.activity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span>{a.text}</span>
                <span className="shrink-0 text-xs text-faint">{relativeDE(a.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{label}</span>
      <span className={cx('tnum', strong ? 'font-extrabold' : 'font-semibold')}>{value}</span>
    </div>
  )
}
