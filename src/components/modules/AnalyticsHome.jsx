import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, Users, DollarSign, Send, Workflow,
  Megaphone, Kanban, ArrowRight, BarChart3, TrendingUp,
} from 'lucide-react'
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Card, IconButton, Button, Loading, Banner, EmptyState, StatCard,
} from '../../lib/ui.jsx'
import { currency, compactNumber, shortDate } from '../../lib/format.js'

const EMPTY = {
  contacts: { total: 0, new_7d: 0, new_30d: 0 },
  deals: { total: 0, total_value: 0, won: 0 },
  messages: { total: 0, sms: 0, email: 0, sent_7d: 0 },
  workflows: { total: 0, active: 0 },
  leadsPerDay: [],
  topSources: [],
  pipeline: [],
}

export default function AnalyticsHome({ api, pending, onPendingConsumed, onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/analytics')
      setData(res)
    } catch (e) {
      setError(e.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // `pending` is unused for this module — consume it so it does not linger.
  useEffect(() => {
    if (pending !== undefined) onPendingConsumed?.()
  }, [pending, onPendingConsumed])

  const d = { ...EMPTY, ...(data || {}) }
  const contacts = { ...EMPTY.contacts, ...(d.contacts || {}) }
  const deals = { ...EMPTY.deals, ...(d.deals || {}) }
  const messages = { ...EMPTY.messages, ...(d.messages || {}) }
  const workflows = { ...EMPTY.workflows, ...(d.workflows || {}) }
  const leadsPerDay = Array.isArray(d.leadsPerDay) ? d.leadsPerDay : []
  const topSources = Array.isArray(d.topSources) ? d.topSources : []
  const pipeline = Array.isArray(d.pipeline) ? d.pipeline : []

  const maxDeals = pipeline.reduce((m, s) => Math.max(m, Number(s.deals || 0)), 0)
  const maxSource = topSources.reduce((m, s) => Math.max(m, Number(s.count || 0)), 0)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Overview</h2>
          <p className="text-sm text-neutral-500 mt-0.5">Your CRM at a glance</p>
        </div>
        <IconButton
          icon={RefreshCw}
          label="Refresh"
          onClick={load}
          className={loading ? 'opacity-60' : ''}
        />
      </div>

      {error && (
        <Banner type="error" onClose={() => setError('')}>
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={load} className="font-semibold underline shrink-0">Retry</button>
          </div>
        </Banner>
      )}

      {loading && !data ? (
        <Loading label="Loading analytics…" />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={Users}
              label="Total Contacts"
              value={compactNumber(contacts.total)}
              sub={`+${compactNumber(contacts.new_7d)} this week`}
            />
            <StatCard
              icon={DollarSign}
              label="Pipeline Value"
              value={currency(deals.total_value)}
              sub={`${deals.won} won / ${deals.total} deals`}
            />
            <StatCard
              icon={Send}
              label="Messages Sent"
              value={compactNumber(messages.total)}
              sub={`${compactNumber(messages.sent_7d)} this week`}
            />
            <StatCard
              icon={Workflow}
              label="Active Workflows"
              value={compactNumber(workflows.active)}
              sub={`of ${workflows.total} total`}
            />
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Megaphone} onClick={() => onNavigate?.('campaigns')}>
              New campaign
            </Button>
            <Button variant="ghost" icon={Users} onClick={() => onNavigate?.('contacts')}>
              Contacts
            </Button>
            <Button variant="ghost" icon={Kanban} onClick={() => onNavigate?.('pipeline')}>
              Pipeline
            </Button>
            <Button variant="ghost" icon={Workflow} onClick={() => onNavigate?.('workflows')}>
              Workflows
            </Button>
          </div>

          {/* Leads per day chart */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp size={15} className="text-red-500" /> Leads per day
              </h3>
              <span className="text-xs text-neutral-500">Last {leadsPerDay.length} days</span>
            </div>
            {leadsPerDay.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No lead activity yet"
                hint="New contacts will appear here as they come in."
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={leadsPerDay} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#cc0000" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#cc0000" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#262626" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={shortDate}
                    tick={{ fill: '#737373', fontSize: 11 }}
                    axisLine={{ stroke: '#262626' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#737373', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    labelFormatter={shortDate}
                    contentStyle={{
                      background: '#171717',
                      border: '1px solid #404040',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#e5e5e5',
                    }}
                    labelStyle={{ color: '#a3a3a3' }}
                    itemStyle={{ color: '#e5e5e5' }}
                    cursor={{ stroke: '#404040' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Leads"
                    stroke="#cc0000"
                    strokeWidth={2}
                    fill="url(#leadsFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pipeline funnel */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Kanban size={15} className="text-red-500" /> Pipeline
                </h3>
                <button
                  onClick={() => onNavigate?.('pipeline')}
                  className="text-xs text-neutral-500 hover:text-neutral-200 inline-flex items-center gap-1 transition-colors"
                >
                  View <ArrowRight size={12} />
                </button>
              </div>
              {pipeline.length === 0 ? (
                <EmptyState
                  icon={Kanban}
                  title="No pipeline stages"
                  hint="Add deals to see your funnel here."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {pipeline.map((s, i) => {
                    const count = Number(s.deals || 0)
                    const pct = maxDeals > 0 ? Math.max((count / maxDeals) * 100, count > 0 ? 6 : 0) : 0
                    const color = s.color || '#cc0000'
                    return (
                      <div key={s.name ?? i} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-neutral-300 truncate">{s.name}</span>
                          <span className="text-neutral-500 shrink-0 ml-2">
                            {count} {count === 1 ? 'deal' : 'deals'} · {currency(s.value)}
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-neutral-800 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: maxDeals > 0 ? `${pct}%` : '100%',
                              backgroundColor: maxDeals > 0 ? color : '#404040',
                              opacity: maxDeals > 0 ? 1 : 0.4,
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {maxDeals === 0 && (
                    <p className="text-xs text-neutral-600 mt-1">No deals in any stage yet.</p>
                  )}
                </div>
              )}
            </Card>

            {/* Top sources */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users size={15} className="text-red-500" /> Top Sources
                </h3>
              </div>
              {topSources.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No sources yet"
                  hint="Contact sources will show up here."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {topSources.map((s, i) => {
                    const count = Number(s.count || 0)
                    const pct = maxSource > 0 ? Math.max((count / maxSource) * 100, 6) : 0
                    return (
                      <div key={s.source ?? i} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-neutral-300 truncate capitalize">
                            {s.source || 'Unknown'}
                          </span>
                          <span className="shrink-0 bg-neutral-800 text-neutral-300 rounded-full px-2 py-0.5 text-[11px] font-medium">
                            {compactNumber(count)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-red-700/70 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
