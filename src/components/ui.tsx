import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCheck, IconClose, IconCopy } from './icons'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// ------------------------------------------------------------------- layout

export function Card({
  children, className = '', pad = true, style,
}: { children: ReactNode; className?: string; pad?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={style} className={cx('rounded-2xl border border-line bg-surface shadow-card', pad && 'p-4 sm:p-5', className)}>
      {children}
    </div>
  )
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

// ------------------------------------------------------------------ buttons

type Variant = 'primary' | 'default' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-text border-primary hover:brightness-110 active:brightness-95',
  default: 'bg-surface-2 border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'bg-transparent border-transparent hover:bg-surface-3',
  danger: 'bg-transparent border-line text-rose hover:bg-rose-soft hover:border-rose',
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: { children: ReactNode; variant?: Variant; size?: 'sm' | 'md' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'min-h-8 px-2.5 text-[13px]' : 'min-h-11 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({ label, children, ...rest }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted transition',
        'hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        rest.className,
      )}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------------- inputs

const FIELD =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm transition placeholder:text-faint ' +
  'focus:border-primary focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-primary/20 ' +
  'disabled:opacity-60'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, props.className)} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(FIELD, 'resize-y leading-relaxed', props.className)} />
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23808f85' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")"

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.6rem center', backgroundSize: '1rem', ...props.style }}
      className={cx(FIELD, 'cursor-pointer appearance-none pr-8', props.className)}
    />
  )
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cx('inline-flex rounded-xl border border-line bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-9 rounded-lg px-3 text-[13px] font-semibold transition',
            value === o.value ? 'bg-primary text-primary-text shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-sm font-medium"
    >
      <span className={cx('relative h-6 w-10 rounded-full border transition', checked ? 'border-primary bg-primary' : 'border-line bg-surface-3')}>
        <span className={cx('absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all', checked ? 'left-[1.15rem]' : 'left-0.5')} style={{ height: 18, width: 18 }} />
      </span>
      {label}
    </button>
  )
}

// -------------------------------------------------------------------- pills

export type Tone = 'green' | 'amber' | 'sky' | 'rose' | 'neutral'

const TONES: Record<Tone, string> = {
  green: 'bg-primary-soft text-primary',
  amber: 'bg-amber-soft text-amber',
  sky: 'bg-sky-soft text-sky',
  rose: 'bg-rose-soft text-rose',
  neutral: 'bg-surface-3 text-muted',
}

export function Pill({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', TONES[tone], className)}>
      {children}
    </span>
  )
}

// -------------------------------------------------------------------- modal

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(
          'animate-rise max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <h3 className="font-bold tracking-tight">{title}</h3>
          <IconButton label="Schließen" onClick={onClose}>
            <IconClose />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------- misc

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Copy-to-clipboard button that confirms itself for a moment. */
export function CopyButton({ text, label = 'Kopieren', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setDone(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 1600)
  }

  return (
    <Button size="sm" variant={done ? 'primary' : 'default'} onClick={copy} className={className}>
      {done ? <IconCheck /> : <IconCopy />}
      {done ? 'Kopiert' : label}
    </Button>
  )
}

/** A labelled figure. The workhorse of the whole dashboard. */
export function Stat({ label, value, sub, tone, className = '' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cx('rounded-2xl border border-line bg-surface p-3.5 shadow-card sm:p-4', className)}>
      <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className={cx('tnum mt-1 text-[1.6rem] leading-none font-extrabold tracking-tight', tone === 'green' && 'text-primary', tone === 'amber' && 'text-amber', tone === 'rose' && 'text-rose')}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[13px] text-muted">{sub}</div>}
    </div>
  )
}
