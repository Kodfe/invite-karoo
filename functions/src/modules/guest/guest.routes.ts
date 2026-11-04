import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { zDate } from '../../common/zod';
import { routes } from '../../common/http';
import { svc } from '../../services';

const Rsvp = z.object({
  rsvp: z.enum(['going', 'not_going', 'maybe']),
  pax: z.number().int().min(0).max(20).default(1),
});
const Reminders = z.object({
  offDefaults: z.array(z.number().int()).max(6).default([]),
  mine: z.array(z.number().int()).max(6).default([]),
});
const Range = z.object({ from: zDate, to: zDate });

export function guestRoutes() {
  const r = routes('/v1');

  /** the Invites list behind the Home card */
  r.get('invitations', (c) => svc.guest.invitations(c.uid, c.search.get('finished') === '1' || c.search.get('finished') === 'true'));

  /** wedding functions between two dates (inclusive from, exclusive to) — for the agenda */
  r.get('invitations/agenda', (c) => {
    const q = c.query(Range);
    return svc.guest.agenda(c.uid, new Date(q.from + 'T00:00:00+05:30'), new Date(q.to + 'T00:00:00+05:30'));
  });

  r.get('weddings/:wid', (c) => svc.guest.wedding(c.uid, c.id('wid')));

  r.get('weddings/:wid/card.pdf', async (c) => {
    const card = await svc.guest.cardKey(c.uid, c.id('wid'));
    const buf = await svc.storage.read(card.key);
    c.send(buf, 'application/pdf', `inline; filename="${card.name.replace(/"/g, '')}"`);
  });

  r.get('weddings/:wid/qr', (c) => svc.guest.qr(c.uid, c.id('wid')));

  r.get('weddings/:wid/functions/:fid', (c) => svc.guest.fn(c.uid, c.id('wid'), c.id('fid')));

  /** send my reply — the only call that tells the hosts anything */
  r.post('weddings/:wid/functions/:fid/rsvp', (c) => {
    const b = c.body(Rsvp);
    return svc.guest.rsvp(c.uid, c.id('wid'), c.id('fid'), b.rsvp, b.pax);
  });

  /** my private reminders on this function (minutes before start) */
  r.put('weddings/:wid/functions/:fid/reminders', (c) => {
    const b = c.body(Reminders);
    return svc.guest.setReminders(c.uid, c.id('wid'), c.id('fid'), b.offDefaults, b.mine);
  });
}
