import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard, Users, Workflow as WorkflowIcon, Kanban, Megaphone,
  Inbox as InboxIcon, LogOut, Sparkles,
} from 'lucide-react'
import { makeApi } from '../lib/api.js'
import { Loading } from '../lib/ui.jsx'
import CommandBar from './CommandBar.jsx'

// Code-split each module so the initial bundle stays small (recharts etc. load on demand)
const AnalyticsHome = lazy(() => import('./modules/AnalyticsHome.jsx'))
const Contacts = lazy(() => import('./modules/Contacts.jsx'))
const Workflows = lazy(() => import('./modules/Workflows.jsx'))
const Pipeline = lazy(() => import('./modules/Pipeline.jsx'))
const Campaigns = lazy(() => import('./modules/Campaigns.jsx'))
const Inbox = lazy(() => import('./modules/Inbox.jsx'))

const NAV = [
  { key: 'analytics', label: 'Home',      icon: LayoutDashboard },
  { key: 'contacts',  label: 'Contacts',  icon: Users },
  { key: 'workflows', label: 'Workflows', icon: WorkflowIcon },
  { key: 'pipeline',  label: 'Pipeline',  icon: Kanban },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'inbox',     label: 'Inbox',     icon: InboxIcon },
]

export default function Dashboard({ token, onLogout }) {
  const api = useMemo(() => makeApi(token), [token])
  const [tab, setTab] = useState('analytics')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [pending, setPending] = useState({}) // per-module routing payloads from the command bar

  // ⌘K / Ctrl+K toggles the command bar
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

  const consume = key => setPending(p => (p[key] === undefined ? p : { ...p, [key]: undefined }))

  const moduleProps = key => ({ api, pending: pending[key], onPendingConsumed: () => consume(key) })

  return (
    <div className="min-h-dvh md:flex">
      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside className="hidden md:flex md:flex-col md:w-56 shrink-0 border-r border-neutral-800 bg-neutral-950 sticky top-0 h-dvh">
        <div className="px-5 py-5">
          <h1 className="font-bold tracking-tight flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-violet-600 text-white text-sm">M</span>
            Marketing Hub
          </h1>
        </div>

        <nav className="flex-1 px-3 flex flex-col gap-1">
          {NAV.map(n => (
            <NavItem key={n.key} item={n} active={tab === n.key} onClick={() => setTab(n.key)} />
          ))}
        </nav>

        <div className="p-3 flex flex-col gap-1 border-t border-neutral-800">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition-colors"
          >
            <span className="flex items-center gap-2"><Sparkles size={16} className="text-violet-400" /> Ask AI</span>
            <kbd className="text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900 transition-colors"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ──────────────────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
        <h1 className="font-bold text-sm tracking-tight flex items-center gap-2">
          <span className="grid place-items-center w-6 h-6 rounded-md bg-violet-600 text-white text-xs">M</span>
          Marketing Hub
        </h1>
        <div className="flex items-center gap-1">
          <button onClick={() => setCmdOpen(true)} className="p-2 text-violet-400 hover:text-violet-300" aria-label="Ask AI"><Sparkles size={18} /></button>
          <button onClick={onLogout} className="p-2 text-neutral-500 hover:text-neutral-300" aria-label="Sign out"><LogOut size={18} /></button>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        <div className="max-w-5xl mx-auto w-full p-4 sm:p-6 pb-28 md:pb-10">
          <Suspense fallback={<Loading />}>
            {tab === 'analytics' && <AnalyticsHome {...moduleProps('analytics')} onNavigate={setTab} />}
            {tab === 'contacts'  && <Contacts  {...moduleProps('contacts')} />}
            {tab === 'workflows' && <Workflows {...moduleProps('workflows')} />}
            {tab === 'pipeline'  && <Pipeline  {...moduleProps('pipeline')} />}
            {tab === 'campaigns' && <Campaigns {...moduleProps('campaigns')} />}
            {tab === 'inbox'     && <Inbox     {...moduleProps('inbox')} />}
          </Suspense>
        </div>
      </main>

      {/* ── Mobile bottom nav ──────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-6 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
        {NAV.map(n => {
          const Icon = n.icon
          const active = tab === n.key
          return (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors ${active ? 'text-violet-400' : 'text-neutral-500'}`}
            >
              <Icon size={20} />
              {n.label}
            </button>
          )
        })}
      </nav>

      <CommandBar api={api} open={cmdOpen} onClose={() => setCmdOpen(false)} onRoute={routeIntent} />
    </div>
  )
}

function NavItem({ item, active, onClick }) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-violet-600 text-white' : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900'
      }`}
    >
      <Icon size={18} />
      {item.label}
    </button>
  )
}
