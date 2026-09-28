import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import type { Species } from '../lib/types'
import { removePhoto, uploadPhoto } from '../lib/photos'
import { Chips, ErrorNote, PhotoPicker, Segmented, useGoBack } from '../components/ui'

export default function PetForm() {
  const { id } = useParams()
  const { petById, household, userId, reload, photoUrl } = useApp()
  const nav = useNavigate()
  const goBack = useGoBack('/pets')
  const existing = id ? petById(id) : undefined

  const [name, setName] = useState('')
  const [species, setSpecies] = useState<Species>('dog')
  const [breed, setBreed] = useState('')
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [neutered, setNeutered] = useState<'yes' | 'no' | ''>('')
  const [birth, setBirth] = useState('')
  const [chip, setChip] = useState('')
  const [vet, setVet] = useState('')
  const [em, setEm] = useState({ vet_phone: '', vet_address: '', er_vet_name: '', er_vet_phone: '', allergies: '', conditions: '', insurance: '' })
  const setE = (k: keyof typeof em) => (e: { target: { value: string } }) => setEm((x) => ({ ...x, [k]: e.target.value }))
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [dropPhoto, setDropPhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    setName(existing.name); setSpecies(existing.species); setBreed(existing.breed ?? '')
    setSex(existing.sex ?? ''); setNeutered(existing.neutered == null ? '' : existing.neutered ? 'yes' : 'no')
    setBirth(existing.birth_date ?? ''); setChip(existing.microchip ?? ''); setVet(existing.vet_name ?? ''); setNotes(existing.notes ?? '')
    setEm({
      vet_phone: existing.vet_phone ?? '', vet_address: existing.vet_address ?? '', er_vet_name: existing.er_vet_name ?? '',
      er_vet_phone: existing.er_vet_phone ?? '', allergies: existing.allergies ?? '', conditions: existing.conditions ?? '', insurance: existing.insurance ?? ''
    })
  }, [existing])

  if (id && existing && existing.owner_id !== userId) {
    return <div className="login"><p className="note">Only the pet's owner can edit it.</p></div>
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!name.trim()) { setError('Give your pet a name.'); return }
    setBusy(true); setError(null)
    let photo_path = existing?.photo_path ?? null
    try {
      if (photo && household) photo_path = await uploadPhoto(household.id, 'pets', photo)
      else if (dropPhoto) photo_path = null
    } catch (e) { setBusy(false); setError('Photo upload failed: ' + errMsg(e)); return }
    const row = {
      photo_path,
      name: name.trim(), species, breed: breed.trim() || null, sex: sex || null,
      neutered: neutered === '' ? null : neutered === 'yes', birth_date: birth || null,
      microchip: chip.trim() || null, vet_name: vet.trim() || null, notes: notes.trim() || null,
      ...Object.fromEntries(Object.entries(em).map(([k, v]) => [k, v.trim() || null]))
    }
    const res = existing
      ? await supabase.from('pets').update(row).eq('id', existing.id).select('id').single()
      : await supabase.from('pets').insert({ ...row, household_id: household?.id, owner_id: userId }).select('id').single()
    setBusy(false)
    if (res.error) { setError(errMsg(res.error)); return }
    if (existing?.photo_path && existing.photo_path !== photo_path) void removePhoto(existing.photo_path)
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
          <button type="button" onClick={() => goBack()}>Cancel</button>
          <h1>{existing ? `Edit ${existing.name}` : 'New pet'}</h1>
          <button type="submit" className="strong" disabled={busy}>Save</button>
        </div>

        <PhotoPicker label="Pet photo" file={photo} current={dropPhoto ? undefined : photoUrl(existing?.photo_path)}
          onFile={(f) => { setPhoto(f); setDropPhoto(false) }} onRemove={() => { setPhoto(null); setDropPhoto(true) }}
          fallback={name ? name.slice(0, 1).toUpperCase() : undefined} />

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
        <div className="field">
          <label htmlFor="pd">Birth date</label>
          <input id="pd" className="input" type="date" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pm">Microchip number</label>
          <input id="pm" className="input" inputMode="numeric" value={chip} onChange={(e) => setChip(e.target.value)} />
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

        <h2 className="section-label" style={{ marginTop: 8 }}>Health &amp; emergency</h2>
        <div className="field">
          <label htmlFor="pvp">Vet phone</label>
          <input id="pvp" className="input" type="tel" inputMode="tel" autoComplete="off" value={em.vet_phone} onChange={setE('vet_phone')} placeholder="+351 …" />
        </div>
        <div className="field">
          <label htmlFor="pva">Vet address</label>
          <input id="pva" className="input" value={em.vet_address} onChange={setE('vet_address')} />
        </div>
        <div className="field">
          <label htmlFor="pen">24-hour emergency vet</label>
          <input id="pen" className="input" value={em.er_vet_name} onChange={setE('er_vet_name')} placeholder="Name of the clinic" />
        </div>
        <div className="field">
          <label htmlFor="pep">Emergency vet phone</label>
          <input id="pep" className="input" type="tel" inputMode="tel" autoComplete="off" value={em.er_vet_phone} onChange={setE('er_vet_phone')} />
        </div>
        <div className="field">
          <label htmlFor="pal">Allergies</label>
          <input id="pal" className="input" value={em.allergies} onChange={setE('allergies')} placeholder="e.g. chicken, penicillin" />
        </div>
        <div className="field">
          <label htmlFor="pco">Conditions</label>
          <input id="pco" className="input" value={em.conditions} onChange={setE('conditions')} placeholder="e.g. hip dysplasia, thyroid" />
        </div>
        <div className="field">
          <label htmlFor="pin">Insurance</label>
          <input id="pin" className="input" value={em.insurance} onChange={setE('insurance')} placeholder="Company and policy number" />
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
