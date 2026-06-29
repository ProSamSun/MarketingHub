import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard, Users, Workflow as WorkflowIcon, Kanban, Megaphone,
  Inbox as InboxIcon, LogOut, Sparkles, Plus, Settings as SettingsIcon,
} from 'lucide-react'
import { makeApi } from '../lib/api.js'
import { Loading } from '../lib/ui.jsx'
import CommandBar from './CommandBar.jsx'
import OnboardClient from './OnboardClient.jsx'

// Code-split each module so the initial bundle stays small
const AnalyticsHome = lazy(() => import('./modules/AnalyticsHome.jsx'))
const Contacts      = lazy(() => import('./modules/Contacts.jsx'))
const Workflows     = lazy(() => import('./modules/Workflows.jsx'))
const Pipeline      = lazy(() => import('./modules/Pipeline.jsx'))
const Campaigns     = lazy(() => import('./modules/Campaigns.jsx'))
const Inbox         = lazy(() => import('./modules/Inbox.jsx'))
const Settings      = lazy(() => import('./modules/Settings.jsx'))

const NAV = [
  { key: 'analytics', label: 'Home',      icon: LayoutDashboard },
  { key: 'contacts',  label: 'Contacts',  icon: Users },
  { key: 'workflows', label: 'Workflows', icon: WorkflowIcon },
  { key: 'pipeline',  label: 'Pipeline',  icon: Kanban },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'inbox',     label: 'Inbox',     icon: InboxIcon },
]

