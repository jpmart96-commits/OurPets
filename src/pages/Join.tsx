import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { useApp } from '../lib/store'
import { ErrorNote, Screen } from '../components/ui'

export default function Join() {
  const { code } = useParams()
  const { reload, pets, userId } = useApp()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const myPets = pets.filter((p) => p.owner_id === userId)

  useEffect(() => {
    try { localStorage.removeItem('ourpets.pendingInvite') } catch { /* ignore */ }
  }, [])

  async function accept() {
    setBusy(true); setError(null)
    const { error } = await supabase.rpc('accept_invite', { p_code: code })
    setBusy(false)
    if (error) { setError(errMsg(error)); return }
    await reload()
    nav('/', { replace: true })
  }

  return (
    <Screen tabs={false}>
      <h1 className="title">Join a household</h1>
      <p className="hint" style={{ fontSize: 15 }}>
        You've been invited to share a home in OurPets. You'll see each other's pets, and each of you still logs care only for your own.
        {myPets.length > 0 && ` Your ${myPets.length === 1 ? 'pet comes' : `${myPets.length} pets come`} with you, along with their stock.`}
      </p>
      <ErrorNote msg={error} />
      <button className="btn block" onClick={accept} disabled={busy}>Join household</button>
      <button className="btn ghost block" onClick={() => nav('/', { replace: true })}>Not now</button>
    </Screen>
  )
}
