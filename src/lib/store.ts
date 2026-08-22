import { useSyncExternalStore } from 'react'
import type { Activity, ActivityKind, DB } from '../types'
import { SEED } from './seed'
import { cachedUrl, forgetUrl, photoPath, rememberUrl } from './photos'
import { buildCatalog, catalogPageUrl } from './catalog'
import {
  ConflictError,
  GitHubError,
  type RemoteFile,
  type RepoConfig,
  getFile,
  isConfigured,
  loadConfig,
  putFile,
  putBinary,
  getBinary,
  deleteBinary,
  repoMeta,
  saveConfig,
  verifyToken,
} from './github'
import { DEFAULT_REMEMBER_DAYS, forgetDevice, loadVault, recallFromDevice, rememberOnDevice, unseal } from './vault'

export type Mode =
  /** Checking whether this device is still signed in. */
  | 'boot'
  /** No vault on this device yet — first run. */
  | 'setup'
  /** Vault exists, waiting for the PIN. */
  | 'locked'
  /** Unlocked and talking to GitHub. */
  | 'online'
  /** Browsing the bundled inventory without a token. Read-only. */
  | 'demo'

export type SyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict'

export interface StoreSnapshot {
  db: DB
  mode: Mode
  sync: SyncState
  /** Pending local changes that have not reached GitHub yet. */
  dirty: boolean
  error: string | null
  login: string | null
  repoPrivate: boolean | null
  lastSyncAt: string | null
  conflict: { remote: DB; remoteFile: RemoteFile } | null
  config: RepoConfig
}

const CACHE_PREFIX = 'tankverkauf.cache.'
const SAVE_DEBOUNCE_MS = 1500

const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T))

export const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

export function migrate(raw: unknown): DB {
  const db = raw as Partial<DB>
  const seed = SEED
  const settings = { ...clone(seed.settings), ...(db.settings ?? {}) }
  // Databases written before portals existed carry neither the list nor an ad's portal.
  if (!Array.isArray(settings.portals) || settings.portals.length === 0) {
    settings.portals = clone(seed.settings.portals)
  }
  if (!Array.isArray(settings.categories) || settings.categories.length === 0) {
    settings.categories = clone(seed.settings.categories)
  }
  // The catalogue almost always lives under the same account as the data repo,
  // and an empty owner silently disables publishing — so fill it in.
  // The first version wrote to the repo root, which GitHub Pages never serves —
  // only what the build copies into dist/ ends up online.
  if (settings.catalog?.path === 'katalog/katalog.json') {
    settings.catalog = { ...settings.catalog, path: 'public/katalog/katalog.json' }
  }
  if (!settings.catalog?.owner) {
    settings.catalog = { ...clone(seed.settings.catalog), ...(settings.catalog ?? {}), owner: loadConfig().owner }
  }
  const fallbackPortal = settings.portals[0].id
  // Items stored before barrels existed are all tanks.
  const tanks = (db.tanks ?? clone(seed.tanks)).map((t) => ({
    ...t,
    category: t.category ?? 'tank',
    photos: t.photos ?? [],
    // Measured later than the rest; null means "not measured", not "no size".
    dims: t.dims ?? null,
  }))
  const ads = (db.ads ?? []).map((a) => ({ ...a, portalId: a.portalId ?? fallbackPortal }))

  return {
    schema: 1,
    updatedAt: db.updatedAt ?? new Date().toISOString(),
    tanks,
    leads: db.leads ?? [],
    quotes: db.quotes ?? [],
    deals: db.deals ?? clone(seed.deals),
    ads,
    settings,
    activity: db.activity ?? [],
  }
}

class TankStore {
  private snapshot: StoreSnapshot
  private listeners = new Set<() => void>()
  private token: string | null = null
  private sha: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saving = false
  private pendingReason = ''

