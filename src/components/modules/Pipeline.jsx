import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2, Kanban } from 'lucide-react'
import {
  Card, Button, IconButton, Field, Loading, EmptyState, Banner, Modal, inputCls,
} from '../../lib/ui.jsx'
import { fullName, currency, shortDate } from '../../lib/format.js'

const EMPTY_FORM = { title: '', value: '', stageId: '', contactId: '', notes: '' }

export default function Pipeline({ api, pending, onPendingConsumed }) {
  const [data, setData] = useState({ stages: [], deals: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // drag state
  const [dragDealId, setDragDealId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  // add-deal modal
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [contacts, setContacts] = useState([])
  const [contactsLoaded, setContactsLoaded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/pipeline')
      const stages = (res.stages || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))
      setData({ stages, deals: res.deals || [] })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // `pending` is unused for this module — consume it so it doesn't linger.
  useEffect(() => {
    if (pending) onPendingConsumed?.()
  }, [pending, onPendingConsumed])

  // ── Move a deal to another stage (optimistic, revert on error) ──────────────
  async function moveDeal(dealId, stageId) {
    const deal = data.deals.find(d => d.id === dealId)
    if (!deal || deal.stage_id === stageId) return
    const prevStage = deal.stage_id
    setData(d => ({
      ...d,
      deals: d.deals.map(x => (x.id === dealId ? { ...x, stage_id: stageId } : x)),
    }))
    try {
      await api.put('/api/pipeline', { id: dealId, stageId })
    } catch (e) {
      setData(d => ({
        ...d,
        deals: d.deals.map(x => (x.id === dealId ? { ...x, stage_id: prevStage } : x)),
      }))
      setError(e.message)
    }
  }

  async function deleteDeal(id) {
    if (!window.confirm('Delete this deal? This cannot be undone.')) return
    try {
      await api.del('/api/pipeline', { id })
      setData(d => ({ ...d, deals: d.deals.filter(x => x.id !== id) }))
    } catch (e) {
      setError(e.message)
    }
  }

  // ── Add-deal modal ──────────────────────────────────────────────────────────
  async function loadContacts() {
    try {
      const res = await api.get('/api/contacts', { limit: 500 })
      setContacts(res.contacts || [])
      setContactsLoaded(true)
    } catch {
      // non-fatal — the contact picker just stays empty
      setContactsLoaded(true)
    }
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM, stageId: data.stages[0]?.id ?? '' })
    setFormError('')
    setAddOpen(true)
    if (!contactsLoaded) loadContacts()
  }

  async function submitDeal(e) {
    e.preventDefault()
    if (!form.title.trim()) {
      setFormError('Title is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const stage = data.stages.find(s => String(s.id) === String(form.stageId))
      const contact = contacts.find(c => String(c.id) === String(form.contactId))
      await api.post('/api/pipeline', {
        title: form.title.trim(),
        value: Number(form.value) || 0,
        stageId: stage ? stage.id : form.stageId || undefined,
        contactId: contact ? contact.id : undefined,
        notes: form.notes.trim() || undefined,
      })
      setAddOpen(false)
      await load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const { stages, deals } = data

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">Pipeline</h2>
        <div className="flex items-center gap-2">
          <IconButton icon={RefreshCw} label="Refresh" onClick={load} disabled={loading} />
          <Button icon={Plus} onClick={openAdd} disabled={!stages.length && !loading}>
            Add Deal
          </Button>
        </div>
      </div>

      {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}

      {loading ? (
        <Loading label="Loading pipeline…" />
      ) : stages.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Kanban}
            title="No pipeline stages yet"
            hint="Stages define the columns of your board. Once they exist, add deals to start tracking."
          />
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {stages.map(stage => {
            const stageDeals = deals.filter(d => d.stage_id === stage.id)
            const total = stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0)
            const over = dragOverStage === stage.id
            return (
              <div
                key={stage.id}
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverStage !== stage.id) setDragOverStage(stage.id)
                }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragOverStage(s => (s === stage.id ? null : s))
                  }
                }}
                onDrop={e => {
                  e.preventDefault()
                  const id = dragDealId
                  setDragOverStage(null)
                  setDragDealId(null)
                  if (id != null) moveDeal(id, stage.id)
                }}
                className={`flex flex-col w-[280px] min-w-[260px] shrink-0 rounded-xl border transition-colors ${
                  over ? 'border-red-600 bg-red-700/5' : 'border-neutral-800 bg-neutral-900'
                }`}
              >
                {/* Column header */}
                <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-neutral-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: stage.color || '#737373' }}
                    />
                    <span className="text-sm font-semibold truncate">{stage.name}</span>
                    <span className="text-xs text-neutral-500 shrink-0">{stageDeals.length}</span>
                  </div>
                  <span className="text-xs font-medium text-neutral-400 shrink-0">{currency(total)}</span>
                </div>

                {/* Column body */}
                <div className="flex flex-col gap-2 p-2 min-h-[120px]">
                  {stageDeals.length === 0 ? (
                    <p className="text-xs text-neutral-600 text-center py-6 select-none">Drop deals here</p>
                  ) : (
                    stageDeals.map(deal => {
                      const hasContact =
                        deal.first_name || deal.last_name || deal.email || deal.phone
                      const name = hasContact ? fullName(deal) : deal.title || 'Untitled deal'
                      return (
                        <div
                          key={deal.id}
                          draggable
                          onDragStart={e => {
                            setDragDealId(deal.id)
                            e.dataTransfer.effectAllowed = 'move'
                            try { e.dataTransfer.setData('text/plain', String(deal.id)) } catch { /* noop */ }
                          }}
                          onDragEnd={() => {
                            setDragDealId(null)
                            setDragOverStage(null)
                          }}
                          className={`group bg-neutral-950 border border-neutral-800 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-opacity ${
                            dragDealId === deal.id ? 'opacity-50' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-neutral-100 truncate">{name}</p>
                            <button
                              type="button"
                              onClick={() => deleteDeal(deal.id)}
                              aria-label="Delete deal"
                              title="Delete deal"
                              className="text-neutral-600 hover:text-red-400 transition-colors shrink-0 -mr-1 -mt-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {hasContact && deal.title && (
                            <p className="text-xs text-neutral-500 truncate mt-0.5">{deal.title}</p>
                          )}

                          <div className="flex items-center justify-between gap-2 mt-2">
                            <span className="text-sm font-semibold text-red-400">{currency(deal.value)}</span>
                            <span className="text-[11px] text-neutral-600">{shortDate(deal.created_at)}</span>
                          </div>

                          {/* Mobile / touch fallback: move via select */}
                          <div
                            className="mt-2.5"
                            draggable={false}
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                          >
                            <select
                              value={String(deal.stage_id)}
                              onChange={e => {
                                const target = stages.find(s => String(s.id) === e.target.value)
                                if (target) moveDeal(deal.id, target.id)
                              }}
                              aria-label="Move deal to stage"
                              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs text-neutral-400 outline-none focus:border-red-600 transition-colors"
                            >
                              {stages.map(s => (
                                <option key={s.id} value={String(s.id)}>
                                  Move to: {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add-deal modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Deal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" form="add-deal-form" loading={saving}>Add Deal</Button>
          </>
        }
      >
        <form id="add-deal-form" onSubmit={submitDeal} className="flex flex-col gap-4">
          {formError && <Banner type="error" onClose={() => setFormError('')}>{formError}</Banner>}

          <Field label="Title" required>
            <input
              className={inputCls}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Website redesign"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Value">
              <input
                type="number"
                min="0"
                step="any"
                className={inputCls}
                value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                placeholder="0"
              />
            </Field>

            <Field label="Stage">
              <select
                className={inputCls}
                value={String(form.stageId)}
                onChange={e => setForm(f => ({ ...f, stageId: e.target.value }))}
              >
                {stages.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Contact" hint={contactsLoaded ? undefined : 'Loading contacts…'}>
            <select
              className={inputCls}
              value={String(form.contactId)}
              onChange={e => setForm(f => ({ ...f, contactId: e.target.value }))}
            >
              <option value="">— No contact —</option>
              {contacts.map(c => (
                <option key={c.id} value={String(c.id)}>{fullName(c)}</option>
              ))}
            </select>
          </Field>

          <Field label="Notes">
            <textarea
              className={inputCls}
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional context about this deal…"
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
