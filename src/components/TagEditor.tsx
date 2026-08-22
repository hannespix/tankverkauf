import { useState } from 'react'
import { Button, Input, cx } from './ui'
import { IconClose, IconPlus } from './icons'
import { useStore } from '../lib/store'

/**
 * Equipment details are what make a used-machinery listing credible. Kept as
 * free text with suggestions rather than a fixed list, because every cellar has
 * its own vocabulary.
 */
const SUGGESTED: Record<string, string[]> = {
  tank: ['stapelbar', 'Mannloch', 'Auslaufhahn', 'Restablauf', 'Typenschild vorhanden', 'Kranösen', 'Schwimmdeckel', 'Rührwerk', 'Kühlmantel', 'auf Füßen', 'Volumen eingeprägt'],
  fass: ['Eiche', 'gebraucht', 'weinfeucht', 'ausgetrocknet', 'geschliffen', 'Reifen fest'],
  maschine: ['funktionsfähig', 'mit Zubehör', 'geprüft', 'Ersatzteile vorhanden'],
  armatur: ['Edelstahl', 'lebensmittelecht', 'Milchrohrverschraubung', 'Kupplung vorhanden'],
  gitterbox: ['klappbar', 'stapelbar', 'mit Deckel'],
}

export function TagEditor({
  tags,
  category,
  onChange,
  label = 'Ausstattung',
}: {
  tags: string[]
  category: string
  onChange: (tags: string[]) => void
  label?: string
}) {
  const { db } = useStore()
  const [draft, setDraft] = useState('')

  // The curated set for this category keeps its order and stays in front —
  // sorting everything alphabetically buried the most relevant ones past the cut.
  const curated = SUGGESTED[category] ?? []
  const used = [...new Set(db.tanks.flatMap((t) => t.tags))]
    .filter((t) => !curated.includes(t))
    .sort((a, b) => a.localeCompare(b, 'de'))
  const pool = [...curated, ...used].filter((t) => !tags.includes(t))

  function add(value: string) {
    const v = value.trim()
    if (!v || tags.includes(v)) return
    onChange([...tags, v])
    setDraft('')
  }

  return (
    <div>
      <span className="mb-1 block text-[13px] font-semibold text-muted">{label}</span>

      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-2.5 text-xs font-bold text-primary">
              {t}
              <button
                type="button"
                aria-label={`${t} entfernen`}
                onClick={() => onChange(tags.filter((x) => x !== t))}
                className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/20"
              >
                <IconClose className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder="Merkmal eintippen oder unten wählen"
          list="merkmal-vorschlaege"
        />
        <datalist id="merkmal-vorschlaege">
          {pool.map((t) => <option key={t} value={t} />)}
        </datalist>
        <Button onClick={() => add(draft)} disabled={!draft.trim()} className="shrink-0"><IconPlus /></Button>
      </div>

      {pool.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pool.slice(0, 8).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className={cx('rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted transition',
                'hover:border-primary hover:text-primary')}
            >
              + {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