export default function Dashboard({ token, onLogout }) {
  const [tab, setTab]           = useState('analytics')
  const [cmdOpen, setCmdOpen]   = useState(false)
  const [pending, setPending]   = useState({})
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('mh_client') || '')
  const [clients, setClients]   = useState([])
  const [onboardOpen, setOnboardOpen] = useState(false)
  const api = useMemo(() => makeApi(token, clientId), [token, clientId])

  const loadClients = useCallback(async () => {
    try {
      const data = await makeApi(token).get('/api/clients')
      const list = data.clients || []
      setClients(list)
      setClientId(prev => {
        if (prev && list.some(c => c.id === prev)) return prev
        const def = list.find(c => c.slug === 'default') || list[0]
        const id = def?.id || ''
        if (id) sessionStorage.setItem('mh_client', id)
        return id
      })
    } catch { /* falls back to server's default */ }
  }, [token])

  useEffect(() => { loadClients() }, [loadClients])

  function selectClient(id) {
    setClientId(id)
    if (id) sessionStorage.setItem('mh_client', id)
    setPending({})
  }

  function handleClientCreated(client) {
    setClients(cs => [...cs.filter(c => c.id !== client.id), client])
    selectClient(client.id)
    setTab('analytics')
    loadClients()
  }

  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen(o => !o)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  function routeIntent(intent) {
    switch (intent?.action) {
      case 'create_workflow':
        setPending(p => ({ ...p, workflows: { description: intent.description || '' } }))
        setTab('workflows')
        break
      case 'campaign':
        setPending(p => ({ ...p, campaigns: {
          campaignType: intent.campaignType, businessName: intent.businessName,
          offer: intent.offer, tone: intent.tone, tag: intent.tag,
        } }))
        setTab('campaigns')
        break
      case 'search_contacts':
        setPending(p => ({ ...p, contacts: { search: intent.search || '', tag: intent.tag || '' } }))
        setTab('contacts')
        break
      case 'navigate':
        if (intent.destination && NAV.some(n => n.key === intent.destination)) setTab(intent.destination)
        break
      default:
        break
    }
    setCmdOpen(false)
  }

  const consume      = key => setPending(p => (p[key] === undefined ? p : { ...p, [key]: undefined }))
  const moduleProps  = key => ({ api, pending: pending[key], onPendingConsumed: () => consume(key) })

  return (
    <div className="min-h-dvh md:flex">

      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden md:flex md:flex-col md:w-56 shrink-0 border-r border-neutral-800 bg-neutral-950 sticky top-0 h-dvh">
        <div className="px-4 py-4 flex flex-col gap-3 border-b border-neutral-800">
          {/* Scale or Die logo */}
          <div className="flex items-center gap-2.5 px-1">
            <img src="/logo-mark.png" alt="Scale or Die" className="h-8 w-8 object-contain"
                 onError={e => { e.target.style.display = 'none' }} />
            <div>
              <div className="font-bold text-sm leading-tight tracking-tight">Scale or Die</div>
              <div className="text-[10px] leading-tight" style={{ color: '#cc0000' }}>ScaleOrDie Workflows</div>
            </div>
          </div>
          <ClientSwitcher clients={clients} value={clientId} onChange={selectClient} onOnboard={() => setOnboardOpen(true)} />
        </div>

        <nav className="flex-1 px-3 pt-3 flex flex-col gap-1">
          {NAV.map(n => (
            <NavItem key={n.key} item={n} active={tab === n.key} onClick={() => setTab(n.key)} />
          ))}
        </nav>

        <div className="p-3 flex flex-col gap-1 border-t border-neutral-800">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={16} style={{ color: '#cc0000' }} /> Ask AI
            </span>
            <kbd className="text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
          <button
            onClick={() => setTab('settings')}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors"
            style={tab === 'settings'
              ? { background: '#cc0000', color: '#fff' }
              : { color: '#737373' }}
          >
            <SettingsIcon size={16} /> Settings
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900 transition-colors"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ──────────────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <img src="/logo-mark.png" alt="Scale or Die" className="h-7 w-7 object-contain shrink-0"
               onError={e => { e.target.style.display = 'none' }} />
          <select
            value={clientId}
            onChange={e => selectClient(e.target.value)}
            aria-label="Active client"
            className="min-w-0 max-w-[55vw] bg-transparent text-sm font-semibold text-neutral-100 outline-none truncate"
          >
            {clients.length === 0 && <option value="">Scale or Die</option>}
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setOnboardOpen(true)} className="p-2 hover:text-neutral-100 transition-colors" style={{ color: '#cc0000' }} aria-label="Onboard client"><Plus size={18} /></button>
          <button onClick={() => setCmdOpen(true)}     className="p-2 hover:text-neutral-100 transition-colors" style={{ color: '#cc0000' }} aria-label="Ask AI"><Sparkles size={18} /></button>
          <button onClick={() => setTab('settings')}   className="p-2 text-neutral-400 hover:text-neutral-200" aria-label="Settings"><SettingsIcon size={18} /></button>
          <button onClick={onLogout}                   className="p-2 text-neutral-500 hover:text-neutral-300" aria-label="Sign out"><LogOut size={18} /></button>
        </div>
      </header>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        <div className="max-w-5xl mx-auto w-full p-4 sm:p-6 pb-28 md:pb-10">
          <Suspense key={clientId} fallback={<Loading />}>
            {tab === 'analytics' && <AnalyticsHome {...moduleProps('analytics')} onNavigate={setTab} />}
            {tab === 'contacts'  && <Contacts  {...moduleProps('contacts')} />}
            {tab === 'workflows' && <Workflows {...moduleProps('workflows')} />}
            {tab === 'pipeline'  && <Pipeline  {...moduleProps('pipeline')} />}
            {tab === 'campaigns' && <Campaigns {...moduleProps('campaigns')} />}
            {tab === 'inbox'     && <Inbox     {...moduleProps('inbox')} />}
            {tab === 'settings'  && <Settings  api={api} client={clients.find(c => c.id === clientId)} onSaved={loadClients} />}
          </Suspense>
        </div>
      </main>

      {/* ── Mobile bottom nav ──────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-6 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
        {NAV.map(n => {
          const Icon = n.icon
          const active = tab === n.key
          return (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className="flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors"
              style={{ color: active ? '#cc0000' : '#737373' }}
            >
              <Icon size={20} />
              {n.label}
            </button>
          )
        })}
      </nav>

      <CommandBar  api={api} open={cmdOpen}     onClose={() => setCmdOpen(false)}   onRoute={routeIntent} />
      <OnboardClient api={api} open={onboardOpen} onClose={() => setOnboardOpen(false)} onCreated={handleClientCreated} />
    </div>
  )
}

function ClientSwitcher({ clients, value, onChange, onOnboard }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-neutral-600 px-1">Client</span>
      <div className="flex gap-1.5">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-label="Active client"
          className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-2 text-sm text-neutral-100 outline-none focus:border-red-600 transition-colors truncate"
        >
          {clients.length === 0 && <option value="">Loading…</option>}
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={onOnboard}
          title="Onboard client"
          aria-label="Onboard client"
          className="px-2.5 rounded-lg text-white transition-colors shrink-0"
          style={{ background: '#cc0000' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#aa0000' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#cc0000' }}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

function NavItem({ item, active, onClick }) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
      style={active
        ? { background: '#cc0000', color: '#fff' }
        : { color: '#737373' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#f2f2f2' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#737373' }}
    >
      <Icon size={18} />
      {item.label}
    </button>
  )
}
