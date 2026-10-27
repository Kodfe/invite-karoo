import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { env } from '../../config/env';
import { DB, InjectDb } from '../../db/db';
import { otpCodes, sessions, users } from '../../db/schema';
import { AppError } from '../../common/errors';
import { randomDigits, randomToken, sha256, safeEqual } from '../../common/crypto';
import { prettyPhone } from '../../common/phone';
import { signUserAccess } from '../../common/auth';
import { WhatsappService } from '../infra/whatsapp.service';
import { MeService } from '../me/me.service';

const OTP_TTL_MS = 5 * 60_000;
const RESEND_MS = 30_000;
const MAX_PER_HOUR = 6;
const MAX_ATTEMPTS = 5;
const TICKET_TTL_MS = 15 * 60_000;

export type Profile = { firstName: string; familyName: string; city: string; lang?: 'en' | 'hi' | 'ta' | 'gu' };

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: DB,
    private readonly wa: WhatsappService,
    private readonly me: MeService,
  ) {}

  private hash(phone: string, code: string) {
    return sha256(`${phone}:${code}:${env().JWT_REFRESH_SECRET}`);
  }

  /** Any valid number gets a code. Known numbers sign in; new ones finish signup after. */
  async requestOtp(phone: string, purpose: 'login' | 'signup' | 'change_number') {
    const hourAgo = new Date(Date.now() - 3600_000);
    const recent = await this.db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, hourAgo)))
      .orderBy(desc(otpCodes.createdAt));
    if (recent.length >= MAX_PER_HOUR) {
      throw new AppError('OTP_LIMIT', 'Too many codes asked for this number. Try again in an hour.', 429);
    }
    const last = recent[0];
    if (last && Date.now() - last.createdAt.getTime() < RESEND_MS) {
      const wait = Math.ceil((RESEND_MS - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new AppError('OTP_WAIT', `Please wait ${wait} seconds before asking for a new code.`, 429, { resendIn: String(wait) });
    }
    const code = env().DEV_OTP || randomDigits(4);
    await this.db.insert(otpCodes).values({
      phone,
      purpose,
      codeHash: this.hash(phone, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    if (!env().DEV_OTP) {
      const r = await this.wa.send(phone, 'otp', [code]);
      if (!r.ok) throw new AppError('OTP_SEND_FAILED', 'We could not send the code on WhatsApp. Check the number and try again.', 502);
    }
    return { channel: 'whatsapp', to: prettyPhone(phone), expiresIn: OTP_TTL_MS / 1000, resendIn: RESEND_MS / 1000 };
  }

  /** checks the newest live code for this number; consumes it on success */
  async checkOtp(phone: string, code: string, purpose?: 'change_number') {
    const [row] = await this.db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new AppError('OTP_EXPIRED', 'This code has expired. Ask for a new one.', 400);
    }
    if (purpose && row.purpose !== purpose) throw new AppError('OTP_INVALID', 'That code is not right. Check and try again.', 400);
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new AppError('OTP_LOCKED', 'Too many wrong tries. Ask for a new code.', 429);
    }
    if (!safeEqual(row.codeHash, this.hash(phone, code))) {
      await this.db.update(otpCodes).set({ attempts: row.attempts + 1 }).where(eq(otpCodes.id, row.id));
      const left = MAX_ATTEMPTS - row.attempts - 1;
      throw new AppError('OTP_INVALID', left > 0 ? `That code is not right. ${left} tries left.` : 'Too many wrong tries. Ask for a new code.', 400);
    }
    if (purpose) await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
    return row;
  }

  async verifyOtp(phone: string, code: string, profile?: Profile, platform?: string) {
    const row = await this.checkOtp(phone, code);
    const existing = await this.findUser(phone);
    if (existing) {
      await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
      return { status: 'signed_in' as const, ...(await this.issue(existing.id, phone, platform)) };
    }
    if (profile) {
      await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
      const user = await this.createUser(phone, profile);
      return { status: 'signed_in' as const, isNew: true, ...(await this.issue(user.id, phone, platform)) };
    }
    // number confirmed, account not made yet: hand back a ticket for /auth/signup
    const ticket = randomToken(24);
    await this.db
      .update(otpCodes)
      .set({ consumedAt: new Date(), ticket: sha256(ticket), expiresAt: new Date(Date.now() + TICKET_TTL_MS) })
      .where(eq(otpCodes.id, row.id));
    return { status: 'needs_profile' as const, signupTicket: ticket, phone: prettyPhone(phone) };
  }

  async signupWithTicket(ticket: string, profile: Profile, platform?: string) {
    const [row] = await this.db.select().from(otpCodes).where(eq(otpCodes.ticket, sha256(ticket))).limit(1);
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new AppError('TICKET_EXPIRED', 'This sign-up has expired. Start again with your number.', 400);
    }
    await this.db.update(otpCodes).set({ ticket: null }).where(eq(otpCodes.id, row.id));
    const user = (await this.findUser(row.phone)) ?? (await this.createUser(row.phone, profile));
    return { status: 'signed_in' as const, isNew: true, ...(await this.issue(user.id, row.phone, platform)) };
  }

  async refresh(refreshToken: string) {
    const [sid, secret] = refreshToken.split('.');
    if (!sid || !secret || !/^[0-9a-f-]{36}$/.test(sid)) throw new AppError('SESSION_INVALID', 'Sign in again.', 401);
    const [s] = await this.db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
    if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now() || !safeEqual(s.refreshHash, sha256(secret))) {
      throw new AppError('SESSION_INVALID', 'Sign in again.', 401);
    }
    const [u] = await this.db.select().from(users).where(and(eq(users.id, s.userId), isNull(users.deletedAt))).limit(1);
    if (!u) throw new AppError('SESSION_INVALID', 'Sign in again.', 401);
    // rotate: the old refresh token stops working the moment a new one is issued
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
    return this.tokens(u.id, u.phone, s.platform ?? undefined);
  }

  async logout(refreshToken: string) {
    const [sid] = refreshToken.split('.');
    if (sid && /^[0-9a-f-]{36}$/.test(sid)) {
      await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sid));
    }
    return { ok: true };
  }

  private async findUser(phone: string) {
    const [u] = await this.db.select().from(users).where(and(eq(users.phone, phone), isNull(users.deletedAt))).limit(1);
    return u ?? null;
  }

  private async createUser(phone: string, p: Profile) {
    const [u] = await this.db
      .insert(users)
      .values({ phone, firstName: p.firstName.trim(), familyName: p.familyName.trim(), city: p.city.trim(), lang: p.lang ?? 'en' })
      .returning();
    return u;
  }

  private async tokens(userId: string, phone: string, platform?: string) {
    const secret = randomToken(32);
    const [s] = await this.db
      .insert(sessions)
      .values({
        userId,
        refreshHash: sha256(secret),
        platform,
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86400_000),
      })
      .returning({ id: sessions.id });
    return { accessToken: signUserAccess({ sub: userId, phone }), refreshToken: `${s.id}.${secret}` };
  }

  private async issue(userId: string, phone: string, platform?: string) {
    const tokens = await this.tokens(userId, phone, platform);
    return { tokens, me: await this.me.me(userId) };
  }
}
