import { useEffect, useState } from 'react'
import { Button, Card, Modal, cx } from './components/ui'
import {
  IconCloud, IconCog, IconGauge, IconHandshake, IconLock, IconMegaphone, IconMoon,
  IconSpark, IconSun, IconTank, IconUsers, IconWarn,
} from './components/icons'
import { Inbox, InboxButton } from './components/Inbox'
import { store, useStore } from './lib/store'
import { dateTimeDE } from './lib/format'
import Overview from './views/Overview'
import Quotes from './views/Quotes'
import Tanks from './views/Tanks'
import Leads from './views/Leads'
import Deals from './views/Deals'
import Ads from './views/Ads'
import Settings from './views/Settings'
import { Setup, Unlock } from './views/Unlock'

export type View = 'overview' | 'tanks' | 'leads' | 'quotes' | 'deals' | 'ads' | 'settings'

const NAV: { id: View; label: string; short: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Übersicht', short: 'Start', icon: <IconGauge /> },
  { id: 'tanks', label: 'Bestand', short: 'Bestand', icon: <IconTank /> },
  { id: 'leads', label: 'Interessenten', short: 'Leute', icon: <IconUsers /> },
  { id: 'quotes', label: 'Angebote', short: 'Angebote', icon: <IconSpark /> },
  { id: 'deals', label: 'Verkäufe', short: 'Verkauf', icon: <IconHandshake /> },
  { id: 'ads', label: 'Anzeigen', short: 'Anzeigen', icon: <IconMegaphone /> },
  { id: 'settings', label: 'Einstellungen', short: 'Mehr', icon: <IconLock /> },
]

/** Settings live in the phone header instead, to keep the tab bar readable. */
const TABS = NAV.filter((n) => n.id !== 'settings')

const THEME_KEY = 'tankverkauf.theme'

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark] as const
}

/**
 * Text, den eine andere App hierher geteilt hat. Der Weg über die Adresszeile
 * braucht keinen Service Worker — nur der von Dateien täte das. Was hereinkommt,
 * wird sofort geparkt: bis die PIN eingegeben ist, wäre es sonst weg.
 */
const SHARED_KEY = 'tankverkauf.shared'

function grabShared(): string {
  const q = new URLSearchParams(location.search)
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim()
  if (shared) {
    sessionStorage.setItem(SHARED_KEY, shared)
    history.replaceState(null, '', location.pathname)
  }
  return sessionStorage.getItem(SHARED_KEY) ?? ''
}

