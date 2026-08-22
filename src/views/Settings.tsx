import { useRef, useState } from 'react'
import { Button, Card, Field, Input, Modal, Pill, SectionTitle, Select, Textarea, cx } from '../components/ui'
import { IconCheck, IconCloud, IconDownload, IconLock, IconPlus, IconRefresh, IconTrash, IconUpload, IconWarn } from '../components/icons'
import { patchSettings, removeCategory, removePortal, upsertCategory, upsertPortal } from '../lib/actions'
import { exportCsv, exportJson, exportXlsx, importXlsx } from '../lib/exporter'
import { dateTimeDE, relativeDE } from '../lib/format'
import { store, useStore } from '../lib/store'
import { clearVault, forgetDevice, rememberedUntil } from '../lib/vault'
import { STYLE_LABEL, type CategoryDef, type DB, type Portal, type PortalStyle } from '../types'

export default function Settings() {
  const { db, config, mode, login, repoPrivate, lastSyncAt, sync, error } = useStore()
  const readOnly = mode === 'demo'
  const [cfg, setCfg] = useState(config)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [editPortal, setEditPortal] = useState<Portal | null>(null)
  const [editCat, setEditCat] = useState<CategoryDef | null>(null)
  const remembered = rememberedUntil()
  const xlsxRef = useRef<HTMLInputElement>(null)
  const jsonRef = useRef<HTMLInputElement>(null)

  const s = db.settings
  const dirty = JSON.stringify(cfg) !== JSON.stringify(config)

  async function onImportXlsx(file: File) {
    setBusy('import')
    try {
      const { tanks, warnings } = await importXlsx(file)
      if (!confirm(`${tanks.length} Tanks gefunden. Der aktuelle Bestand wird ersetzt — Interessenten und Verkäufe bleiben erhalten. Fortfahren?`)) return
      store.mutate((draft) => { draft.tanks = tanks }, { kind: 'settings', text: `Bestand importiert (${tanks.length} Tanks)` })
      setNote([`${tanks.length} Tanks importiert.`, ...warnings].join(' '))
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Import fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }

  async function onImportJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as DB
      if (!Array.isArray(parsed.tanks)) throw new Error('Kein gültiges Backup.')
      if (!confirm('Backup einspielen? Alle aktuellen Daten werden ersetzt.')) return
      store.replaceAll(parsed, 'Backup eingespielt')
      setNote('Backup eingespielt.')
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Backup konnte nicht gelesen werden.')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="Datenspeicher"
          hint="Deine Daten liegen als eine JSON-Datei in einem privaten GitHub-Repository. Jede Änderung ist ein Commit — damit hast du automatisch eine vollständige Historie."
          action={
            <Pill tone={mode === 'demo' ? 'neutral' : sync === 'error' ? 'rose' : 'green'}>
              {mode === 'demo' ? 'Demo — nichts wird gespeichert' : login ? `angemeldet als ${login}` : 'verbunden'}
            </Pill>
          }
        />

        {mode !== 'demo' && repoPrivate === false && (
          <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-rose/50 bg-rose-soft p-3 text-sm">
            <IconWarn className="mt-0.5 shrink-0 text-rose" />
            <span>
              <strong>Achtung: dieses Repository ist öffentlich.</strong> Namen und Telefonnummern deiner Interessenten wären
              damit für jeden im Internet lesbar. Leg ein <em>privates</em> Repository an und trag es hier ein.
            </span>
          </div>
        )}

        {error && <div className="mb-3 rounded-xl border border-rose/40 bg-rose-soft p-3 text-sm text-rose">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GitHub-Benutzer"><Input value={cfg.owner} onChange={(e) => setCfg({ ...cfg, owner: e.target.value.trim() })} placeholder="hannespix" /></Field>
          <Field label="Repository" hint="privat!"><Input value={cfg.repo} onChange={(e) => setCfg({ ...cfg, repo: e.target.value.trim() })} placeholder="tankverkauf-data" /></Field>
          <Field label="Branch"><Input value={cfg.branch} onChange={(e) => setCfg({ ...cfg, branch: e.target.value.trim() })} placeholder="main" /></Field>
          <Field label="Datei"><Input value={cfg.path} onChange={(e) => setCfg({ ...cfg, path: e.target.value.trim() })} placeholder="db.json" /></Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!dirty || readOnly} onClick={() => void store.updateConfig(cfg)}><IconCloud />Speichern & verbinden</Button>
          <Button disabled={readOnly} onClick={() => void store.connect()}><IconRefresh />Jetzt neu laden</Button>
          <Button onClick={() => { store.lock(); location.reload() }}>
            <IconLock />Sperren
          </Button>
          <Button variant="danger" onClick={() => { if (confirm('Zugang auf diesem Gerät entfernen? Die Daten auf GitHub bleiben unverändert.')) { clearVault(); store.lock(); location.reload() } }}>
            Zugang entfernen
          </Button>
          <span className="ml-auto text-[13px] text-muted">
            {lastSyncAt ? <>zuletzt synchronisiert {relativeDE(lastSyncAt)} · {dateTimeDE(lastSyncAt)}</> : 'noch nicht synchronisiert'}
          </span>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Anmeldung auf diesem Gerät" />
        {remembered ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary-soft p-3 text-sm">
            <span>
              <strong className="text-primary">Angemeldet — keine PIN nötig.</strong>{' '}
              <span className="text-muted">Gilt bis {dateTimeDE(remembered.toISOString())}.</span>
            </span>
            <Button size="sm" onClick={() => { forgetDevice(); setNote('Dieses Gerät fragt beim nächsten Öffnen wieder nach der PIN.') }}>
              Nicht mehr merken
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Dieses Gerät fragt beim Öffnen nach der PIN. Beim nächsten Entsperren lässt sich „Angemeldet bleiben" ankreuzen.
          </p>
        )}
        <p className="mt-2 text-xs text-faint">
          Der Token wird dabei mit einem Schlüssel verschlüsselt, den der Browser zwar benutzen, aber nicht herausgeben kann.
          Das ist bequem, ersetzt aber keine PIN — auf fremden oder geteilten Geräten besser nicht aktivieren.
        </p>
      </Card>

      <Card>
        <SectionTitle title="Verkäufer & Standort" hint="Fließt in jeden erzeugten Anzeigentext ein." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name / Betrieb"><Input value={s.seller.name} disabled={readOnly} onChange={(e) => patchSettings({ seller: { ...s.seller, name: e.target.value } })} /></Field>
          <Field label="Ort"><Input value={s.seller.location} disabled={readOnly} onChange={(e) => patchSettings({ seller: { ...s.seller, location: e.target.value } })} placeholder="z. B. Ihringen" /></Field>
          <Field label="PLZ"><Input value={s.seller.plz} disabled={readOnly} onChange={(e) => patchSettings({ seller: { ...s.seller, plz: e.target.value } })} placeholder="79241" /></Field>
          <Field label="Kontakt (optional)"><Input value={s.seller.contact} disabled={readOnly} onChange={(e) => patchSettings({ seller: { ...s.seller, contact: e.target.value } })} placeholder="Telefonnummer für Rückfragen" /></Field>
        </div>
        <Field label="Hinweis zu Besichtigung & Abholung" className="mt-3">
          <Textarea rows={2} value={s.seller.pickupInfo} disabled={readOnly} onChange={(e) => patchSettings({ seller: { ...s.seller, pickupInfo: e.target.value } })} />
        </Field>
      </Card>

      <Card>
        <SectionTitle title="Preise & Anzeigen" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="MwSt.-Satz" hint="0,19 = 19 %">
            <Input type="number" step={0.01} className="tnum" value={s.vatRate} disabled={readOnly} onChange={(e) => patchSettings({ vatRate: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Paket-Zielabschluss (€)">
            <Input type="number" className="tnum" value={s.packageTarget} disabled={readOnly} onChange={(e) => patchSettings({ packageTarget: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Paket-Untergrenze (€)">
            <Input type="number" className="tnum" value={s.packageFloor} disabled={readOnly} onChange={(e) => patchSettings({ packageFloor: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Schlusszeile der Anzeigen">
            <Input value={s.ad.signature} disabled={readOnly} onChange={(e) => patchSettings({ ad: { ...s.ad, signature: e.target.value } })} />
          </Field>
          <Field label="Erinnerung zum Hochholen" hint="nach x Tagen">
            <Input type="number" min={1} className="tnum w-32" value={s.ad.bumpAfterDays} disabled={readOnly} onChange={(e) => patchSettings({ ad: { ...s.ad, bumpAfterDays: Math.max(1, Number(e.target.value) || 7) } })} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Kategorien"
          hint="Bestimmt, wie sich der Bestand gliedert und was ins Komplettpaket zählt."
          action={<Button onClick={() => setEditCat({ id: '', label: '', one: '', hasVolume: false, inPackage: false })}><IconPlus />Kategorie</Button>}
        />
        <div className="space-y-2">
          {s.categories.map((c) => {
            const used = db.tanks.filter((t) => t.category === c.id).length
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{c.label}</span>
                    <Pill tone="neutral">{used} Positionen</Pill>
                    {c.inPackage && <Pill tone="green">im Komplettpaket</Pill>}
                    {c.hasVolume && <Pill tone="sky">mit Volumen</Pill>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setEditCat(c)}>Bearbeiten</Button>
                  <Button size="sm" variant="danger" onClick={() => { const err = removeCategory(c.id); if (err) setNote(err) }}>
                    <IconTrash />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Portale"
          hint="Bestimmt Zeichengrenzen, Zielseite und Tonlage der erzeugten Anzeigentexte."
          action={<Button onClick={() => setEditPortal({ id: '', name: '', postUrl: '', titleLimit: 80, bodyLimit: 4000, style: 'privat', notes: '', active: true })}><IconPlus />Portal</Button>}
        />
        <div className="space-y-2">
          {s.portals.map((portal) => (
            <div key={portal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{portal.name}</span>
                  <Pill tone={portal.style === 'fach' ? 'sky' : 'neutral'}>{portal.style === 'fach' ? 'Fachportal' : 'Privatmarkt'}</Pill>
                  <Pill tone="neutral">{db.ads.filter((a) => a.portalId === portal.id).length} Anzeigen</Pill>
                </div>
                <div className="tnum mt-0.5 text-[13px] text-muted">
                  Titel max. {portal.titleLimit} · Text max. {portal.bodyLimit} Zeichen
                </div>
                {portal.notes && <div className="mt-0.5 text-xs text-faint">{portal.notes}</div>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setEditPortal(portal)}>Bearbeiten</Button>
                <Button size="sm" variant="danger"
                  onClick={() => { if (confirm(`Portal „${portal.name}" entfernen? Bestehende Anzeigen bleiben erhalten.`)) removePortal(portal.id) }}>
                  <IconTrash />
                </Button>
              </div>
            </div>
          ))}
          {s.portals.length === 0 && <p className="text-sm text-muted">Keine Portale angelegt.</p>}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Export & Import" hint="Excel für die Ablage, JSON als vollständiges Backup." />
        {note && <div className="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">{note}</div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void exportXlsx(db)}><IconDownload />Excel exportieren</Button>
          <Button onClick={() => exportCsv(db)}><IconDownload />CSV</Button>
          <Button onClick={() => exportJson(db)}><IconDownload />Backup (JSON)</Button>
          <span className="w-px self-stretch bg-line" />
          <Button disabled={readOnly || busy === 'import'} onClick={() => xlsxRef.current?.click()}><IconUpload />Preisliste importieren</Button>
          <Button disabled={readOnly} onClick={() => jsonRef.current?.click()}><IconUpload />Backup einspielen</Button>
        </div>
        <input ref={xlsxRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportXlsx(f); e.target.value = '' }} />
        <input ref={jsonRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportJson(f); e.target.value = '' }} />
      </Card>

      <Card>
        <SectionTitle title="Verlauf" hint={`${db.activity.length} Einträge · die vollständige Historie liegt zusätzlich als Commit-Log auf GitHub.`} />
        {db.activity.length === 0 ? (
          <p className="text-sm text-muted">Noch nichts passiert.</p>
        ) : (
          <ul className="max-h-96 space-y-1.5 overflow-y-auto">
            {db.activity.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-sm last:border-0">
                <span className="flex items-center gap-2">
                  <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full',
                    a.kind === 'deal' ? 'bg-c-verfuegbar' : a.kind === 'ad' ? 'bg-c-kontakt' : a.kind === 'lead' ? 'bg-c-reserviert' : 'bg-line-strong')} />
                  {a.text}
                </span>
                <span className="shrink-0 text-xs text-faint">{dateTimeDE(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sync === 'saved' && (
        <p className="flex items-center justify-center gap-1.5 text-sm text-primary"><IconCheck />Alles gespeichert</p>
      )}

      {editPortal && <PortalModal portal={editPortal} onClose={() => setEditPortal(null)} />}
      {editCat && <CategoryModal cat={editCat} onClose={() => setEditCat(null)} />}
    </div>
  )
}

function PortalModal({ portal, onClose }: { portal: Portal; onClose: () => void }) {
  const [draft, setDraft] = useState<Portal>(portal)
  const set = (patch: Partial<Portal>) => setDraft((d) => ({ ...d, ...patch }))
  const isNew = portal.id === ''
  // A stable id keeps existing ads pointing at the right portal, so derive it once.
  const id = isNew ? draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : draft.id

  return (
    <Modal open onClose={onClose} title={isNew ? 'Portal hinzufügen' : draft.name}>
      <div className="space-y-4">
        <Field label="Name"><Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Winzer-Service.de" autoFocus /></Field>
        <Field label="Seite zum Anzeigen-Aufgeben">
          <Input value={draft.postUrl} onChange={(e) => set({ postUrl: e.target.value })} placeholder="https://…" inputMode="url" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titel max. Zeichen"><Input type="number" min={10} className="tnum" value={draft.titleLimit} onChange={(e) => set({ titleLimit: Math.max(10, Number(e.target.value) || 65) })} /></Field>
          <Field label="Text max. Zeichen"><Input type="number" min={100} className="tnum" value={draft.bodyLimit} onChange={(e) => set({ bodyLimit: Math.max(100, Number(e.target.value) || 4000) })} /></Field>
        </div>
        <Field label="Tonlage" hint="Fachportale bekommen Branchensprache und den Netto-/MwSt.-Hinweis.">
          <Select value={draft.style} onChange={(e) => set({ style: e.target.value as PortalStyle })}>
            {(['privat', 'fach'] as PortalStyle[]).map((v) => <option key={v} value={v}>{STYLE_LABEL[v]}</option>)}
          </Select>
        </Field>
        <Field label="Notiz" hint="Kosten, passende Kategorie, Besonderheiten.">
          <Textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!draft.name.trim() || !id}
            onClick={() => { upsertPortal({ ...draft, id }); onClose() }}>
            Speichern
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function CategoryModal({ cat, onClose }: { cat: CategoryDef; onClose: () => void }) {
  const [draft, setDraft] = useState<CategoryDef>(cat)
  const set = (patch: Partial<CategoryDef>) => setDraft((d) => ({ ...d, ...patch }))
  const isNew = cat.id === ''
  const id = isNew ? draft.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : draft.id

  return (
    <Modal open onClose={onClose} title={isNew ? 'Kategorie hinzufügen' : draft.label}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bezeichnung (Mehrzahl)"><Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="z. B. Maschinen" autoFocus /></Field>
          <Field label="Einzahl"><Input value={draft.one} onChange={(e) => set({ one: e.target.value })} placeholder="z. B. Maschine" /></Field>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <input type="checkbox" checked={draft.hasVolume} onChange={(e) => set({ hasVolume: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span>
            <span className="block font-semibold text-ink">Positionen haben ein Volumen</span>
            <span className="block text-muted">Für Tanks und Fässer sinnvoll, für Pumpen oder Armaturen nicht.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <input type="checkbox" checked={draft.inPackage} onChange={(e) => set({ inPackage: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span>
            <span className="block font-semibold text-ink">Zählt zum Komplettpaket</span>
            <span className="block text-muted">Nur angehakte Kategorien fließen in Paketpreis und Preis je Liter ein.</span>
          </span>
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!draft.label.trim() || !id}
            onClick={() => { upsertCategory({ ...draft, id, one: draft.one.trim() || draft.label }); onClose() }}>
            Speichern
          </Button>
        </div>
      </div>
    </Modal>
  )
}
