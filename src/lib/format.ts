import type { Dims } from '../types'

const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
const int = new Intl.NumberFormat('de-DE')
const dec1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const eur = (n: number | null | undefined) => eur0.format(Number(n) || 0)
export const eurExact = (n: number | null | undefined) => eur2.format(Number(n) || 0)
export const num = (n: number | null | undefined) => int.format(Number(n) || 0)
export const litres = (n: number | null | undefined) => `${int.format(Number(n) || 0)} l`
/** Cents per litre — the number that actually decides whether a tank is priced well. */
export const centsPerLitre = (price: number, l: number) => (l > 0 ? `${dec1.format((price / l) * 100)} ct/l` : '–')
export const pct = (n: number) => `${dec1.format(n * 100)} %`

export const netOf = (brutto: number, vatRate: number) => brutto / (1 + vatRate)
export const vatOf = (brutto: number, vatRate: number) => brutto - netOf(brutto, vatRate)

/**
 * Outer size as a buyer reads it: a cylinder gets a diameter, everything else
 * gets width x depth x height. Returns null when nothing was measured, so
 * callers can leave the line out entirely instead of printing an empty one.
 */
export function dims(d: Dims | null | undefined): string | null {
  if (!d) return null
  // Each number carries its own letter. A trailing "(B x T x H)" reads fine on a
  // desktop table and orphans onto a third line on a phone.
  if (d.dia) return d.h ? `Ø ${num(d.dia)} × H ${num(d.h)} cm` : `Ø ${num(d.dia)} cm`
  const parts = [d.w && `B ${num(d.w)}`, d.d && `T ${num(d.d)}`, d.h && `H ${num(d.h)}`].filter(Boolean)
  return parts.length ? `${parts.join(' × ')} cm` : null
}

/** The largest edge — what has to fit through the door. */
export function widestEdge(d: Dims | null | undefined): number {
  if (!d) return 0
  return Math.max(d.dia ?? 0, d.w ?? 0, d.d ?? 0)
}

/**
 * "Speidel Lagertank · 1.250 l" für eine Position mit Volumen, sonst nur der Name.
 * Ohne das stand an jeder Pumpe und jedem Filter ein "· 0 l".
 */
export function itemLabel(t: { maker: string; type: string; litres: number }): string {
  const name = t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`
  return t.litres > 0 ? `${name} · ${num(t.litres)} l` : name
}

export function dateDE(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function dateTimeDE(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return null
  return Math.floor((Date.now() - d) / 86_400_000)
}

export function relativeDE(iso: string | null | undefined): string {
  const days = daysSince(iso)
  if (days === null) return '–'
  if (days === 0) return 'heute'
  if (days === 1) return 'gestern'
  if (days < 0) return `in ${Math.abs(days)} Tagen`
  if (days < 30) return `vor ${days} Tagen`
  const months = Math.floor(days / 30)
  return months === 1 ? 'vor 1 Monat' : `vor ${months} Monaten`
}

export const todayISO = () => new Date().toISOString().slice(0, 10)
