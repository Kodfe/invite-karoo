import { env } from '../../config/env';
import { AppError } from '../../common/app-error';
import { auth } from '../../common/firebase-auth';
import { randomDigits, randomToken, sha256, safeEqual } from '../../common/crypto';
import { prettyPhone } from '../../common/phone';
import { col } from '../../db/paths';
import { DEFAULT_PREFS, DEFAULT_PRIVACY, Otp, User } from '../../db/models';
import { data, db, F, getDoc } from '../../db/store';
import { WhatsappService } from '../infra/whatsapp.service';
import { MeService } from '../me/me.service';

const OTP_TTL_MS = 5 * 60_000;
const RESEND_MS = 30_000;
const MAX_PER_HOUR = 6;
const MAX_ATTEMPTS = 5;
const TICKET_TTL_MS = 15 * 60_000;

export type Profile = { firstName: string; familyName: string; city: string; lang?: 'en' | 'hi' | 'ta' | 'gu' };

/**
 * WhatsApp code sign-in. A confirmed number gets a Firebase custom token (uid = users/{uid},
 * claim `phone`); the app signs in with it and from then on sends Firebase ID tokens.
 */
export class AuthService {
  constructor(
    private readonly wa: WhatsappService,
    private readonly me: MeService,
  ) {}

  private hash(phone: string, code: string) {
    return sha256(`${phone}:${code}:${env().OTP_SECRET}`);
  }

  /** Any valid number gets a code. Known numbers sign in; new ones finish signup after. */
  async requestOtp(phone: string, purpose: 'login' | 'signup' | 'change_number') {
    const code = env().DEV_OTP || randomDigits(4);
    const ref = col.otp().doc(phone);
    await db().runTransaction(async (tx) => {
      const cur = data<Otp>(await tx.get(ref));
      const now = Date.now();
      const sends = (cur?.sends ?? []).filter((t) => now - t.getTime() < 3600_000);
      if (sends.length >= MAX_PER_HOUR) {
        throw new AppError('OTP_LIMIT', 'Too many codes asked for this number. Try again in an hour.', 429);
      }
      const last = Math.max(0, ...sends.map((t) => t.getTime()));
      if (now - last < RESEND_MS) {
        const wait = Math.ceil((RESEND_MS - (now - last)) / 1000);
        throw new AppError('OTP_WAIT', `Please wait ${wait} seconds before asking for a new code.`, 429, { resendIn: String(wait) });
      }
      tx.set(ref, {
        phone,
        purpose,
        codeHash: this.hash(phone, code),
        attempts: 0,
        expiresAt: new Date(now + OTP_TTL_MS),
        consumedAt: null,
        createdAt: new Date(now),
        sends: [...sends, new Date(now)],
      });
    });
    if (!env().DEV_OTP) {
      const r = await this.wa.send(phone, 'otp', [code]);
      if (!r.ok) throw new AppError('OTP_SEND_FAILED', 'We could not send the code on WhatsApp. Check the number and try again.', 502);
    }
    return { channel: 'whatsapp', to: prettyPhone(phone), expiresIn: OTP_TTL_MS / 1000, resendIn: RESEND_MS / 1000 };
  }

  /** checks the live code for this number; consumes it on success when `purpose` is given */
  async checkOtp(phone: string, code: string, purpose?: 'change_number') {
    const ref = col.otp().doc(phone);
    const row = await getDoc<Otp>(ref);
    if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      throw new AppError('OTP_EXPIRED', 'This code has expired. Ask for a new one.', 400);
    }
    if (purpose && row.purpose !== purpose) throw new AppError('OTP_INVALID', 'That code is not right. Check and try again.', 400);
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new AppError('OTP_LOCKED', 'Too many wrong tries. Ask for a new code.', 429);
    }
    if (!safeEqual(row.codeHash, this.hash(phone, code))) {
      await ref.update({ attempts: F.inc(1) });
      const left = MAX_ATTEMPTS - row.attempts - 1;
      throw new AppError('OTP_INVALID', left > 0 ? `That code is not right. ${left} tries left.` : 'Too many wrong tries. Ask for a new code.', 400);
    }
    if (purpose) await this.consume(phone);
    return row;
  }

  private consume(phone: string) {
    return col.otp().doc(phone).update({ consumedAt: F.now() });
  }

  async verifyOtp(phone: string, code: string, profile?: Profile, _platform?: string) {
    await this.checkOtp(phone, code);
    const existing = await this.findUser(phone);
    if (existing) {
      await this.consume(phone);
      return { status: 'signed_in' as const, ...(await this.issue(existing.id, phone)) };
    }
    if (profile) {
      await this.consume(phone);
      const user = await this.createUser(phone, profile);
      return { status: 'signed_in' as const, isNew: true, ...(await this.issue(user.id, phone)) };
    }
    // number confirmed, account not made yet: hand back a ticket for /auth/signup
    const ticket = randomToken(24);
    await this.consume(phone);
    await col.signupTickets().doc(sha256(ticket)).set({ phone, expiresAt: new Date(Date.now() + TICKET_TTL_MS), createdAt: F.now() });
    return { status: 'needs_profile' as const, signupTicket: ticket, phone: prettyPhone(phone) };
  }

  async signupWithTicket(ticket: string, profile: Profile, _platform?: string) {
    const ref = col.signupTickets().doc(sha256(ticket));
    const phone = await db().runTransaction(async (tx) => {
      const t = data<{ phone: string; expiresAt: Date }>(await tx.get(ref));
      if (!t || t.expiresAt.getTime() < Date.now()) {
        throw new AppError('TICKET_EXPIRED', 'This sign-up has expired. Start again with your number.', 400);
      }
      tx.delete(ref);
      return t.phone;
    });
    const user = (await this.findUser(phone)) ?? (await this.createUser(phone, profile));
    return { status: 'signed_in' as const, isNew: true, ...(await this.issue(user.id, phone)) };
  }

  private async findUser(phone: string) {
    const link = await getDoc<{ uid: string }>(col.phones().doc(phone));
    if (!link) return null;
    const u = await getDoc<User>(col.users().doc(link.uid));
    return u && !u.deletedAt ? u : null;
  }

  private async createUser(phone: string, p: Profile) {
    const uid = col.users().doc().id;
    return db().runTransaction(async (tx) => {
      const link = await tx.get(col.phones().doc(phone));
      if (link.exists) return { id: (link.data() as { uid: string }).uid };
      tx.create(col.phones().doc(phone), { uid });
      tx.create(col.users().doc(uid), {
        phone,
        firstName: p.firstName.trim(),
        familyName: p.familyName.trim(),
        city: p.city.trim(),
        email: null,
        photoUrl: null,
        lang: p.lang ?? 'en',
        prefs: DEFAULT_PREFS,
        privacy: DEFAULT_PRIVACY,
        lastSeenAt: null,
        createdAt: F.now(),
        updatedAt: F.now(),
        deletedAt: null,
      });
      return { id: uid };
    });
  }

  /** the app signs in to Firebase with customToken (signInWithCustomToken) */
  private async issue(userId: string, phone: string) {
    const customToken = await auth().createCustomToken(userId, { phone });
    return { customToken, me: await this.me.me(userId) };
  }
}