export default function App() {
  const { mode, db } = useStore()
  const [view, setView] = useState<View>('overview')
  const [dark, setDark] = useTheme()
  const [inbox, setInbox] = useState(false)
  const [shared, setShared] = useState('')

  useEffect(() => {
    const text = grabShared()
    if (text) {
      setShared(text)
      setInbox(true)
      sessionStorage.removeItem(SHARED_KEY)
    }
  }, [])

  // Am Schreibtisch: einfügen, wo man gerade ist. Am Handy feuert das nur in ein
  // fokussiertes Feld — dort trägt der Knopf "Aus Zwischenablage".
  useEffect(() => {
    if (mode !== 'online' && mode !== 'demo') return
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return
      const text = e.clipboardData?.getData('text')?.trim()
      if (!text || text.length < 20) return
      setShared(text)
      setInbox(true)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [mode])

  // The tab title is written into index.html at build time and would otherwise
  // keep saying "Tankverkauf" whatever the setting says.
  const title = db.settings.appName || 'Betriebsauflösung'
  useEffect(() => { document.title = db.settings.seller.name ? `${title} · ${db.settings.seller.name}` : title }, [title, db.settings.seller.name])

  if (mode === 'boot') return <Booting />
  if (mode === 'setup') return <Setup />
  if (mode === 'locked') return <Unlock />

  const Current = { overview: Overview, tanks: Tanks, leads: Leads, quotes: Quotes, deals: Deals, ads: Ads, settings: Settings }[view]

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop rail */}
      <aside className="no-print sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface/70 p-3 backdrop-blur lg:flex">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-text"><IconTank /></span>
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-tight">{db.settings.appName || 'Betriebsauflösung'}</div>
            {db.settings.seller.name && <div className="text-[11px] text-muted">{db.settings.seller.name}</div>}
          </div>
        </div>
        <nav className="mt-2 flex flex-col gap-0.5">
          {NAV.map((n) => (
            <button key={n.id} type="button" onClick={() => setView(n.id)}
              className={cx('flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                view === n.id ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-3 hover:text-ink')}>
              {n.icon}{n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-1">
          <SyncBadge />
          <button type="button" onClick={() => setDark(!dark)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-muted transition hover:bg-surface-3 hover:text-ink">
            {dark ? <IconSun /> : <IconMoon />}{dark ? 'Hell' : 'Dunkel'}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile header */}
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-text"><IconTank /></span>
            <span className="font-extrabold tracking-tight">{NAV.find((n) => n.id === view)?.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <SyncBadge compact />
            <button type="button" onClick={() => setView('settings')} aria-label="Einstellungen"
              className={cx('flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-surface-3',
                view === 'settings' ? 'text-primary' : 'text-muted hover:text-ink')}>
              <IconCog />
            </button>
            <button type="button" onClick={() => setDark(!dark)} aria-label="Design wechseln"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink">
              {dark ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </header>

        {mode === 'demo' && (
          <div className="no-print flex flex-wrap items-center justify-center gap-2 bg-amber-soft px-4 py-2 text-[13px] font-semibold text-amber">
            <IconWarn />Demo-Modus — Änderungen werden nicht gespeichert.
            <button type="button" className="underline" onClick={() => { store.lock(); location.reload() }}>Jetzt einrichten</button>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1400px] p-3 pb-24 sm:p-4 lg:p-6 lg:pb-6">
          <Current go={setView} />
        </main>

        {/* Von jeder Ansicht aus, in Daumenreichweite — die Leiste hat für einen
            siebten Reiter keinen Platz mehr, und Einpflegen ist ohnehin eine
            Handlung und kein Ort. */}
        <InboxButton onClick={() => { setShared(''); setInbox(true) }} />
        <Inbox open={inbox} onClose={() => setInbox(false)} initialText={shared || undefined} />
      </div>

      {/* Mobile tab bar */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {TABS.map((n) => (
          <button key={n.id} type="button" onClick={() => setView(n.id)}
            className={cx('flex min-w-0 flex-col items-center gap-0.5 px-0.5 py-2 transition', view === n.id ? 'text-primary' : 'text-muted')}>
            {n.icon}
            <span className="w-full truncate text-center text-[9.5px] leading-tight font-bold">{n.short}</span>
          </button>
        ))}
      </nav>

      <ConflictDialog />
    </div>
  )
}

function Booting() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-text">
          <IconTank />
          <span className="animate-ring absolute inset-0 rounded-xl border-2 border-primary" />
        </span>
        <span className="text-sm font-semibold">Wird geladen …</span>
      </div>
    </div>
  )
}

function SyncBadge({ compact }: { compact?: boolean }) {
  const { sync, dirty, mode, lastSyncAt } = useStore()
  if (mode === 'demo') return null

  const state =
    sync === 'saving' ? { tone: 'text-sky', text: 'Speichert …' }
    : sync === 'conflict' ? { tone: 'text-rose', text: 'Konflikt' }
    : sync === 'error' ? { tone: 'text-rose', text: 'Fehler' }
    : sync === 'offline' ? { tone: 'text-amber', text: 'Offline' }
    : sync === 'loading' ? { tone: 'text-sky', text: 'Lädt …' }
    : dirty ? { tone: 'text-amber', text: 'Ungespeichert' }
    : { tone: 'text-primary', text: 'Gespeichert' }

  if (compact) {
    return (
      <span className={cx('flex items-center gap-1.5 px-1.5 text-[11px] font-bold', state.tone)} title={lastSyncAt ? `zuletzt: ${dateTimeDE(lastSyncAt)}` : undefined}>
        <span className={cx('h-2 w-2 rounded-full bg-current', sync === 'saving' && 'animate-pulse')} />
        {state.text}
      </span>
    )
  }
  return (
    <div className={cx('flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px] font-semibold', state.tone)}>
      <IconCloud />
      {state.text}
    </div>
  )
}

function ConflictDialog() {
  const { conflict } = useStore()
  if (!conflict) return null
  return (
    <Modal open onClose={() => {}} title="Änderung von einem anderen Gerät">
      <div className="space-y-4">
        <Card className="!bg-surface-2">
          <p className="text-sm">
            Die Daten auf GitHub wurden zwischenzeitlich geändert — vermutlich hast du auf einem anderen Gerät
            gearbeitet. Beide Stände lassen sich nicht automatisch zusammenführen.
          </p>
          <p className="mt-2 text-[13px] text-muted">
            Stand auf GitHub: {dateTimeDE(conflict.remote.updatedAt)} · {conflict.remote.tanks.length} Positionen,
            {' '}{conflict.remote.leads.length} Interessenten, {conflict.remote.deals.length} Verkäufe.
          </p>
        </Card>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="primary" onClick={() => void store.resolveConflict('mine')}>
            Diesen Stand behalten
          </Button>
          <Button onClick={() => void store.resolveConflict('theirs')}>
            Stand von GitHub laden
          </Button>
        </div>
        <p className="text-xs text-faint">
          Nichts geht verloren: Der überschriebene Stand bleibt als Commit in der Historie deines Daten-Repositories erhalten.
        </p>
      </div>
    </Modal>
  )
}
