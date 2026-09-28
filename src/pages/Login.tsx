import { useState, type FormEvent } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { IconPaw } from '../components/icons'
import { ErrorNote } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setInfo(null)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() } }
        })
        if (error) throw error
        if (!data.session) setInfo('Account created. Check your email to confirm it, then sign in.')
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    if (!email.trim()) { setError('Type your email first.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.href.split('#')[0] })
    setBusy(false)
    if (error) setError(errMsg(error))
    else setInfo('If that email has an account, a reset link is on its way.')
  }

  return (
    <div className="login">
      <div className="brand">
        <div className="brand-mark"><IconPaw size={28} /></div>
        <div>
          <h1 className="title" style={{ fontSize: 32 }}>OurPets</h1>
          <div className="sub">Meds, food and vet visits in one place</div>
        </div>
      </div>

      <form className="stack" onSubmit={submit}>
        {mode === 'up' && (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required />
        </div>
        <ErrorNote msg={error} />
        {info && <p className="note">{info}</p>}
        <button className="btn block" type="submit" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
      </form>

      <div className="row between">
        <button className="link-btn" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); setInfo(null) }}>
          {mode === 'in' ? 'Create an account' : 'I already have an account'}
        </button>
        {mode === 'in' && <button className="link-btn" onClick={forgot}>Forgot password?</button>}
      </div>
    </div>
  )
}
