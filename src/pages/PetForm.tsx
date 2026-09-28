import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import type { Species } from '../lib/types'
import { Chips, ErrorNote, Segmented } from '../components/ui'

export default function PetForm() {
  const { id } = useParams()
  const { petById, household, userId, reload } = useApp()
  const nav = useNavigate()
  const existing = id ? petById(id) : undefined

  const [name, setName] = useState('')
  const [species, setSpecies] = useState<Species>('dog')
  const [breed, setBreed] = useState('')
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [neutered, setNeutered] = useState<'yes' | 'no' | ''>('')
  const [birth, setBirth] = useState('')
  const [chip, setChip] = useState('')
  const [vet, setVet] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    setName(existing.name); setSpecies(existing.species); setBreed(existing.breed ?? '')
    setSex(existing.sex ?? ''); setNeutered(existing.neutered == null ? '' : existing.neutered ? 'yes' : 'no')
    setBirth(existing.birth_date ?? ''); setChip(existing.microchip ?? ''); setVet(existing.vet_name ?? ''); setNotes(existing.notes ?? '')
  }, [existing])

  if (id && existing && existing.owner_id !== userId) {
    return <div className="login"><p className="note">Only the pet's owner can edit it.</p></div>
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!name.trim()) { setError('Give your pet a name.'); return }
    setBusy(true); setError(null)
    const row = {
      name: name.trim(), species, breed: breed.trim() || null, sex: sex || null,
      neutered: neutered === '' ? null : neutered === 'yes', birth_date: birth || null,
      microchip: chip.trim() || null, vet_name: vet.trim() || null, notes: notes.trim() || null
    }
    const res = existing
      ? await supabase.from('pets').update(row).eq('id', existing.id).select('id').single()
      : await supabase.from('pets').insert({ ...row, household_id: household?.id, owner_id: userId }).select('id').single()
    setBusy(false)
    if (res.error) { setError(errMsg(res.error)); return }
    await reload()
    nav(`/pets/${res.data.id}`, { replace: true })
  }

  async function remove() {
    if (!existing) return
    if (!window.confirm(`Delete ${existing.name} and all of its records? This can't be undone.`)) return
    setBusy(true)
    const { error } = await supabase.from('pets').delete().eq('id', existing.id)
    setBusy(false)
    if (error) { setError(errMsg(error)); return }
    await reload()
    nav('/pets', { replace: true })
  }

  return (
    <div className="screen">
      <form className="content" onSubmit={save} style={{ paddingBottom: 40 }}>
        <div className="topbar">
          <button type="button" onClick={() => nav(-1)}>Cancel</button>
          <h1>{existing ? `Edit ${existing.name}` : 'New pet'}</h1>
          <button type="submit" className="strong" disabled={busy}>Save</button>
        </div>

        <div className="field">
          <label htmlFor="pn">Name</label>
          <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </div>
        <div className="field">
          <span className="label">Species</span>
          <Segmented<Species> label="Species" value={species} onChange={setSpecies}
            options={[{ id: 'dog', label: 'Dog' }, { id: 'cat', label: 'Cat' }, { id: 'other', label: 'Other' }]} />
        </div>
        <div className="field">
          <label htmlFor="pb">Breed <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label>
          <input id="pb" className="input" value={breed} onChange={(e) => setBreed(e.target.value)} />
        </div>
        <div className="grid2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="pd">Birth date</label>
            <input id="pd" className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pm">Microchip</label>
            <input id="pm" className="input" inputMode="numeric" value={chip} onChange={(e) => setChip(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span className="label">Sex</span>
          <Chips<'male' | 'female' | ''> label="Sex" value={sex} onChange={setSex}
            options={[{ id: 'male', label: 'Male' }, { id: 'female', label: 'Female' }, { id: '', label: 'Not set' }]} />
        </div>
        <div className="field">
          <span className="label">Neutered</span>
          <Chips<'yes' | 'no' | ''> label="Neutered" value={neutered} onChange={setNeutered}
            options={[{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }, { id: '', label: 'Not set' }]} />
        </div>
        <div className="field">
          <label htmlFor="pv">Vet clinic</label>
          <input id="pv" className="input" value={vet} onChange={(e) => setVet(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pno">Notes</label>
          <textarea id="pno" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <ErrorNote msg={error} />
        <button className="btn block" type="submit" disabled={busy}>{existing ? 'Save changes' : 'Add pet'}</button>
        {existing && <button type="button" className="btn danger block" onClick={remove} disabled={busy}>Delete pet</button>}
      </form>
    </div>
  )
}
