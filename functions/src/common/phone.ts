import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

/**
 * Turns whatever a person typed (or a spreadsheet cell held) into E.164.
 * `+91 98644 55120`, `09864455120`, `9864455120` → `+919864455120`.
 * Returns null when it is not a valid mobile number.
 */
export function toE164(input: string, cc = '+91'): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  const ccDigits = cc.replace(/\D/g, '');
  if (!digits.startsWith('+')) {
    digits = digits.replace(/^0+/, '');
    // a 12-digit Indian number typed without the + (919864455120)
    if (ccDigits === '91' && digits.length === 12 && digits.startsWith('91')) digits = '+' + digits;
    else digits = '+' + ccDigits + digits;
  }
  const p = parsePhoneNumberFromString(digits);
  if (!p || !p.isValid()) return null;
  return p.number;
}

/** split +919864455120 into { cc: '+91', mobile: '9864455120' } for display */
export function splitE164(e164: string): { cc: string; mobile: string } {
  const p = parsePhoneNumberFromString(e164);
  if (!p) return { cc: '', mobile: e164 };
  return { cc: '+' + p.countryCallingCode, mobile: p.nationalNumber };
}

/** "+91 98644 55120" */
export function prettyPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  if (!p) return e164;
  if (p.countryCallingCode === '91') {
    const n = p.nationalNumber;
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return p.formatInternational();
}

export function countryOf(e164: string): CountryCode | undefined {
  return parsePhoneNumberFromString(e164)?.country;
}
