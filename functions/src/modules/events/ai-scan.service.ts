import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { env } from '../../config/env';
import { AppError } from '../../common/app-error';

export const ScanResult = z.object({
  kind: z.enum(['wedding', 'meeting', 'birthday', 'appointment', 'celebration', 'other']),
  title: z.string().describe('Short title, e.g. "Rohit & Anika Wedding" or "Dental check-up"'),
  date: z.string().nullable().describe('First or only date, YYYY-MM-DD'),
  time: z.string().nullable().describe('Start time, 24h HH:mm'),
  endDate: z.string().nullable().describe('Last date for multi-day events, YYYY-MM-DD'),
  venue: z.string().describe('Venue name and address as printed, or empty'),
  city: z.string().describe('City, or empty'),
  host: z.string().describe('Who is inviting, e.g. "Mehta & Agarwal Families", or empty'),
  hostContact: z.string().describe('Phone number printed on the card, or empty'),
  bride: z.string().describe('Bride name for weddings, else empty'),
  groom: z.string().describe('Groom name for weddings, else empty'),
  notes: z.string().describe('Anything else useful: dress code, RSVP note, muhurat. Empty if none'),
  functions: z
    .array(
      z.object({
        name: z.string(),
        date: z.string().nullable().describe('YYYY-MM-DD'),
        time: z.string().nullable().describe('24h HH:mm'),
        venue: z.string(),
        note: z.string(),
      }),
    )
    .describe('Each separate function on a multi-function card (Haldi, Sangeet, Wedding, Reception…). Empty for single events.'),
  readable: z.boolean().describe('false if the image is not an invitation or cannot be read'),
});
export type ScanResult = z.infer<typeof ScanResult>;

const SYSTEM = `You read photographed or scanned invitation cards, mostly Indian wedding cards, and extract the event details.
Cards may be in English, Hindi, Assamese, Bengali, Gujarati, Tamil, Marathi or a mix — translate names of functions into common English forms (e.g. "Haldi", "Mehendi", "Sangeet", "Wedding Ceremony", "Reception", "Tilak", "Engagement").
Rules:
- Never invent anything. If a value is not printed, leave it empty or null.
- Dates as YYYY-MM-DD. If the year is missing, assume the next occurrence after today's date given below.
- Times as 24-hour HH:mm. "Evening" without a time means null.
- For a wedding card, list EVERY function separately in "functions" and use the first function's date as "date".
- Muhurat / phera times go in that function's note.`;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export class AiScanService {
  private readonly log = console;
  private client: Anthropic | null = null;

  private api() {
    const key = env().ANTHROPIC_API_KEY;
    if (!key) throw new AppError('AI_NOT_CONFIGURED', 'Card scanning is not switched on yet. Add the event by hand for now.', 503);
    this.client ??= new Anthropic({ apiKey: key });
    return this.client;
  }

  async scan(file: { buffer: Buffer; mimetype: string }): Promise<ScanResult> {
    const isPdf = file.mimetype === 'application/pdf';
    if (!isPdf && !IMAGE_TYPES.includes(file.mimetype as (typeof IMAGE_TYPES)[number])) {
      throw new AppError('BAD_FILE_TYPE', 'Use a JPG, PNG or PDF of the card', 415);
    }
    const data = file.buffer.toString('base64');
    const media = isPdf
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: file.mimetype as (typeof IMAGE_TYPES)[number], data } } as const);
    try {
      const msg = await this.api().messages.parse({
        model: env().AI_MODEL,
        max_tokens: 2000,
        system: `${SYSTEM}\nToday's date: ${new Date().toISOString().slice(0, 10)}.`,
        messages: [{ role: 'user', content: [media, { type: 'text', text: 'Extract the event details from this invitation.' }] }],
        output_config: { format: zodOutputFormat(ScanResult) },
      });
      const out = msg.parsed_output;
      if (!out) throw new Error('no structured output');
      if (!out.readable) throw new AppError('SCAN_UNREADABLE', 'We could not read an invitation in this picture. Try again in better light, with the card flat.', 422);
      return out;
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.log.warn(`scan failed: ${(e as Error).message}`);
      throw new AppError('SCAN_FAILED', 'Scanning did not work this time. Try again, or add it by hand.', 502);
    }
  }
}
