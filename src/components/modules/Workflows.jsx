import { useEffect, useState } from 'react'
import {
  Plus, RefreshCw, Pencil, Trash2, Sparkles, MessageSquare, Mail, Clock, Tag,
  ChevronUp, ChevronDown, ChevronRight, Check, Workflow as WorkflowIcon,
} from 'lucide-react'
import {
  Card, Button, IconButton, Toggle, Banner, Loading, EmptyState, Field, Modal,
  inputCls, labelCls,
} from '../../lib/ui.jsx'
import { shortDate } from '../../lib/format.js'

// ── Step type registry ────────────────────────────────────────────────────────
const STEP_TYPES = [
  { type: 'send_sms',   label: 'Send SMS',   icon: MessageSquare },
  { type: 'send_email', label: 'Send Email', icon: Mail },
  { type: 'wait',       label: 'Wait',       icon: Clock },
  { type: 'add_tag',    label: 'Add Tag',    icon: Tag },
  { type: 'remove_tag', label: 'Remove Tag', icon: Tag },
]

const stepMeta = t =>
  STEP_TYPES.find(s => s.type === t) || { type: t, label: t || 'Step', icon: ChevronRight }

function newStep(type) {
  switch (type) {
    case 'send_sms':   return { type, body: '' }
    case 'send_email': return { type, subject: '', body: '' }
    case 'wait':       return { type, days: 1, hours: 0 }
    case 'add_tag':    return { type, tag: '' }
    case 'remove_tag': return { type, tag: '' }
    default:           return { type }
  }
}

const numVal = v => {
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? 0 : Math.max(0, n)
}

