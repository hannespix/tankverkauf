import { useState, type ReactNode } from 'react'
import type { TankStatus } from '../types'
import { cx } from './ui'

/** Status is a reserved palette: every segment also carries a written label. */
export const STATUS_FILL: Record<TankStatus, string> = {
  verfuegbar: 'var(--c-verfuegbar)',
  kontakt: 'var(--c-kontakt)',
  reserviert: 'var(--c-reserviert)',
  verkauft: 'var(--c-verkauft)',
  vorbereitung: 'var(--c-vorbereitung)',
}

interface Tip {
  x: number
  y: number
  content: ReactNode
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-card"
      style={{ left: tip.x, top: tip.y - 8 }}
      role="tooltip"
    >
      {tip.content}
    </div>
  )
}

// -------------------------------------------------------- stacked share bar

export interface Segment {
  key: string
  label: string
  value: number
  fill: string
  detail?: string
}

/**
 * Part-to-whole across a handful of states. A stacked bar beats a donut here:
 * it survives a narrow phone and the segments stay comparable.
 */
export function ShareBar({ segments, total, unit = '' }: { segments: Segment[]; total: number; unit?: string }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const shown = segments.filter((s) => s.value > 0)
  if (!total || shown.length === 0) return <div className="h-3 rounded-full bg-c-track" />

  return (
    <div className="relative">
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" onMouseLeave={() => setTip(null)}>
        {shown.map((s) => (
          <div
            key={s.key}
            className="h-full cursor-default transition-[filter] first:rounded-l-full last:rounded-r-full hover:brightness-110"
            style={{ width: `${(s.value / total) * 100}%`, background: s.fill, minWidth: 4 }}
            onMouseMove={(e) => {
              const host = e.currentTarget.closest('.relative') as HTMLElement | null
              if (!host) return
              const r = host.getBoundingClientRect()
              setTip({
                x: e.clientX - r.left,
                y: e.clientY - r.top,
                content: (
                  <span>
                    <strong>{s.label}</strong> · {s.value.toLocaleString('de-DE')}
                    {unit} {s.detail && <span className="text-muted">· {s.detail}</span>}
                  </span>
                ),
              })
            }}
          >
            <span className="sr-only">
              {s.label}: {s.value}
              {unit}
            </span>
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.fill }} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="tnum font-bold">
              {s.value.toLocaleString('de-DE')}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------- ranked bars

export interface BarRow {
  key: string
  label: string
  value: number
  detail?: string
}

/**
 * One measure across named groups. Identity comes from the axis label, so the
 * bars share a single hue — colouring them differently would encode nothing.
 */
export function RankedBars({ rows, format }: { rows: BarRow[]; format: (n: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const max = Math.max(...rows.map((r) => r.value), 1)
  if (rows.length === 0) return null

  return (
    <div className="relative space-y-2.5" onMouseLeave={() => setTip(null)}>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(84px,auto)_1fr_auto] items-center gap-3">
          <div className="truncate text-[13px] font-semibold text-muted" title={r.label}>
            {r.label}
          </div>
          <div className="h-6 overflow-hidden rounded-md bg-c-track">
            <div
              className="h-full rounded-md transition-[filter] hover:brightness-110"
              style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%`, background: 'var(--c-series)' }}
              onMouseMove={(e) => {
                const host = e.currentTarget.closest('.relative') as HTMLElement | null
                if (!host) return
                const box = host.getBoundingClientRect()
                setTip({
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                  content: (
                    <span>
                      <strong>{r.label}</strong> · {format(r.value)}
                      {r.detail && <span className="text-muted"> · {r.detail}</span>}
                    </span>
                  ),
                })
              }}
            />
          </div>
          <div className="tnum text-[13px] font-bold">{format(r.value)}</div>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  )
}

// ------------------------------------------------------------- price ladder

/**
 * Where an offer sits on one tank's own price ladder: Untergrenze → Zielpreis → VB.
 * A single positional scale, so the answer is readable at a glance during a call.
 */
export function PriceLadder({
  floor,
  target,
  vb,
  offer,
  format,
  compact = false,
}: {
  floor: number
  target: number
  vb: number
  offer: number | null
  format: (n: number) => string
  compact?: boolean
}) {
  const lo = Math.min(floor, offer ?? floor) * 0.94
  const hi = Math.max(vb, offer ?? vb) * 1.06
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100

  const marks = [
    { v: floor, label: 'Limit', tone: 'text-rose' },
    { v: target, label: 'Ziel', tone: 'text-amber' },
    { v: vb, label: 'VB', tone: 'text-muted' },
  ]

  return (
    <div className={cx('w-full', compact ? 'pt-1 pb-5' : 'pt-2 pb-11')}>
      <div className="relative h-1.5 rounded-full bg-c-track">
        {/* Acceptable band: floor → VB */}
        <div
          className="absolute top-0 h-full rounded-full opacity-30"
          style={{ left: `${at(floor)}%`, width: `${at(vb) - at(floor)}%`, background: 'var(--c-series)' }}
        />
        {marks.map((m) => (
          <div key={m.label} className="absolute -top-1 flex flex-col items-center" style={{ left: `${at(m.v)}%`, transform: 'translateX(-50%)' }}>
            <span className="h-3.5 w-0.5 rounded-full bg-line-strong" />
            {!compact && <span className={cx('mt-1 text-[10px] font-bold whitespace-nowrap', m.tone)}>{m.label}</span>}
          </div>
        ))}
        {offer != null && offer > 0 && (
          <div className="absolute -top-[7px] z-10 flex flex-col items-center" style={{ left: `${Math.min(Math.max(at(offer), 0), 100)}%`, transform: 'translateX(-50%)' }}>
            <span
              className={cx(
                'h-4 w-4 rounded-full border-2 border-surface shadow-sm',
                offer >= target ? 'bg-c-verfuegbar' : offer >= floor ? 'bg-c-kontakt' : 'bg-rose',
              )}
            />
            <span className={cx('tnum text-[10px] font-extrabold whitespace-nowrap', compact ? 'mt-1' : 'mt-6')}>{format(offer)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
