import { useEffect, useRef, useState } from 'react'
import {
  Plus, Search, RefreshCw, Users, Pencil, Trash2, Send,
  Mail, Phone, Tag as TagIcon, Calendar, MessageSquare, ArrowRight,
} from 'lucide-react'
import {
  Card, Field, Button, IconButton, Tag, Loading, EmptyState, Banner,
  Modal, SlideOver, inputCls, labelCls,
} from '../../lib/ui.jsx'
import {
  fullName, initials, shortDate, relativeTime,
} from '../../lib/format.js'

const EMPTY_FORM = {
  firstName: '', lastName: '', email: '', phone: '', source: '', tags: '', notes: '',
}

function contactToForm(c) {
  return {
    firstName: c.first_name || '',
    lastName: c.last_name || '',
    email: c.email || '',
    phone: c.phone || '',
    source: c.source || '',
    tags: (c.tags || []).join(', '),
    notes: c.notes || '',
  }
}

function truncate(str, n = 120) {
  if (!str) return ''
  const text = String(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

export default function Contacts({ api, pending, onPendingConsumed }) {
  const [contacts, setContacts] = useState([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  const firstLoad = useRef(true)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await api.get('/api/contacts', { search, tag })
      setContacts(data.contacts || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e.message || 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }

  // Apply pending payload from the AI command bar.
  useEffect(() => {
    if (!pending) return
    setSearch(pending.search || '')
    setTag(pending.tag || '')
    onPendingConsumed?.()
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced reload whenever search/tag changes.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false
      load()
      return
    }
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [search, tag]) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    setEditTarget(null)
    setModalOpen(true)
  }

  function openEdit(contact) {
    setEditTarget(contact)
    setModalOpen(true)
  }

  async function handleDelete(contact) {
    if (!contact) return
    if (!window.confirm(`Delete ${fullName(contact)}? This cannot be undone.`)) return
    try {
      await api.del('/api/contacts', { id: contact.id })
      setSelected(null)
      await load()
    } catch (e) {
      setError(e.message || 'Failed to delete contact')
    }
  }

  function afterSave(savedContact) {
    setModalOpen(false)
    setEditTarget(null)
    load()
    if (savedContact && selected && savedContact.id === selected.id) {
      setSelected(savedContact)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Contacts</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {total} {total === 1 ? 'contact' : 'contacts'}
          </p>
        </div>
        <Button icon={Plus} onClick={openCreate}>New Contact</Button>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 pointer-events-none" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search name, email, phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="relative w-32 sm:w-44">
          <TagIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 pointer-events-none" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Tag"
            value={tag}
            onChange={e => setTag(e.target.value)}
          />
        </div>
        <IconButton icon={RefreshCw} label="Refresh" onClick={load} />
      </div>

      {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}

      {/* List */}
      {loading ? (
        <Loading label="Loading contacts…" />
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts found"
          hint={search || tag ? 'Try a different search or clear the filters.' : 'Add your first contact to get started.'}
          action={<Button icon={Plus} onClick={openCreate}>New Contact</Button>}
        />
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {contacts.map(c => (
              <ContactCard key={c.id} contact={c} onClick={() => setSelected(c)} />
            ))}
          </div>

          {/* md+: table */}
          <Card className="hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 border-b border-neutral-800">
                  <th className="font-medium px-4 py-3">Name</th>
                  <th className="font-medium px-4 py-3">Email</th>
                  <th className="font-medium px-4 py-3">Phone</th>
                  <th className="font-medium px-4 py-3">Tags</th>
                  <th className="font-medium px-4 py-3">Source</th>
                  <th className="font-medium px-4 py-3 whitespace-nowrap">Created</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="border-b border-neutral-800/60 last:border-0 hover:bg-neutral-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar contact={c} />
                        <span className="font-medium text-neutral-100">{fullName(c)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{c.email || '—'}</td>
                    <td className="px-4 py-3 text-neutral-400">{c.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags || []).slice(0, 3).map((t, i) => <Tag key={i}>{t}</Tag>)}
                        {(c.tags || []).length > 3 && (
                          <span className="text-xs text-neutral-600">+{c.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{c.source || '—'}</td>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{shortDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {/* Detail slide-over */}
      <ContactDetail
        api={api}
        contact={selected}
        onClose={() => setSelected(null)}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      {/* Create / Edit modal */}
      <ContactForm
        api={api}
        open={modalOpen}
        editTarget={editTarget}
        onClose={() => { setModalOpen(false); setEditTarget(null) }}
        onSaved={afterSave}
      />
    </div>
  )
}

function Avatar({ contact, size = 'sm' }) {
  const cls = size === 'lg' ? 'w-12 h-12 text-base' : 'w-9 h-9 text-xs'
  return (
    <span className={`grid place-items-center shrink-0 rounded-full bg-red-700/20 text-red-400 font-semibold ${cls}`}>
      {initials(contact)}
    </span>
  )
}

function ContactCard({ contact, onClick }) {
  return (
    <Card className="p-3 active:bg-neutral-800/40 transition-colors cursor-pointer" onClick={onClick}>
      <div className="flex items-center gap-3">
        <Avatar contact={contact} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-neutral-100 truncate">{fullName(contact)}</p>
          <p className="text-xs text-neutral-500 truncate">{contact.email || contact.phone || '—'}</p>
        </div>
        <span className="text-xs text-neutral-600 shrink-0">{shortDate(contact.created_at)}</span>
      </div>
      {(contact.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {contact.tags.slice(0, 3).map((t, i) => <Tag key={i}>{t}</Tag>)}
          {contact.tags.length > 3 && <span className="text-xs text-neutral-600">+{contact.tags.length - 3}</span>}
        </div>
      )}
    </Card>
  )
}

function ContactDetail({ api, contact, onClose, onEdit, onDelete }) {
  const [workflows, setWorkflows] = useState([])
  const [workflowId, setWorkflowId] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [enrollMsg, setEnrollMsg] = useState('')
  const [enrollErr, setEnrollErr] = useState('')

  const [messages, setMessages] = useState([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [msgErr, setMsgErr] = useState('')

  const open = !!contact

  useEffect(() => {
    if (!open) return
    setEnrollMsg('')
    setEnrollErr('')
    setWorkflowId('')

    let active = true

    // Workflows (for enrollment select)
    api.get('/api/workflows')
      .then(d => { if (active) setWorkflows(d.workflows || []) })
      .catch(() => { if (active) setWorkflows([]) })

    // Message history
    setMsgLoading(true)
    setMsgErr('')
    api.get('/api/inbox', { contactId: contact.id })
      .then(d => { if (active) setMessages(d.messages || []) })
      .catch(e => { if (active) setMsgErr(e.message || 'Failed to load messages') })
      .finally(() => { if (active) setMsgLoading(false) })

    return () => { active = false }
  }, [open, contact?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function enroll() {
    if (!workflowId) return
    setEnrolling(true)
    setEnrollMsg('')
    setEnrollErr('')
    try {
      await api.post('/api/workflows?action=enroll', {
        contactId: contact.id,
        workflowId,
      })
      const wf = workflows.find(w => String(w.id) === String(workflowId))
      setEnrollMsg(`Enrolled in ${wf ? wf.name : 'workflow'}`)
    } catch (e) {
      setEnrollErr(e.message || 'Failed to enroll')
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={contact ? fullName(contact) : ''}
      subtitle={contact ? [contact.email, contact.phone].filter(Boolean).join(' · ') : ''}
      footer={contact && (
        <>
          <Button variant="ghost" icon={Pencil} className="flex-1" onClick={() => onEdit(contact)}>Edit</Button>
          <Button variant="danger" icon={Trash2} className="flex-1" onClick={() => onDelete(contact)}>Delete</Button>
        </>
      )}
    >
      {contact && (
        <div className="flex flex-col gap-6">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <Avatar contact={contact} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold text-neutral-100 truncate">{fullName(contact)}</p>
              {contact.source && <p className="text-xs text-neutral-500">via {contact.source}</p>}
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">Details</h3>
            <DetailRow icon={Mail} label="Email" value={contact.email} />
            <DetailRow icon={Phone} label="Phone" value={contact.phone} />
            <DetailRow icon={TagIcon} label="Source" value={contact.source} />
            <DetailRow icon={Calendar} label="Created" value={shortDate(contact.created_at)} />
            {(contact.tags || []).length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <TagIcon size={15} className="text-neutral-600 mt-1 shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((t, i) => <Tag key={i}>{t}</Tag>)}
                </div>
              </div>
            )}
            {contact.notes && (
              <p className="text-sm text-neutral-400 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 whitespace-pre-wrap">
                {contact.notes}
              </p>
            )}
          </div>

          {/* Enroll in workflow */}
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">Enroll in workflow</h3>
            {workflows.length === 0 ? (
              <p className="text-xs text-neutral-600">No workflows available.</p>
            ) : (
              <div className="flex gap-2">
                <select
                  className={inputCls}
                  value={workflowId}
                  onChange={e => setWorkflowId(e.target.value)}
                >
                  <option value="">Select a workflow…</option>
                  {workflows.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <Button icon={Send} loading={enrolling} disabled={!workflowId} onClick={enroll}>
                  Enroll
                </Button>
              </div>
            )}
            {enrollMsg && <Banner type="success" onClose={() => setEnrollMsg('')}>{enrollMsg}</Banner>}
            {enrollErr && <Banner type="error" onClose={() => setEnrollErr('')}>{enrollErr}</Banner>}
          </div>

          {/* Message history */}
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">Message history</h3>
            {msgLoading ? (
              <Loading label="Loading messages…" />
            ) : msgErr ? (
              <Banner type="error">{msgErr}</Banner>
            ) : messages.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages yet" />
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map(m => <MessageItem key={m.id} message={m} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </SlideOver>
  )
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={15} className="text-neutral-600 shrink-0" />
      <span className="text-neutral-500 w-16 shrink-0">{label}</span>
      <span className="text-neutral-200 truncate">{value || '—'}</span>
    </div>
  )
}

function MessageItem({ message }) {
  const outbound = message.direction === 'outbound'
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-neutral-400">
          <ArrowRight
            size={12}
            className={outbound ? 'text-red-500' : 'text-emerald-400 rotate-180'}
          />
          <span className="uppercase tracking-wide text-[10px] text-neutral-500">{message.type}</span>
          <span className="text-neutral-600">·</span>
          <span>{outbound ? 'Sent' : 'Received'}</span>
        </span>
        <span className="text-neutral-600 shrink-0">{relativeTime(message.sent_at)}</span>
      </div>
      {message.subject && <p className="text-sm text-neutral-200 font-medium">{message.subject}</p>}
      <p className="text-sm text-neutral-400">{truncate(message.body)}</p>
    </div>
  )
}

function ContactForm({ api, open, editTarget, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(editTarget ? contactToForm(editTarget) : EMPTY_FORM)
  }, [open, editTarget])

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function submit() {
    setError('')
    const email = form.email.trim()
    const phone = form.phone.trim()
    if (!email && !phone) {
      setError('Please provide at least an email or a phone number.')
      return
    }
    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean)
    const body = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email,
      phone,
      source: form.source.trim(),
      tags,
      notes: form.notes.trim(),
      metadata: {},
    }

    setSaving(true)
    try {
      let res
      if (editTarget) {
        res = await api.put('/api/contacts', { id: editTarget.id, ...body })
      } else {
        res = await api.post('/api/contacts', body)
      }
      onSaved(res?.contact || null)
    } catch (e) {
      setError(e.message || 'Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editTarget ? 'Edit Contact' : 'New Contact'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>{editTarget ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First name">
            <input className={inputCls} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
          </Field>
          <Field label="Last name">
            <input className={inputCls} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
          </Field>
        </div>
        <Field label="Email">
          <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 555 123 4567" />
        </Field>
        <Field label="Source">
          <input className={inputCls} value={form.source} onChange={e => set('source', e.target.value)} placeholder="Website, referral…" />
        </Field>
        <Field label="Tags" hint="Comma-separated">
          <input className={inputCls} value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="vip, newsletter" />
        </Field>
        <Field label="Notes">
          <textarea rows={3} className={`${inputCls} resize-none`} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
        <p className={labelCls}>At least one of email or phone is required.</p>
      </div>
    </Modal>
  )
}
