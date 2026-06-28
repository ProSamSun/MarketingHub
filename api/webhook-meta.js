/**
 * GET  /api/webhook-meta  — Meta verification challenge
 * POST /api/webhook-meta  — Incoming lead form submission
 *
 * What happens when someone fills out your Meta ad form:
 *  1. Meta POSTs the lead data here
 *  2. We parse first name, last name, email, phone from the form fields
 *  3. We create (or update) the contact in GoHighLevel
 *  4. We tag them with "meta-lead" and the ad campaign name
 *  5. If you have a GHL workflow ID set, we enroll them in it automatically
 *
 * Setup in Meta Business Manager:
 *  Webhooks → Subscribe → Callback URL: https://your-app.vercel.app/api/webhook-meta
 *  Verify Token: whatever you set as META_WEBHOOK_VERIFY_TOKEN in Vercel env vars
 *  Subscribe to: leadgen
 */

import { createOrUpdateContact, addContactToWorkflow, addContactTag } from './_ghl.js'

// Field name mappings from Meta's lead form field keys
const FIELD_MAP = {
  email: 'email',
  phone_number: 'phone',
  full_name: 'fullName',
  first_name: 'firstName',
  last_name: 'lastName',
}

function parseLeadFields(fieldData = []) {
  const parsed = {}
  for (const { name, values } of fieldData) {
    const key = FIELD_MAP[name] || name
    parsed[key] = values?.[0] ?? ''
  }

  // Split full_name if firstName/lastName not provided separately
  if (parsed.fullName && !parsed.firstName) {
    const parts = parsed.fullName.trim().split(' ')
    parsed.firstName = parts[0] ?? ''
    parsed.lastName = parts.slice(1).join(' ')
    delete parsed.fullName
  }

  return parsed
}

export default async function handler(req, res) {
  // ── Verification handshake (one-time, when you first set up the webhook) ──
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const token     = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      console.log('[webhook-meta] Verified by Meta')
      return res.status(200).send(challenge)
    }
    return res.status(403).json({ error: 'Verification failed' })
  }

  if (req.method !== 'POST') return res.status(405).end()

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  // Meta sends an array of entry objects, each with a list of changes
  const entries = body?.entry ?? []
  const processed = []

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue

      const leadData = change.value
      const { field_data = [], ad_name, campaign_name, form_id } = leadData

      const fields = parseLeadFields(field_data)
      const { firstName = '', lastName = '', email = '', phone = '' } = fields

      if (!email && !phone) {
        console.warn('[webhook-meta] Lead has no email or phone, skipping', leadData)
        continue
      }

      try {
        // Create or update contact in GHL
        const contact = await createOrUpdateContact({
          firstName,
          lastName,
          email,
          phone,
          tags: ['meta-lead', campaign_name, ad_name].filter(Boolean),
          source: `Meta Ads — ${campaign_name ?? 'Unknown Campaign'}`,
        })

        const contactId = contact?.contact?.id

        // Enroll in GHL workflow if configured
        const workflowId = process.env.GHL_META_WORKFLOW_ID
        if (contactId && workflowId) {
          await addContactToWorkflow(contactId, workflowId)
        }

        processed.push({ contactId, email, status: 'created' })
        console.log(`[webhook-meta] Created contact: ${firstName} ${lastName} <${email}>`)
      } catch (err) {
        console.error('[webhook-meta] Error creating contact:', err.message)
        processed.push({ email, status: 'error', error: err.message })
      }
    }
  }

  return res.status(200).json({ received: true, processed })
}
