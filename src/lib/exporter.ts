import type { DB, Maker, Tank } from '../types'
import { STATUS_LABEL, STAGE_LABEL, SOURCE_LABEL } from '../types'
import { netOf, vatOf } from './format'
import { isOpen, progress, totals } from './stats'

/** Export files carry the configured name, not a hardcoded one. */
const fileBase = (db: DB) => (db.settings.appName || 'Bestand').replace(/[^\wÄÖÜäöüß-]+/g, '_')

const fileStamp = () => new Date().toISOString().slice(0, 10)

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function tankRows(db: DB) {
  const v = db.settings.vatRate
  return db.tanks.map((t) => {
    const lead = db.leads.find((l) => l.id === t.leadId)
    const deal = db.deals.find((d) => d.id === t.dealId)
    return {
      Nr: t.id,
      // Jede Pumpe und jede Gitterbox verließ die Tabelle bisher als "Edelstahltank".
      Kategorie: db.settings.categories.find((c) => c.id === t.category)?.one ?? t.category,
      'Hersteller / Typ': t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`,
      Hersteller: t.maker,
      Volumen: t.litres,
      'VB brutto': t.vb,
      'Netto': round2(netOf(t.vb, v)),
      'MwSt.': round2(vatOf(t.vb, v)),
      'Ziel brutto': t.target,
      'Untergrenze brutto': t.floor,
      'Brutto ct/l': round2((t.vb / t.litres) * 100),
      Status: STATUS_LABEL[t.status],
      'Interessent / Käufer': lead?.name ?? '',
      'Gebot brutto': t.offer ?? '',
      Paket: deal?.label ?? '',
      Abholung: t.pickup ?? '',
      Notiz: t.note,
    }
  })
}

/** Rebuilds the grouped layout of the original Kleinanzeigen sheet. */
function groupedRows(db: DB) {
  const open = db.tanks.filter(isOpen)
  const map = new Map<string, { maker: Maker; type: string; litres: number; vb: number; count: number }>()
  for (const t of open) {
    const key = `${t.maker}|${t.type}|${t.litres}|${t.vb}`
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { maker: t.maker, type: t.type, litres: t.litres, vb: t.vb, count: 1 })
  }
  const rows = [...map.values()]
    .sort((a, b) => a.litres - b.litres)
    .map((g) => ({
      'Hersteller / Typ': g.maker === 'Sonstige' ? g.type : `${g.maker} ${g.type}`,
      'Volumen je Tank': g.litres,
      Anzahl: g.count,
      'Preis je Tank brutto (VB)': g.vb,
      Gesamtvolumen: g.litres * g.count,
      'Gesamtpreis brutto (VB)': g.vb * g.count,
    }))
  const t = totals(open)
  rows.push({
    'Hersteller / Typ': 'GESAMT',
    'Volumen je Tank': '' as never,
    Anzahl: t.count,
    'Preis je Tank brutto (VB)': '' as never,
    Gesamtvolumen: t.litres,
    'Gesamtpreis brutto (VB)': t.vb,
  })
  return rows
}

function summaryRows(db: DB) {
  const p = progress(db)
  const v = db.settings.vatRate
  const s = db.settings
  return [
    { Kennzahl: 'Stand', Wert: new Date().toLocaleString('de-DE') },
    { Kennzahl: 'Tanks gesamt', Wert: p.all.count },
    { Kennzahl: 'Gesamtvolumen (l)', Wert: p.all.litres },
    { Kennzahl: 'Verkauft (Anzahl)', Wert: p.sold.count },
    { Kennzahl: 'Verkauft (l)', Wert: p.sold.litres },
    { Kennzahl: 'Verkaufserlös brutto', Wert: p.revenue },
    { Kennzahl: 'Noch vorhanden (Anzahl)', Wert: p.open.count },
    { Kennzahl: 'Noch vorhanden (l)', Wert: p.open.litres },
    { Kennzahl: 'Summe Einzel-VB offen', Wert: p.open.vb },
    { Kennzahl: 'Summe Zielpreise offen', Wert: p.open.target },
    { Kennzahl: 'Summe Untergrenzen offen', Wert: p.open.floor },
    { Kennzahl: 'Paketpreis brutto', Wert: s.packagePrice },
    { Kennzahl: 'Paketpreis netto', Wert: round2(netOf(s.packagePrice, v)) },
    { Kennzahl: `enthaltene ${Math.round(v * 100)} % MwSt.`, Wert: round2(vatOf(s.packagePrice, v)) },
    { Kennzahl: 'Paket je Liter brutto (ct)', Wert: p.open.litres ? round2((s.packagePrice / p.open.litres) * 100) : 0 },
    { Kennzahl: 'Paket-Zielabschluss', Wert: s.packageTarget },
    { Kennzahl: 'Paket-Untergrenze', Wert: s.packageFloor },
  ]
}

function leadRows(db: DB) {
  return db.leads.map((l) => ({
    Name: l.name,
    Telefon: l.phone,
    'E-Mail': l.email,
    Ort: l.location,
    Quelle: SOURCE_LABEL[l.source],
    Phase: STAGE_LABEL[l.stage],
    Interesse: l.tankIds
      .map((id) => db.tanks.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => `${t!.maker} ${t!.litres} l`)
      .join(', '),
    // Die Zusagen an Menschen existieren sonst außerhalb von db.json nirgends.
    'Wartet auf': (l.watch ?? [])
      .map((w) => db.tanks.find((t) => t.id === w.tankId))
      .filter(Boolean)
      .map((t) => (t!.maker === 'Sonstige' ? t!.type : `${t!.maker} ${t!.type}`))
      .join(', '),
    Budget: l.budget ?? '',
    'Letzter Kontakt': l.lastContact ?? '',
    Wiedervorlage: l.nextFollowUp ?? '',
    Notiz: l.note,
  }))
}

function dealRows(db: DB) {
  return db.deals.map((d) => ({
    Nr: d.id,
    Bezeichnung: d.label,
    Käufer: db.leads.find((l) => l.id === d.leadId)?.name ?? '',
    Tanks: d.tankIds.join(', '),
    Anzahl: d.tankIds.length,
    Liter: d.tankIds.reduce((a, id) => a + (db.tanks.find((t) => t.id === id)?.litres ?? 0), 0),
    'Preis brutto': d.price,
    Datum: d.date,
    Bezahlt: d.paid ? 'ja' : 'nein',
    Abgeholt: d.pickedUp ? 'ja' : 'nein',
    Notiz: d.note,
  }))
}

export async function exportXlsx(db: DB): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const add = (name: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
  }
  add('Kleinanzeigen', groupedRows(db))
  add('Tankliste', tankRows(db))
  add('Interessenten', leadRows(db))
  add('Verkäufe', dealRows(db))
  add('Übersicht', summaryRows(db))
  XLSX.writeFile(wb, `${fileBase(db)}_${fileStamp()}.xlsx`)
}

export function exportCsv(db: DB): void {
  const rows = tankRows(db)
  const headers = Object.keys(rows[0] ?? {})
  const csv =
    '﻿' +
    [
      headers.join(';'),
      ...rows.map((r) => headers.map((h) => `"${String((r as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(';')),
    ].join('\r\n')
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${fileBase(db)}_${fileStamp()}.csv`)
}

export function exportJson(db: DB): void {
  download(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), `${fileBase(db)}-backup_${fileStamp()}.json`)
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ------------------------------------------------------------------ import

export interface ImportResult {
  tanks: Tank[]
  warnings: string[]
}

const MAKERS: Maker[] = ['Speidel', 'Clemens']

/**
 * Brand names that turned out to be wrong for this inventory. The original price
 * lists call eleven tanks Möschle; none of them carries a maker's plate. Since
 * this importer rebuilds the stock from exactly those lists, recognising the name
 * would quietly put the false claim back into every ad — so it is dropped from the
 * label instead of being trusted, and the import reports that it did so.
 */
const DISPROVEN = ['Möschle', 'Moeschle']

function splitMaker(label: string): { maker: Maker; type: string; dropped: string | null } {
  let text = label
  let dropped: string | null = null
  for (const wrong of DISPROVEN) {
    const re = new RegExp(`\\b${wrong}\\b[-\\s]*`, 'i')
    if (re.test(text)) {
      dropped = wrong
      text = text.replace(re, '').trim()
    }
  }
  const found = MAKERS.find((m) => text.toLowerCase().includes(m.toLowerCase()))
  if (found) return { maker: found, type: text.replace(new RegExp(found, 'i'), '').trim() || 'Edelstahltank', dropped }
  return { maker: 'Sonstige', type: text.trim() || 'Edelstahltank', dropped }
}

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Re-seed the inventory from a Preisliste like the one this dashboard started
 * from. Rows with an Anzahl column are expanded into individual tanks.
 */
export async function importXlsx(file: File): Promise<ImportResult> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const warnings: string[] = []

  const sheetName =
    wb.SheetNames.find((n) => /preisvariablen/i.test(n)) ??
    wb.SheetNames.find((n) => /tankliste/i.test(n)) ??
    wb.SheetNames.find((n) => /kleinanzeigen/i.test(n)) ??
    wb.SheetNames[0]
  if (!sheetName) throw new Error('Die Datei enthält keine Tabellenblätter.')

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { header: 1 })
  const rows = raw as unknown as unknown[][]

  // The real header is whichever row mentions a Hersteller column.
  const headerIdx = rows.findIndex((r) => r.some((c) => /hersteller/i.test(String(c ?? ''))))
  if (headerIdx === -1) throw new Error('Keine Spalte "Hersteller / Typ" gefunden.')
  const header = rows[headerIdx].map((c) => String(c ?? '').trim())
  const col = (re: RegExp) => header.findIndex((h) => re.test(h))

  const cLabel = col(/hersteller/i)
  const cVol = col(/volumen|liter/i)
  const cCount = col(/anzahl/i)
  const cVb = col(/^vb|preis je tank|vb brutto/i)
  const cTarget = col(/ziel/i)
  const cFloor = col(/untergrenze/i)

  if (cVol === -1 || cVb === -1) throw new Error('Spalten für Volumen und Preis wurden nicht gefunden.')

  const tanks: Tank[] = []
  const now = new Date().toISOString()
  let n = 0

  for (const row of rows.slice(headerIdx + 1)) {
    const label = String(row[cLabel] ?? '').trim()
    if (!label || /gesamt/i.test(label)) continue
    const litres = toNum(row[cVol])
    const vb = toNum(row[cVb])
    if (!litres || !vb) continue

    const count = cCount === -1 ? 1 : Math.max(1, Math.round(toNum(row[cCount])) || 1)
    const target = cTarget === -1 ? Math.round(vb * 0.86) : toNum(row[cTarget]) || Math.round(vb * 0.86)
    const floor = cFloor === -1 ? Math.round(vb * 0.72) : toNum(row[cFloor]) || Math.round(vb * 0.72)
    const { maker, type, dropped } = splitMaker(label)
    if (dropped && !warnings.some((w) => w.includes(dropped))) {
      warnings.push(`„${dropped}“ aus der Datei wurde nicht übernommen — an diesen Tanks ist kein Typenschild. Sie kommen als „Sonstige“ herein.`)
    }

    if (cTarget === -1 || cFloor === -1) {
      const missing = [cTarget === -1 && 'Zielpreis', cFloor === -1 && 'Untergrenze'].filter(Boolean).join(' und ')
      if (!warnings.some((w) => w.includes('geschätzt'))) warnings.push(`${missing} fehlten in der Datei und wurden geschätzt.`)
    }

    for (let i = 0; i < count; i += 1) {
      n += 1
      tanks.push({
        // Placeholder id; Settings assigns a free one for positions that are new.
        id: `IMPORT-${String(n).padStart(3, '0')}`,
        category: 'tank',
        maker,
        dims: null,
        type,
        litres,
        vb,
        target,
        floor,
        status: 'verfuegbar',
        leadId: null,
        dealId: null,
        offer: null,
        pickup: null,
        note: '',
        tags: [],
        photos: [],
        updatedAt: now,
      })
    }
  }

  if (tanks.length === 0) throw new Error('Es konnten keine Tanks aus der Datei gelesen werden.')
  return { tanks, warnings }
}