  constructor() {
    const config = loadConfig()
    this.snapshot = {
      db: clone(SEED),
      mode: 'boot',
      sync: 'idle',
      dirty: false,
      error: null,
      login: null,
      repoPrivate: null,
      lastSyncAt: null,
      conflict: null,
      config,
    }
    const cached = this.readCache(config)
    if (cached) this.snapshot.db = cached

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush())
      window.addEventListener('beforeunload', () => {
        if (this.snapshot.dirty) this.writeCache()
      })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.snapshot.dirty) void this.flush()
      })
    }
  }

  /**
   * Resolve the opening screen: a device that opted into staying signed in goes
   * straight through, everything else lands on the PIN or the setup wizard.
   */
  async init() {
    const token = await recallFromDevice()
    if (token) {
      this.token = token
      this.emit({ mode: 'online' })
      await this.connect()
      return
    }
    this.emit({ mode: loadVault() ? 'locked' : 'setup' })
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.snapshot

  private emit(patch: Partial<StoreSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((l) => l())
  }

  private cacheKey(cfg: RepoConfig) {
    return `${CACHE_PREFIX}${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.path}`
  }

  private readCache(cfg: RepoConfig): DB | null {
    try {
      const raw = localStorage.getItem(this.cacheKey(cfg))
      return raw ? migrate(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  private writeCache() {
    try {
      localStorage.setItem(this.cacheKey(this.snapshot.config), JSON.stringify(this.snapshot.db))
    } catch {
      /* quota exceeded — the remote copy is still authoritative */
    }
  }

  // ---------------------------------------------------------------- session

  async unlock(pin: string, remember = false): Promise<boolean> {
    const vault = loadVault()
    if (!vault) return false
    const token = await unseal(vault, pin)
    if (!token) return false
    this.token = token
    if (remember) await rememberOnDevice(token, DEFAULT_REMEMBER_DAYS)
    this.emit({ mode: 'online' })
    await this.connect()
    return true
  }

  /** Called right after the vault is created during setup. */
  async adoptToken(token: string, cfg: RepoConfig, remember = false) {
    this.token = token
    if (remember) await rememberOnDevice(token, DEFAULT_REMEMBER_DAYS)
    saveConfig(cfg)
    const cached = this.readCache(cfg)
    this.emit({ config: cfg, mode: 'online', db: cached ?? this.snapshot.db })
    await this.connect()
  }

  browseDemo() {
    this.emit({ mode: 'demo', db: clone(SEED), sync: 'idle' })
  }

  /** Locking has to drop the remembered session too, or the next load walks straight back in. */
  lock() {
    this.token = null
    this.sha = null
    forgetDevice()
    this.emit({ mode: loadVault() ? 'locked' : 'setup', sync: 'idle', error: null, login: null })
  }

  /** Pull the current state from GitHub and adopt it. */
  async connect() {
    if (!this.token || !isConfigured(this.snapshot.config)) return
    this.emit({ sync: 'loading', error: null })
    try {
      const [identity, meta] = await Promise.all([
        verifyToken(this.token),
        repoMeta(this.token, this.snapshot.config).catch(() => null),
      ])
      const remote = await getFile(this.token, this.snapshot.config)
      if (remote) {
        this.sha = remote.sha
        this.emit({
          db: migrate(JSON.parse(remote.text)),
          sync: 'idle',
          dirty: false,
          login: identity.login,
          repoPrivate: meta?.private ?? null,
          lastSyncAt: new Date().toISOString(),
        })
        this.writeCache()
      } else {
        // First run against an empty data repo: seed it.
        this.sha = null
        this.emit({ login: identity.login, repoPrivate: meta?.private ?? null, dirty: true })
        await this.flush('Ausgangsbestand angelegt')
      }
    } catch (err) {
      this.emit({ sync: navigator.onLine ? 'error' : 'offline', error: describe(err) })
    }
  }

  // --------------------------------------------------------------- mutation

  /** Apply a change locally, log it, and schedule a commit. */
  mutate(fn: (db: DB) => void, log?: { kind: ActivityKind; text: string }) {
    const db = clone(this.snapshot.db)
    fn(db)
    db.updatedAt = new Date().toISOString()
    if (log) {
      const entry: Activity = { id: newId('A'), at: db.updatedAt, kind: log.kind, text: log.text }
      db.activity = [entry, ...db.activity].slice(0, 300)
      this.pendingReason = log.text
    }
    this.emit({ db, dirty: this.snapshot.mode === 'online' })
    this.writeCache()
    if (this.snapshot.mode === 'online') this.scheduleFlush()
  }

  private scheduleFlush() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS)
  }

  async flush(reason?: string): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.token || this.snapshot.mode !== 'online' || this.saving) return
    if (!this.snapshot.dirty) return
    if (!navigator.onLine) {
      this.emit({ sync: 'offline' })
      return
    }

    this.saving = true
    this.emit({ sync: 'saving', error: null })
    const message = commitMessage(reason ?? this.pendingReason)
    try {
      const text = `${JSON.stringify(this.snapshot.db, null, 2)}\n`
      this.sha = await putFile(this.token, this.snapshot.config, text, this.sha, message)
      this.pendingReason = ''
      this.emit({ sync: 'saved', dirty: false, lastSyncAt: new Date().toISOString(), error: null })
      setTimeout(() => {
        if (this.snapshot.sync === 'saved') this.emit({ sync: 'idle' })
      }, 2000)
    } catch (err) {
      if (err instanceof ConflictError) {
        this.emit({
          sync: 'conflict',
          conflict: { remote: migrate(JSON.parse(err.remote.text)), remoteFile: err.remote },
          error: err.message,
        })
      } else {
        this.emit({ sync: navigator.onLine ? 'error' : 'offline', error: describe(err) })
      }
    } finally {
      this.saving = false
    }
  }

  /** Resolve a two-device clash: keep what is on this device, or take the remote copy. */
  async resolveConflict(choice: 'mine' | 'theirs') {
    const conflict = this.snapshot.conflict
    if (!conflict) return
    this.sha = conflict.remoteFile.sha
    if (choice === 'theirs') {
      this.emit({ db: conflict.remote, conflict: null, sync: 'idle', dirty: false, error: null })
      this.writeCache()
    } else {
      this.emit({ conflict: null, sync: 'idle', dirty: true, error: null })
      await this.flush('Konflikt gelöst – lokale Version behalten')
    }
  }

  /** Upload a prepared photo and attach it to an item. */
  async addPhoto(tankId: string, base64: string): Promise<void> {
    if (!this.token) throw new Error('Nicht angemeldet — Fotos brauchen eine Verbindung zu GitHub.')
    const stamp = Math.random().toString(36).slice(2, 8)
    const path = photoPath(tankId, stamp)
    await putBinary(this.token, this.snapshot.config, path, base64, `Foto zu ${tankId}`)
    this.mutate((db) => {
      const t = db.tanks.find((x) => x.id === tankId)
      if (t) t.photos = [...t.photos, path]
    }, { kind: 'tank', text: `Foto zu ${tankId} hinzugefügt` })
  }

  async removePhoto(tankId: string, path: string): Promise<void> {
    if (!this.token) return
    await deleteBinary(this.token, this.snapshot.config, path, `Foto zu ${tankId} entfernt`)
    forgetUrl(path)
    this.mutate((db) => {
      const t = db.tanks.find((x) => x.id === tankId)
      if (t) t.photos = t.photos.filter((x) => x !== path)
    }, { kind: 'tank', text: `Foto zu ${tankId} entfernt` })
  }

  /** Resolves to an object URL, fetching the blob once and caching it. */
  async photoUrl(path: string): Promise<string | null> {
    const hit = cachedUrl(path)
    if (hit) return hit
    if (!this.token) return null
    const blob = await getBinary(this.token, this.snapshot.config, path)
    return blob ? rememberUrl(path, blob) : null
  }

  /**
   * Publish the reduced catalogue into the public repo. Deliberately a separate
   * target from the data repo, and the token needs to be allowed to write there.
   */
  async publishCatalog(): Promise<string> {
    if (!this.token) throw new Error('Nicht angemeldet.')
    const c = this.snapshot.db.settings.catalog
    if (!c.owner || !c.repo || !c.path) throw new Error('Zielrepository für den Katalog ist nicht eingetragen.')
    const cfg: RepoConfig = { owner: c.owner, repo: c.repo, branch: c.branch || 'main', path: c.path }
    const catalog = buildCatalog(this.snapshot.db)
    const text = `${JSON.stringify(catalog, null, 2)}\n`
    const existing = await getFile(this.token, cfg).catch(() => null)
    await putFile(this.token, cfg, text, existing?.sha ?? null, `Katalog aktualisiert (${catalog.items.length} Positionen)`)
    this.mutate(() => {}, { kind: 'settings', text: `Katalog veröffentlicht: ${catalog.items.length} Positionen` })
    return catalogPageUrl(c)
  }

  async updateConfig(cfg: RepoConfig) {
    saveConfig(cfg)
    this.sha = null
    this.emit({ config: cfg, dirty: false })
    await this.connect()
  }

  /** Replace the whole database, e.g. after an import. */
  /** A restored backup goes through the same migration as a loaded one — an older
   *  file otherwise lands without category or photos and the list throws on render. */
  replaceAll(raw: unknown, reason: string) {
    const db = migrate(raw)
    this.mutate((draft) => {
      draft.tanks = db.tanks
      draft.leads = db.leads
      draft.quotes = db.quotes
      draft.deals = db.deals
      draft.ads = db.ads
      draft.settings = db.settings
    }, { kind: 'settings', text: reason })
  }
}

function commitMessage(reason: string): string {
  const stamp = new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  return reason ? `${reason} (${stamp})` : `Stand ${stamp}`
}

function describe(err: unknown): string {
  if (err instanceof GitHubError) {
    if (err.status === 401) return 'Token ungültig oder abgelaufen.'
    if (err.status === 403) return 'Keine Berechtigung — hat der Token Contents: Read & Write?'
    if (err.status === 404) return 'Repository oder Branch nicht gefunden.'
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Unbekannter Fehler.'
}

export const store = new TankStore()

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
