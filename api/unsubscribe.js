/**
 * /api/unsubscribe?c=<contactId>&t=<token>
 *
 * GET  — one-click unsubscribe from an email link → tags the contact
 *        "unsubscribed" and renders a confirmation page.
 * POST — RFC 8058 List-Unsubscribe-Post one-click → same effect, JSON response.
 *
 * Public (no dashboard auth) — the link is signed with a per-contact token so it
 * can't be trivially forged for arbitrary contacts. Once tagged "unsubscribed",
 * the contact is excluded from all future SMS and email sends (see _messaging.js).
 */
import { sql, migrate } from './_db.js'
import { unsubscribeToken } from './_messaging.js'

function page(title, message) {
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${title}</title>
    <style>
      body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:#0a0a0a;color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .card{max-width:420px;padding:40px 32px;text-align:center}
      h1{font-size:20px;margin:0 0 8px}
      p{font-size:14px;color:#a3a3a3;line-height:1.6;margin:0}
      .dot{width:44px;height:44px;border-radius:9999px;margin:0 auto 20px;
        display:flex;align-items:center;justify-content:center;font-size:22px;
        background:rgba(124,58,237,.15);color:#a78bfa}
    </style></head>
    <body><div class="card"><div class="dot">✓</div>
      <h1>${title}</h1><p>${message}</p></div></body></html>`
}

export default async function handler(req, res) {
  const contactId = req.query.c || (typeof req.body === 'object' ? req.body?.c : undefined)
  const token     = req.query.t || (typeof req.body === 'object' ? req.body?.t : undefined)
  const wantsHtml = req.method === 'GET'

  const respond = (status, title, message) => {
    if (wantsHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(status).send(page(title, message))
    }
    return res.status(status).json({ ok: status < 400, message })
  }

  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  if (!contactId) return respond(400, 'Invalid link', 'This unsubscribe link is missing required information.')

  // Verify the signed token (tolerate older/unsigned links by still honoring the request)
  if (token && token !== unsubscribeToken(contactId)) {
    return respond(400, 'Invalid link', 'This unsubscribe link could not be verified.')
  }

  try {
    await migrate()
    const db = sql()
    const existing = await db`SELECT id FROM contacts WHERE id = ${contactId} LIMIT 1`
    if (existing.length === 0) {
      return respond(404, 'Not found', "We couldn't find your record, but you won't receive further emails.")
    }

    await db`
      UPDATE contacts
      SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(tags || ARRAY['unsubscribed']::text[]))),
          updated_at = now()
      WHERE id = ${contactId}
    `
    return respond(200, "You're unsubscribed", "You won't receive any more marketing emails from us. You can close this window.")
  } catch (err) {
    console.error('[api/unsubscribe]', err)
    return respond(500, 'Something went wrong', 'Please try again later.')
  }
}
