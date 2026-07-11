// Thin email wrapper. Uses Resend if RESEND_API_KEY is set; otherwise logs to the
// console so the app runs end-to-end in dev / before email is configured.

type Mail = { to: string | string[]; subject: string; text: string; replyTo?: string };

const FROM = process.env.EMAIL_FROM || 'Villa Siesta <onboarding@resend.dev>';

export async function sendEmail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = Array.isArray(mail.to) ? mail.to : [mail.to];
  const recipients = to.map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) return;

  if (!key) {
    console.log('[email:dev]', { to: recipients, subject: mail.subject, replyTo: mail.replyTo });
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
        text: mail.text,
        reply_to: mail.replyTo,
      }),
    });
    if (!res.ok) console.error('[email] Resend error', res.status, await res.text());
  } catch (e) {
    console.error('[email] send failed', e);
  }
}

export function notifyEmails(): string[] {
  return (process.env.NOTIFY_EMAILS || process.env.OWNER_EMAIL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}
