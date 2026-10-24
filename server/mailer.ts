import nodemailer from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Development mailer: prints emails to the server log and keeps them for tests. */
export class ConsoleMailer implements Mailer {
  sent: Email[] = [];
  constructor(private quiet = false) {}

  async send(email: Email) {
    this.sent.push(email);
    if (!this.quiet) {
      console.log(`\n📧 To: ${email.to}\n   Subject: ${email.subject}\n${email.text.replace(/^/gm, '   ')}\n`);
    }
  }
}

export class SmtpMailer implements Mailer {
  private transport: nodemailer.Transporter;
  constructor(url: string, private from: string) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(email: Email) {
    await this.transport.sendMail({ from: this.from, ...email });
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Builds a plain, client-friendly email with one call-to-action button. */
function layout(to: string, subject: string, lines: string[], action: { label: string; url: string }, footer: string): Email {
  const text = [...lines, '', `${action.label}: ${action.url}`, '', footer].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#161a22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #dde1e8;border-radius:12px">
<tr><td style="padding:28px">
<div style="font-weight:700;font-size:18px;margin-bottom:20px">🏆 Matchcraft</div>
${lines.map((l) => `<p style="margin:0 0 14px;line-height:1.5">${escape(l)}</p>`).join('')}
<p style="margin:24px 0"><a href="${escape(action.url)}" style="display:inline-block;background:#1a7f5a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escape(action.label)}</a></p>
<p style="margin:0;color:#5f6878;font-size:13px;line-height:1.5">${escape(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}

export const emails = {
  verify: (to: string, name: string, url: string) =>
    layout(to, 'Confirm your email for Matchcraft', [
      `Hi ${name},`,
      'Thanks for signing up. Please confirm this is your email address.',
    ], { label: 'Confirm email', url }, 'This link expires in 48 hours. If you didn’t create an account, you can ignore this email.'),

  reset: (to: string, name: string, url: string) =>
    layout(to, 'Reset your Matchcraft password', [
      `Hi ${name},`,
      'Someone (hopefully you) asked to reset your password. Choose a new one with the button below.',
    ], { label: 'Choose a new password', url }, 'This link expires in 1 hour and works once. If you didn’t ask for this, you can ignore this email; your password won’t change.'),

  invite: (to: string, inviter: string, tournament: string, url: string) =>
    layout(to, `${inviter} invited you to co-organise ${tournament}`, [
      `${inviter} invited you to help run “${tournament}” on Matchcraft.`,
      'As a co-organiser you can enter scores and change the tournament’s settings.',
    ], { label: 'Accept invitation', url }, 'This invitation expires in 14 days. If you weren’t expecting it, you can ignore this email.'),
};
