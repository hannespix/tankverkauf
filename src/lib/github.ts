/**
 * GitHub Contents API as the database.
 *
 * One JSON file in a private repo holds everything. Writes are commits, which
 * buys full history and undo for free, and the `sha` round-trip gives real
 * optimistic concurrency: if the phone and the laptop both edit, the second
 * write is rejected instead of silently clobbering the first.
 */

const API = 'https://api.github.com'

export interface RepoConfig {
  owner: string
  repo: string
  branch: string
  path: string
}

export const DEFAULT_CONFIG: RepoConfig = {
  owner: '',
  repo: 'tankverkauf-data',
  branch: 'main',
  path: 'db.json',
}

const CONFIG_KEY = 'tankverkauf.repo.v1'

export function loadConfig(): RepoConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<RepoConfig>) } : { ...DEFAULT_CONFIG }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(cfg: RepoConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

export const isConfigured = (c: RepoConfig) => Boolean(c.owner && c.repo && c.branch && c.path)

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

/** btoa() throws on anything non-Latin1, and this data is full of Möschle/Verfügbar. */
function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  return res
}

async function fail(res: Response, fallback: string): Promise<never> {
  let detail = ''
  try {
    detail = ((await res.json()) as { message?: string }).message ?? ''
  } catch {
    /* body was not JSON */
  }
  throw new GitHubError(detail || fallback, res.status)
}

export interface TokenIdentity {
  login: string
}

export async function verifyToken(token: string): Promise<TokenIdentity> {
  const res = await call(token, '/user')
  if (!res.ok) await fail(res, 'Token konnte nicht geprüft werden.')
  const user = (await res.json()) as { login: string }
  return { login: user.login }
}

export interface RepoMeta {
  private: boolean
  defaultBranch: string
  permissions: { push: boolean }
}

export async function repoMeta(token: string, cfg: RepoConfig): Promise<RepoMeta> {
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}`)
  if (!res.ok) await fail(res, `Repository ${cfg.owner}/${cfg.repo} nicht erreichbar.`)
  const r = (await res.json()) as { private: boolean; default_branch: string; permissions?: { push?: boolean } }
  return { private: r.private, defaultBranch: r.default_branch, permissions: { push: Boolean(r.permissions?.push) } }
}

export interface RemoteFile {
  text: string
  sha: string
}

/** null means the file does not exist yet — the first save will create it. */
export async function getFile(token: string, cfg: RepoConfig): Promise<RemoteFile | null> {
  const url = `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`
  const res = await call(token, url)
  if (res.status === 404) return null
  if (!res.ok) await fail(res, 'Daten konnten nicht geladen werden.')
  const body = (await res.json()) as { content?: string; sha: string; encoding?: string }
  if (!body.content) throw new GitHubError('Datei ist zu groß für die Contents-API.', 200)
  return { text: decodeUtf8Base64(body.content), sha: body.sha }
}

export class ConflictError extends Error {
  constructor(readonly remote: RemoteFile) {
    super('Die Daten wurden zwischenzeitlich auf einem anderen Gerät geändert.')
    this.name = 'ConflictError'
  }
}

export async function putFile(
  token: string,
  cfg: RepoConfig,
  text: string,
  sha: string | null,
  message: string,
): Promise<string> {
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encodeUtf8Base64(text),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  })

  // 409 (and sometimes 422) mean our base sha is stale: someone else wrote first.
  if (res.status === 409 || res.status === 422) {
    const remote = await getFile(token, cfg)
    if (remote && remote.sha !== sha) throw new ConflictError(remote)
    await fail(res, 'Speichern fehlgeschlagen.')
  }
  if (!res.ok) await fail(res, 'Speichern fehlgeschlagen.')
  const body = (await res.json()) as { content: { sha: string } }
  return body.content.sha
}

export interface CommitSummary {
  sha: string
  message: string
  date: string
}

export async function fileHistory(token: string, cfg: RepoConfig, limit = 20): Promise<CommitSummary[]> {
  const url = `/repos/${cfg.owner}/${cfg.repo}/commits?path=${encodeURIComponent(cfg.path)}&sha=${encodeURIComponent(cfg.branch)}&per_page=${limit}`
  const res = await call(token, url)
  if (!res.ok) return []
  const body = (await res.json()) as { sha: string; commit: { message: string; author: { date: string } } }[]
  return body.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.author.date }))
}

// ------------------------------------------------------------------ binaries

/** Photos go into the data repo as ordinary files; content must already be base64. */
export async function putBinary(
  token: string,
  cfg: RepoConfig,
  path: string,
  base64: string,
  message: string,
): Promise<void> {
  const existing = await headFile(token, cfg, path)
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: base64, branch: cfg.branch, ...(existing ? { sha: existing } : {}) }),
  })
  if (!res.ok) await fail(res, 'Foto konnte nicht hochgeladen werden.')
}

/** Just the sha, without pulling the whole file down. */
export async function headFile(token: string, cfg: RepoConfig, path: string): Promise<string | null> {
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`)
  if (!res.ok) return null
  const body = (await res.json()) as { sha?: string }
  return body.sha ?? null
}

export async function getBinary(token: string, cfg: RepoConfig, path: string): Promise<Blob | null> {
  // The raw media type avoids base64 round-tripping for anything sizeable.
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: { Accept: 'application/vnd.github.raw' },
  })
  if (!res.ok) return null
  return res.blob()
}

/** File names directly inside a directory. Empty when the directory does not exist. */
export async function listDir(token: string, cfg: RepoConfig, path: string): Promise<string[]> {
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`)
  if (!res.ok) return []
  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) return []
  return (body as { name?: string; type?: string }[])
    .filter((e) => e.type === 'file' && e.name)
    .map((e) => e.name!)
}

export async function deleteBinary(token: string, cfg: RepoConfig, path: string, message: string): Promise<void> {
  const sha = await headFile(token, cfg, path)
  if (!sha) return
  const res = await call(token, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: cfg.branch }),
  })
  if (!res.ok) await fail(res, 'Foto konnte nicht gelöscht werden.')
}
