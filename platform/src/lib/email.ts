// Thin email wrapper. Uses Resend if RESEND_API_KEY is set; otherwise logs to the
// console so the app runs end-to-end in dev / before email is configured.

type Mail = { to: string | string[]; subject: string; text: string; html?: string; replyTo?: string };

// Default sender uses the verified domain so guest emails deliver out of the box.
// (onboarding@resend.dev only delivers to your own Resend account address.)
const FROM = process.env.EMAIL_FROM || 'Villa Siesta <bookings@villasiestasarasota.com>';

export async function sendEmail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = Array.isArray(mail.to) ? mail.to : [mail.to];
  const recipients = to.map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) return;

  if (!key) {
    console.log('[email:dev]', { to: recipients, subject: mail.subject, replyTo: mail.replyTo, from: FROM });
    console.log(mail.text);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: recipients,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        reply_to: mail.replyTo,
      }),
    });
    if (!res.ok) console.error('[email] Resend error', res.status, await res.text());
    else console.log(`[email] sent "${mail.subject}" to ${recipients.join(', ')}`);
  } catch (e) {
    console.error('[email] send failed', e);
  }
}

/** Send a branded template ({ subject, html, text }) from lib/emails.ts. */
export async function sendTemplate(to: string | string[], tpl: { subject: string; html: string; text: string }, replyTo?: string): Promise<void> {
  await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo });
}

export function notifyEmails(): string[] {
  return (process.env.NOTIFY_EMAILS || process.env.OWNER_EMAIL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}
