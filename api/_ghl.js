/**
 * GoHighLevel API v2 client
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

const GHL_BASE = 'https://services.leadconnectorhq.com'

function headers() {
  return {
    'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  }
}

async function ghlFetch(method, path, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    const msg = json?.message || json?.msg || text || res.statusText
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${msg}`)
  }

  return json
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function createOrUpdateContact({ firstName, lastName, email, phone, tags = [], source = 'Meta Ads' }) {
  const locationId = process.env.GHL_LOCATION_ID
  return ghlFetch('POST', '/contacts/', {
    locationId,
    firstName,
    lastName,
    email,
    phone,
    tags,
    source,
  })
}

export async function getContactByEmail(email) {
  const locationId = process.env.GHL_LOCATION_ID
  const res = await ghlFetch('GET', `/contacts/?locationId=${locationId}&email=${encodeURIComponent(email)}&limit=1`)
  return res?.contacts?.[0] ?? null
}

export async function getContacts({ limit = 50, skip = 0 } = {}) {
  const locationId = process.env.GHL_LOCATION_ID
  return ghlFetch('GET', `/contacts/?locationId=${locationId}&limit=${limit}&skip=${skip}`)
}

export async function addContactTag(contactId, tag) {
  return ghlFetch('POST', `/contacts/${contactId}/tags`, { tags: [tag] })
}

// ── Workflows / Automations ──────────────────────────────────────────────────

export async function addContactToWorkflow(contactId, workflowId) {
  const locationId = process.env.GHL_LOCATION_ID
  return ghlFetch('POST', `/contacts/${contactId}/workflow/${workflowId}`, { eventStartTime: new Date().toISOString() })
}

export async function getWorkflows() {
  const locationId = process.env.GHL_LOCATION_ID
  return ghlFetch('GET', `/workflows/?locationId=${locationId}`)
}

// ── Conversations / Messaging ────────────────────────────────────────────────

export async function sendSMS({ contactId, message }) {
  const locationId = process.env.GHL_LOCATION_ID
  return ghlFetch('POST', '/conversations/messages', {
    type: 'SMS',
    contactId,
    locationId,
    message,
  })
}

export async function sendEmail({ contactId, subject, html, fromName, fromEmail }) {
  const locationId = process.env.GHL_LOCATION_ID
  return ghlFetch('POST', '/conversations/messages', {
    type: 'Email',
    contactId,
    locationId,
    subject,
    html,
    emailFrom: fromEmail,
    emailFromName: fromName,
  })
}

// ── Bulk campaign helpers ────────────────────────────────────────────────────

export async function sendBulkSMS({ tag, message }) {
  // Get contacts with this tag, send SMS to each
  const locationId = process.env.GHL_LOCATION_ID
  const { contacts = [] } = await ghlFetch('GET', `/contacts/?locationId=${locationId}&limit=100&tags=${encodeURIComponent(tag)}`)

  const results = []
  for (const contact of contacts) {
    if (!contact.phone) continue
    try {
      const r = await sendSMS({ contactId: contact.id, message })
      results.push({ contactId: contact.id, status: 'sent', id: r.id })
    } catch (err) {
      results.push({ contactId: contact.id, status: 'error', error: err.message })
    }
  }
  return { sent: results.filter(r => r.status === 'sent').length, total: contacts.length, results }
}

export async function sendBulkEmail({ tag, subject, html, fromName, fromEmail }) {
  const locationId = process.env.GHL_LOCATION_ID
  const { contacts = [] } = await ghlFetch('GET', `/contacts/?locationId=${locationId}&limit=100&tags=${encodeURIComponent(tag)}`)

  const results = []
  for (const contact of contacts) {
    if (!contact.email) continue
    try {
      const r = await sendEmail({ contactId: contact.id, subject, html, fromName, fromEmail })
      results.push({ contactId: contact.id, status: 'sent', id: r.id })
    } catch (err) {
      results.push({ contactId: contact.id, status: 'error', error: err.message })
    }
  }
  return { sent: results.filter(r => r.status === 'sent').length, total: contacts.length, results }
}
