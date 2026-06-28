import { useState } from 'react'
import LeadFeed from './LeadFeed.jsx'
import CampaignBuilder from './CampaignBuilder.jsx'

const TABS = ['Leads', 'SMS Campaign', 'Email Campaign', 'Reactivation']

export default function Dashboard({ token, onLogout }) {
  const [tab, setTab] = useState('Leads')

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950 px-5 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-base tracking-tight">Marketing Hub</h1>
          <p className="text-xs text-neutral-500">GHL · Meta · Claude</p>
        </div>
        <button
          onClick={onLogout}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Sign out
        </button>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 px-4 pt-4 pb-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t
                ? 'bg-violet-600 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 p-4 max-w-3xl w-full mx-auto">
        {tab === 'Leads' && <LeadFeed token={token} />}
        {tab === 'SMS Campaign' && <CampaignBuilder token={token} mode="sms" />}
        {tab === 'Email Campaign' && <CampaignBuilder token={token} mode="email" />}
        {tab === 'Reactivation' && <CampaignBuilder token={token} mode="reactivation" />}
      </main>
    </div>
  )
}
