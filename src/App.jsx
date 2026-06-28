import { useState } from 'react'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('mh_token') || '')

  function handleLogin(t) {
    sessionStorage.setItem('mh_token', t)
    setToken(t)
  }

  function handleLogout() {
    sessionStorage.removeItem('mh_token')
    setToken('')
  }

  if (!token) return <Login onLogin={handleLogin} />
  return <Dashboard token={token} onLogout={handleLogout} />
}
