import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from './lib/store'
import { Loading } from './components/ui'
import Login from './pages/Login'
import Today from './pages/Today'
import Pets from './pages/Pets'
import PetForm from './pages/PetForm'
import PetDetail from './pages/PetDetail'
import Stock from './pages/Stock'
import StockForm from './pages/StockForm'
import Shop from './pages/Shop'
import Profile from './pages/Profile'
import Join from './pages/Join'
import Costs from './pages/Costs'

export default function App() {
  const { authReady, session } = useApp()
  const loc = useLocation()
  const nav = useNavigate()

  // After signing in from an invite link, continue to the join screen
  useEffect(() => {
    if (!session) return
    let code: string | null = null
    try { code = localStorage.getItem('ourpets.pendingInvite') } catch { /* ignore */ }
    if (code && !loc.pathname.startsWith('/join/')) nav(`/join/${code}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  if (!authReady) return <Loading />

  if (!session) {
    // Remember an invite link so it still works after signing in
    const m = loc.pathname.match(/^\/join\/([a-z0-9]+)/i)
    if (m) {
      try { localStorage.setItem('ourpets.pendingInvite', m[1]) } catch { /* storage unavailable */ }
    }
    return <Login />
  }

  return (
    <Routes>
      <Route path="/" element={<Today />} />
      <Route path="/pets" element={<Pets />} />
      <Route path="/pets/new" element={<PetForm />} />
      <Route path="/pets/:id" element={<PetDetail />} />
      <Route path="/pets/:id/edit" element={<PetForm />} />
      <Route path="/stock" element={<Stock />} />
      <Route path="/stock/new" element={<StockForm />} />
      <Route path="/stock/:id" element={<StockForm />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/costs" element={<Costs />} />
      <Route path="/join/:code" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
