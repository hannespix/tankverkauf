import { useState } from 'react'
import { Button, Card, Field, Input, cx } from '../components/ui'
import { IconCheck, IconLock, IconTank, IconWarn } from '../components/icons'
import { DEFAULT_CONFIG, type RepoConfig, repoMeta, verifyToken } from '../lib/github'
import { store } from '../lib/store'
import { loadConfig } from '../lib/github'
import { DEFAULT_REMEMBER_DAYS, saveVault, seal, unseal, loadVault, clearVault } from '../lib/vault'

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export function Unlock() {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(true)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const vault = loadVault()
    if (!vault) return
    const token = await unseal(vault, pin)
    if (!token) {
      setErr('Falsche PIN.')
      setPin('')
      setBusy(false)
      return
    }
    await store.unlock(pin, remember)
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <IconLock className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">Tankverkauf entsperren</h1>
          <p className="mt-1 text-sm text-muted">Gib deine PIN ein, um auf die Daten zuzugreifen.</p>
        </div>

        <Input
          type="password" inputMode="numeric" autoFocus autoComplete="current-password"
          value={pin} onChange={(e) => { setPin(e.target.value); setErr(null) }}
          placeholder="PIN" className="text-center text-lg tracking-[0.3em]"
        />
        {err && <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-rose"><IconWarn />{err}</p>}

        <RememberBox checked={remember} onChange={setRemember} />

        <Button variant="primary" className="w-full" disabled={pin.length < 4 || busy} {...({ type: 'submit' } as object)}>
          {busy ? 'Wird geprüft …' : 'Entsperren'}
        </Button>

        <div className="flex items-center justify-between pt-2 text-[13px]">
          <button type="button" className="text-muted underline hover:text-ink" onClick={() => store.browseDemo()}>Nur ansehen</button>
          <button type="button" className="text-muted underline hover:text-ink"
            onClick={() => { if (confirm('Zugang auf diesem Gerät zurücksetzen? Deine Daten auf GitHub bleiben erhalten.')) { clearVault(); location.reload() } }}>
            PIN vergessen
          </button>
        </div>
      </form>
    </Shell>
  )
}

