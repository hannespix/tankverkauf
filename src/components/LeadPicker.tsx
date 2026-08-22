import { useState } from 'react'
import { Button, Input, Select } from './ui'
import { IconPlus } from './icons'
import { addLead } from '../lib/actions'
import { useStore } from '../lib/store'
import type { LeadStage } from '../types'

/**
 * Choosing an interested party is useless if the person on the phone is not in
 * the list yet — so the picker can create one on the spot. Expands inline rather
 * than opening a second dialog, because it is itself often used inside one.
 */
export function LeadPicker({
  value,
  onChange,
  emptyLabel = '– keiner –',
  stage,
}: {
  value: string
  onChange: (leadId: string) => void
  emptyLabel?: string
  /** Stage the freshly created lead should start in. */
  stage?: LeadStage
}) {
  const { db } = useStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  function create() {
    const id = addLead({ name: name.trim(), phone, source: 'telefon', stage: stage ?? 'angebot' })
    onChange(id)
    setName('')
    setPhone('')
    setCreating(false)
  }

  if (!creating) {
    return (
      <div className="flex gap-2">
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1">
          <option value="">{emptyLabel}</option>
          {db.leads.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
        <Button onClick={() => setCreating(true)} className="shrink-0" title="Neuen Interessenten anlegen">
          <IconPlus />Neu
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-primary-soft/40 p-2.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name oder Firma"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            e.preventDefault()
            create()
          }
        }}
      />
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefon (optional)" inputMode="tel" />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { setCreating(false); setName(''); setPhone('') }}>Abbrechen</Button>
        <Button size="sm" variant="primary" className="flex-1" disabled={!name.trim()} onClick={create}>
          Anlegen & auswählen
        </Button>
      </div>
    </div>
  )
}