export default function Workflows({ api, pending, onPendingConsumed }) {
  const [workflows, setWorkflows] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Builder state
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [wfActive, setWfActive] = useState(true)
  const [mode, setMode] = useState('manual') // 'ai' | 'manual'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState([])
  const [aiDescription, setAiDescription] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [builderError, setBuilderError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/api/workflows'),
        api.get('/api/workflows', { action: 'stats' }).catch(() => ({ stats: [] })),
      ])
      setWorkflows(listRes.workflows || [])
      const map = {}
      for (const s of (statsRes.stats || [])) map[s.workflow_id] = s
      setStats(map)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Builder helpers ──────────────────────────────────────────────────────────
  function resetBuilder() {
    setEditingId(null)
    setWfActive(true)
    setMode('manual')
    setName('')
    setDescription('')
    setSteps([])
    setAiDescription('')
    setAiLoading(false)
    setBuilderError('')
  }

  function openNew() {
    resetBuilder()
    setBuilderOpen(true)
  }

  function openEdit(wf) {
    resetBuilder()
    setEditingId(wf.id)
    setWfActive(!!wf.active)
    setName(wf.name || '')
    setDescription(wf.description || '')
    setSteps((wf.steps || []).map(s => ({ ...s })))
    setBuilderOpen(true)
  }

  async function runAiGenerate(desc) {
    const d = (desc ?? aiDescription).trim()
    if (!d) return
    setAiLoading(true)
    setBuilderError('')
    try {
      const { workflow } = await api.post('/api/workflows?action=ai', { description: d })
      if (workflow?.name) setName(workflow.name)
      if (workflow?.description) setDescription(workflow.description)
      setSteps((workflow?.steps || []).map(s => ({ ...s })))
    } catch (e) {
      setBuilderError(e.message)
    } finally {
      setAiLoading(false)
    }
  }

  // pending: { description } -> open AI builder, prefill, auto-generate once
  useEffect(() => {
    if (!pending) return
    resetBuilder()
    setMode('ai')
    setAiDescription(pending.description || '')
    setBuilderOpen(true)
    runAiGenerate(pending.description || '')
    onPendingConsumed?.()
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step mutations ───────────────────────────────────────────────────────────
  const addStep    = type      => setSteps(prev => [...prev, newStep(type)])
  const removeStep = i         => setSteps(prev => prev.filter((_, idx) => idx !== i))
  const updateStep = (i, patch) => setSteps(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const moveStep   = (i, dir)  => setSteps(prev => {
    const j = i + dir
    if (j < 0 || j >= prev.length) return prev
    const next = [...prev]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  // ── List actions ─────────────────────────────────────────────────────────────
  async function toggleActive(wf) {
    const next = !wf.active
    setWorkflows(prev => prev.map(w => (w.id === wf.id ? { ...w, active: next } : w)))
    try {
      await api.put('/api/workflows', { id: wf.id, active: next })
    } catch (e) {
      setError(e.message)
      setWorkflows(prev => prev.map(w => (w.id === wf.id ? { ...w, active: wf.active } : w)))
    }
  }

  async function handleDelete(wf) {
    if (!window.confirm(`Delete workflow "${wf.name || 'Untitled'}"? This can't be undone.`)) return
    try {
      await api.del('/api/workflows', { id: wf.id })
      setWorkflows(prev => prev.filter(w => w.id !== wf.id))
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleSave() {
    setBuilderError('')
    if (!name.trim()) { setBuilderError('Workflow name is required.'); return }
    if (!steps.length) { setBuilderError('Add at least one step before saving.'); return }
    setSaveLoading(true)
    try {
      if (editingId) {
        await api.put('/api/workflows', {
          id: editingId, name: name.trim(), description: description.trim(), steps, active: wfActive,
        })
      } else {
        await api.post('/api/workflows', {
          name: name.trim(), description: description.trim(), trigger: 'manual', steps, active: true,
        })
      }
      setBuilderOpen(false)
      await load()
    } catch (e) {
      setBuilderError(e.message)
    } finally {
      setSaveLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">Workflows</h2>
        <div className="flex items-center gap-2">
          <IconButton icon={RefreshCw} label="Refresh" onClick={load} />
          <Button icon={Plus} onClick={openNew}>New Workflow</Button>
        </div>
      </div>

      {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}

      {loading ? (
        <Loading label="Loading workflows…" />
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          hint="Automate follow-ups with SMS, email, waits and tags. Build one from scratch or describe it and let Claude draft it."
          action={<Button icon={Plus} onClick={openNew}>New Workflow</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {workflows.map(wf => {
            const count = wf.steps?.length || 0
            return (
              <Card key={wf.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm truncate">{wf.name || 'Untitled workflow'}</h3>
                    {!wf.active && (
                      <span className="text-[10px] uppercase tracking-wide text-neutral-500 border border-neutral-700 rounded px-1.5 py-0.5">
                        Paused
                      </span>
                    )}
                  </div>
                  {wf.description && (
                    <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">{wf.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[11px] text-neutral-500">
                      {count} step{count === 1 ? '' : 's'}
                    </span>
                    {count > 0 && (
                      <span className="flex items-center gap-1 text-neutral-500">
                        {(wf.steps || []).slice(0, 8).map((s, i) => {
                          const Ic = stepMeta(s.type).icon
                          return <Ic key={i} size={13} aria-label={stepMeta(s.type).label} />
                        })}
                      </span>
                    )}
                    {wf.created_at && (
                      <span className="text-[11px] text-neutral-600">· {shortDate(wf.created_at)}</span>
                    )}
                    {stats[wf.id] && stats[wf.id].total > 0 && (
                      <span className="flex items-center gap-2 text-[11px]">
                        <span className="text-neutral-600">·</span>
                        <span className="text-emerald-400">{stats[wf.id].active} active</span>
                        {stats[wf.id].completed > 0 && <span className="text-neutral-500">{stats[wf.id].completed} done</span>}
                        {stats[wf.id].replied > 0 && <span className="text-sky-400">{stats[wf.id].replied} replied</span>}
                        {stats[wf.id].error > 0 && <span className="text-red-400">{stats[wf.id].error} error</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <Toggle checked={!!wf.active} onChange={() => toggleActive(wf)} label="Active" />
                  <IconButton icon={Pencil} label="Edit" onClick={() => openEdit(wf)} />
                  <IconButton icon={Trash2} label="Delete" onClick={() => handleDelete(wf)} />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Builder Modal ───────────────────────────────────────────────────── */}
      <Modal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        wide
        title={editingId ? 'Edit workflow' : 'New workflow'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button icon={Check} loading={saveLoading} onClick={handleSave}>
              {editingId ? 'Save changes' : 'Create workflow'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {builderError && <Banner type="error" onClose={() => setBuilderError('')}>{builderError}</Banner>}

          {/* Segmented control */}
          <div className="inline-flex self-start rounded-xl bg-neutral-950 border border-neutral-700 p-1">
            <button
              type="button"
              onClick={() => setMode('ai')}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === 'ai' ? 'bg-red-700 text-white' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sparkles size={14} /> AI
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === 'manual' ? 'bg-red-700 text-white' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Manual
            </button>
          </div>

          {/* AI panel */}
          {mode === 'ai' && (
            <Card className="p-4 flex flex-col gap-3 bg-neutral-950/40">
              <Field label="Describe the automation you want">
                <textarea
                  className={inputCls}
                  rows={3}
                  value={aiDescription}
                  onChange={e => setAiDescription(e.target.value)}
                  placeholder="e.g. When a new lead comes in, text them right away, wait 2 days, then send a follow-up email."
                />
              </Field>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-neutral-500">
                  Claude drafts the steps — every step below stays editable before you save.
                </p>
                <Button
                  icon={Sparkles}
                  loading={aiLoading}
                  disabled={!aiDescription.trim()}
                  onClick={() => runAiGenerate()}
                >
                  Build with Claude
                </Button>
              </div>
            </Card>
          )}

          {/* Name + Description */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name" required>
              <input
                className={inputCls}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="New lead follow-up"
              />
            </Field>
            <Field label="Description">
              <input
                className={inputCls}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>

          {/* Steps */}
          <div className="flex flex-col gap-2">
            <span className={labelCls}>Steps{steps.length ? ` (${steps.length})` : ''}</span>

            {steps.length === 0 && (
              <p className="text-xs text-neutral-600 border border-dashed border-neutral-800 rounded-xl px-4 py-6 text-center">
                No steps yet. Add one below{mode === 'ai' ? ' or generate them with Claude.' : '.'}
              </p>
            )}

            {steps.map((step, i) => (
              <StepCard
                key={i}
                step={step}
                index={i}
                total={steps.length}
                onChange={updateStep}
                onRemove={removeStep}
                onMove={moveStep}
              />
            ))}

            <select
              value=""
              onChange={e => { if (e.target.value) addStep(e.target.value) }}
              className={`${inputCls} cursor-pointer text-neutral-400`}
            >
              <option value="">+ Add step…</option>
              {STEP_TYPES.map(s => (
                <option key={s.type} value={s.type}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Step editor card ───────────────────────────────────────────────────────────
function StepCard({ step, index, total, onChange, onRemove, onMove }) {
  const meta = stepMeta(step.type)
  const Icon = meta.icon
  return (
    <Card className="p-3 flex flex-col gap-2 bg-neutral-950/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center w-6 h-6 rounded-lg bg-red-700/20 text-red-400 shrink-0">
            <Icon size={14} />
          </span>
          <span className="text-[11px] text-neutral-500">Step {index + 1}</span>
          <span className="text-sm font-medium text-neutral-200 truncate">{meta.label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            aria-label="Move up"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            aria-label="Move down"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label="Remove step"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {step.type === 'send_sms' && (
        <Field hint="Merge tags like {{firstName}} and {{lastName}} are supported.">
          <textarea
            className={inputCls}
            rows={3}
            value={step.body || ''}
            onChange={e => onChange(index, { body: e.target.value })}
            placeholder="Hey {{firstName}}, thanks for reaching out!"
          />
        </Field>
      )}

      {step.type === 'send_email' && (
        <div className="flex flex-col gap-2">
          <input
            className={inputCls}
            value={step.subject || ''}
            onChange={e => onChange(index, { subject: e.target.value })}
            placeholder="Subject line"
          />
          <Field hint="HTML supported. Merge tags like {{firstName}} work here too.">
            <textarea
              className={inputCls}
              rows={4}
              value={step.body || ''}
              onChange={e => onChange(index, { body: e.target.value })}
              placeholder="<p>Hi {{firstName}},</p>"
            />
          </Field>
        </div>
      )}

      {step.type === 'wait' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Days">
            <input
              type="number"
              min="0"
              className={inputCls}
              value={step.days ?? 0}
              onChange={e => onChange(index, { days: numVal(e.target.value) })}
            />
          </Field>
          <Field label="Hours (optional)">
            <input
              type="number"
              min="0"
              className={inputCls}
              value={step.hours ?? 0}
              onChange={e => onChange(index, { hours: numVal(e.target.value) })}
            />
          </Field>
        </div>
      )}

      {(step.type === 'add_tag' || step.type === 'remove_tag') && (
        <input
          className={inputCls}
          value={step.tag || ''}
          onChange={e => onChange(index, { tag: e.target.value })}
          placeholder="Tag name"
        />
      )}
    </Card>
  )
}