export function Setup() {
  const [step, setStep] = useState(0)
  const [cfg, setCfg] = useState<RepoConfig>({ ...DEFAULT_CONFIG, ...loadConfig() })
  const [token, setToken] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState<{ login: string; isPrivate: boolean } | null>(null)
  const [remember, setRemember] = useState(true)

  async function check() {
    setBusy(true)
    setErr(null)
    try {
      const who = await verifyToken(token.trim())
      const owner = cfg.owner.trim() || who.login
      const next = { ...cfg, owner }
      setCfg(next)
      const meta = await repoMeta(token.trim(), next)
      if (!meta.permissions.push) throw new Error('Der Token darf in dieses Repository nicht schreiben. Berechtigung "Contents: Read and write" prüfen.')
      setChecked({ login: who.login, isPrivate: meta.private })
      setStep(2)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verbindung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    try {
      saveVault(await seal(token.trim(), pin))
      await store.adoptToken(token.trim(), cfg, remember)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <IconTank className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">Tankverkauf einrichten</h1>
          <p className="mt-1 text-sm text-muted">Einmal pro Gerät. Dauert zwei Minuten.</p>
        </div>

        <ol className="flex gap-1.5">
          {['Repository', 'Zugang', 'PIN'].map((l, i) => (
            <li key={l} className="flex-1">
              <div className={cx('h-1 rounded-full', i <= step ? 'bg-primary' : 'bg-line')} />
              <span className={cx('mt-1.5 block text-[11px] font-bold', i <= step ? 'text-primary' : 'text-faint')}>{l}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[13px] leading-relaxed">
              <p className="font-bold text-ink">Erst ein privates Repository anlegen</p>
              <p className="mt-1 text-muted">
                Deine Verkaufsdaten kommen in ein eigenes, <strong>privates</strong> Repository — nicht in das öffentliche
                mit dem Programmcode. Sonst könnte jeder die Namen und Telefonnummern deiner Interessenten lesen.
              </p>
              <a href="https://github.com/new" target="_blank" rel="noreferrer noopener" className="mt-2 inline-block font-semibold text-primary underline">
                Repository anlegen → Name „tankverkauf-data“, Sichtbarkeit „Private“
              </a>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="GitHub-Benutzer"><Input value={cfg.owner} onChange={(e) => setCfg({ ...cfg, owner: e.target.value.trim() })} placeholder="hannespix" autoFocus /></Field>
              <Field label="Repository"><Input value={cfg.repo} onChange={(e) => setCfg({ ...cfg, repo: e.target.value.trim() })} placeholder="tankverkauf-data" /></Field>
            </div>
            <Button variant="primary" className="w-full" disabled={!cfg.owner || !cfg.repo} onClick={() => setStep(1)}>Weiter</Button>
            <button type="button" className="block w-full text-center text-[13px] text-muted underline hover:text-ink" onClick={() => store.browseDemo()}>
              Erstmal nur ansehen
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[13px] leading-relaxed">
              <p className="font-bold text-ink">Zugangstoken erzeugen</p>
              <ol className="mt-1 list-inside list-decimal space-y-0.5 text-muted">
                <li>Link unten öffnen</li>
                <li>Bei <em>Repository access</em>: <strong>Only select repositories</strong> → {cfg.owner}/{cfg.repo}</li>
                <li>Bei <em>Permissions</em> → Repository permissions: <strong>Contents: Read and write</strong></li>
                <li>Token erzeugen und hier einfügen</li>
              </ol>
              <a href={TOKEN_URL} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block font-semibold text-primary underline">
                Fine-grained Token erstellen →
              </a>
            </div>
            <Field label="Token" hint="Wird verschlüsselt auf diesem Gerät gespeichert und nirgendwo sonst hingeschickt.">
              <Input type="password" value={token} onChange={(e) => { setToken(e.target.value); setErr(null) }} placeholder="github_pat_…" autoFocus className="font-mono text-[13px]" />
            </Field>
            {err && <p className="flex items-start gap-1.5 text-sm font-semibold text-rose"><IconWarn className="mt-0.5 shrink-0" />{err}</p>}
            <div className="flex gap-2">
              <Button onClick={() => setStep(0)}>Zurück</Button>
              <Button variant="primary" className="flex-1" disabled={!token.trim() || busy} onClick={() => void check()}>
                {busy ? 'Wird geprüft …' : 'Verbindung testen'}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && checked && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary-soft p-3 text-sm font-semibold text-primary">
              <IconCheck />Verbunden als {checked.login}
            </div>
            {!checked.isPrivate && (
              <div className="flex items-start gap-2 rounded-xl border border-rose/50 bg-rose-soft p-3 text-sm">
                <IconWarn className="mt-0.5 shrink-0 text-rose" />
                <span><strong>{cfg.owner}/{cfg.repo} ist öffentlich.</strong> Stell es auf „Private“, bevor du Interessentendaten einträgst.</span>
              </div>
            )}
            <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[13px] text-muted">
              Wähl eine PIN. Sie verschlüsselt den Token auf diesem Gerät — ohne PIN kommt niemand an deine Daten,
              auch wenn das Handy in fremde Hände gerät.
            </div>
            <Field label="PIN (mindestens 4 Zeichen)">
              <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus className="text-center text-lg tracking-[0.3em]" />
            </Field>
            <Field label="PIN wiederholen">
              <Input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)} className="text-center text-lg tracking-[0.3em]" />
            </Field>
            {pin && pin2 && pin !== pin2 && <p className="text-sm font-semibold text-rose">Die PINs stimmen nicht überein.</p>}
            <RememberBox checked={remember} onChange={setRemember} />
            <Button variant="primary" className="w-full" disabled={pin.length < 4 || pin !== pin2 || busy} onClick={() => void finish()}>
              {busy ? 'Wird eingerichtet …' : 'Fertig — loslegen'}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  )
}

function RememberBox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
      <span>
        <span className="block font-semibold text-ink">Auf diesem Gerät angemeldet bleiben</span>
        <span className="block text-muted">
          Dann entfällt die PIN für {DEFAULT_REMEMBER_DAYS} Tage. Nur auf Geräten aktivieren, auf die niemand sonst zugreift.
        </span>
      </span>
    </label>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md animate-rise">{children}</Card>
    </div>
  )
}
