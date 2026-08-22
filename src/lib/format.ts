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
