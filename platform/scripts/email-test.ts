// One-off email delivery test — `npm run email:test`.
// Sends a hello-world through the same lib/email.ts wrapper the whole platform
// uses (booking alerts, approvals, receipts), so this proves the real path.
// Requires RESEND_API_KEY (and optionally EMAIL_FROM) in the environment;
// without a key it just logs to the console (mock mode).

import { sendEmail, notifyEmails } from '../src/lib/email';

async function main() {
  const to = process.argv[2] || notifyEmails()[0];
  if (!to) {
    console.error('No recipient. Usage: npm run email:test -- you@example.com  (or set NOTIFY_EMAILS)');
    process.exit(1);
  }
  console.log(`Sending test email to ${to} (RESEND_API_KEY ${process.env.RESEND_API_KEY ? 'set' : 'NOT set — console mode'}, from: ${process.env.EMAIL_FROM || '(default onboarding@resend.dev)'})`);
  await sendEmail({
    to,
    subject: 'Villa Siesta — email is wired ✔',
    text: 'Congrats on sending your first email!\n\nThis went through the same sender used for booking requests, approvals, and receipts — so those will all deliver now.\n\n— Villa Siesta platform',
  });
  console.log('Done. Check the inbox (and spam folder on the first send).');
}

main().catch((e) => { console.error(e); process.exit(1); });
