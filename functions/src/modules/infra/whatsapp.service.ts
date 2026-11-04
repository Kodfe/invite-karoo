import { env } from '../../config/env';
import { col } from '../../db/paths';
import { F } from '../../db/store';

export type WaTemplate = 'otp' | 'invite' | 'reminder';

export type WaResult = { ok: boolean; providerId?: string; error?: string };

/**
 * Sends approved WhatsApp templates.
 *   console  prints to the log (development, tests)
 *   meta     WhatsApp Cloud API
 *
 * Template parameters (create these exact templates in Meta Business Manager):
 *   otp       body {{1}} = code   (category AUTHENTICATION, with a copy-code button)
 *   invite    {{1}} guest  {{2}} couple  {{3}} function  {{4}} date & time  {{5}} venue
 *   reminder  {{1}} guest  {{2}} function  {{3}} couple  {{4}} date & time  {{5}} venue
 */
export class WhatsappService {
  private readonly log = console;
  /** the last messages sent in console mode — tests read this */
  readonly outbox: { to: string; template: WaTemplate; params: string[] }[] = [];

  private templateName(t: WaTemplate) {
    const e = env();
    return t === 'otp' ? e.WA_TEMPLATE_OTP : t === 'invite' ? e.WA_TEMPLATE_INVITE : e.WA_TEMPLATE_REMINDER;
  }

  async send(
    to: string,
    template: WaTemplate,
    params: string[],
    related?: { type: string; id: string },
  ): Promise<WaResult> {
    const e = env();
    let res: WaResult;
    if (e.WHATSAPP_PROVIDER === 'console') {
      this.outbox.push({ to, template, params });
      if (this.outbox.length > 500) this.outbox.shift();
      if (e.NODE_ENV !== 'test') this.log.log(`→ ${to} [${template}] ${params.join(' | ')}`);
      res = { ok: true, providerId: 'console' };
    } else {
      res = await this.sendMeta(to, template, params);
    }
    await col.messageLog().doc().set({
      channel: 'whatsapp',
      to,
      template: this.templateName(template),
      status: res.ok ? 'sent' : 'failed',
      providerId: res.providerId ?? null,
      error: res.error ?? null,
      relatedType: related?.type ?? null,
      relatedId: related?.id ?? null,
      createdAt: F.now(),
    });
    return res;
  }

  private async sendMeta(to: string, template: WaTemplate, params: string[]): Promise<WaResult> {
    const e = env();
    if (!e.WHATSAPP_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) return { ok: false, error: 'WhatsApp is not configured' };
    const components: unknown[] = [
      { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
    ];
    // authentication templates carry the code again on the copy-code button
    if (template === 'otp') {
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params[0] }] });
    }
    try {
      const r = await fetch(
        `https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace('+', ''),
            type: 'template',
            template: { name: this.templateName(template), language: { code: e.WA_TEMPLATE_LANG }, components },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
      if (!r.ok) return { ok: false, error: body.error?.message ?? `HTTP ${r.status}` };
      return { ok: true, providerId: body.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
