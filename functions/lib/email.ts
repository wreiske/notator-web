/**
 * Email sending via Mailgun HTTP API
 *
 * Uses the Mailgun REST API (no SDK needed) for edge compatibility.
 */

import type { Env } from "./types";

const OTP_EMAIL_HTML = (code: string) => `
<div style="font-family: 'Courier New', monospace; max-width: 480px; margin: 0 auto; background: #080828; color: #e8ecff; padding: 32px; border: 2px solid #4466cc;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 32px;">🎹</span>
    <h1 style="color: #4488ff; margin: 8px 0 0; font-size: 20px;">Notator Online</h1>
  </div>
  <p style="color: #a0b0dd; font-size: 14px;">Your verification code is:</p>
  <div style="text-align: center; margin: 24px 0;">
    <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4488ff; background: #0e1647; padding: 12px 24px; border: 1px solid #2a3f99; display: inline-block;">${code}</span>
  </div>
  <p style="color: #6678aa; font-size: 12px; text-align: center;">This code expires in 5 minutes.</p>
  <hr style="border: none; border-top: 1px solid #2a3f99; margin: 24px 0;" />
  <p style="color: #6678aa; font-size: 11px; text-align: center;">
    The Atari ST Sequencer Community — <a href="https://notator.online" style="color: #4488ff;">notator.online</a>
  </p>
</div>
`;

export async function sendOtpEmail(
  email: string,
  code: string,
  env: Env,
): Promise<void> {
  const domain = env.MAILGUN_DOMAIN;
  const apiKey = env.MAILGUN_API_KEY;

  if (!domain || !apiKey) {
    throw new Error(
      "Mailgun configuration missing (MAILGUN_DOMAIN, MAILGUN_API_KEY)",
    );
  }

  const form = new FormData();
  form.append("from", `Notator Online <noreply@${domain}>`);
  form.append("to", email);
  form.append("subject", `Your Notator login code: ${code}`);
  form.append("html", OTP_EMAIL_HTML(code));

  const response = await fetch(
    `https://api.mailgun.net/v3/${domain}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
      },
      body: form,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mailgun API error: ${response.status} ${text}`);
  }
}
