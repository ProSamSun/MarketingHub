/**
 * /api/workflows
 * GET    — list workflows
 * POST   — create workflow
 * PUT    — update workflow
 * DELETE — delete workflow
 *
 * POST /api/workflows?action=enroll  — enroll contact
 * POST /api/workflows?action=ai      — AI builds workflow from description
 */
import { sql, migrate } from './_db.js'
import { enrollContact } from './_automation.js'
import Anthropic from '@anthropic-ai/sdk'

function auth(req) {
  const t = req.headers['x-dashboard-token'] || req.body?.token
  return t === process.env.DASHBOARD_PASSWORD
}

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function aiGenerateWorkflow(description) {
  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are a CRM automation expert. Generate a workflow JSON based on this description:

"${description}"

Return ONLY a valid JSON object with this exact structure — no markdown, no explanation:
{
  "name": "Workflow name",
  "description": "Brief description",
  "trigger": "manual",
  "steps": [
    { "type": "send_sms", "body": "Hey {{firstName}}, ..." },
    { "type": "wait", "days": 1 },
    { "type": "send_email", "subject": "Subject here", "body": "<p>HTML body with {{firstName}}</p>" },
    { "type": "wait", "days": 2 },
    { "type": "send_sms", "body": "Follow-up message..." },
    { "type": "add_tag", "tag": "nurture-complete" }
  ]
}

Step types available: send_sms, send_email, wait, add_tag, remove_tag.
For wait steps, use "days" (number) and optionally "hours" (number).
Use {{firstName}}, {{lastName}}, {{fullName}}, {{email}}, {{phone}} for personalization.
Make the copy compelling and specific to the description provided.`
    }]
  })

  const text = msg.content[0]?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('AI returned invalid JSON')
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const db = sql()

  let body = {}
  if (req.method !== 'GET') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  }

  const action = req.query.action

  try {
    // ── AI: generate workflow from description ────────────────────────────
    if (action === 'ai') {
      const { description } = body
      if (!description) return res.status(400).json({ error: 'description required' })
      const workflow = await aiGenerateWorkflow(description)
      return res.status(200).json({ workflow })
    }

    // ── Enroll contact in workflow ────────────────────────────────────────
    if (action === 'enroll') {
      const { contactId, workflowId } = body
      if (!contactId || !workflowId) return res.status(400).json({ error: 'contactId and workflowId required' })
      const result = await enrollContact(contactId, workflowId)
      return res.status(200).json(result)
    }

    if (req.method === 'GET') {
      const workflows = await db`SELECT * FROM workflows ORDER BY created_at DESC`
      return res.status(200).json({ workflows })
    }

    if (req.method === 'POST') {
      const { name, description, trigger = 'manual', steps = [], active = true } = body
      if (!name) return res.status(400).json({ error: 'name required' })
      const [workflow] = await db`
        INSERT INTO workflows (name, description, trigger, steps, active)
        VALUES (${name}, ${description || ''}, ${trigger}, ${JSON.stringify(steps)}, ${active})
        RETURNING *
      `
      return res.status(201).json({ workflow })
    }

    if (req.method === 'PUT') {
      const { id, name, description, trigger, steps, active } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`
        UPDATE workflows SET
          name        = COALESCE(${name        ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          trigger     = COALESCE(${trigger     ?? null}, trigger),
          steps       = COALESCE(${steps ? JSON.stringify(steps) : null}::jsonb, steps),
          active      = COALESCE(${active      ?? null}, active)
        WHERE id = ${id}
      `
      const [workflow] = await db`SELECT * FROM workflows WHERE id = ${id}`
      return res.status(200).json({ workflow })
    }

    if (req.method === 'DELETE') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`DELETE FROM workflows WHERE id = ${id}`
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[api/workflows]', err)
    return res.status(500).json({ error: err.message })
  }
}
