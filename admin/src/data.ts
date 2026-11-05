/*
 * Everything the dashboard reads and writes. The browser goes straight to Firestore and Storage,
 * and firestore.rules + storage.rules decide what it may do. Team accounts, Excel work and changes
 * that have to tell someone go through the API (/v1/team, functions/src/team/team.routes.ts).
 */
import { getAuth } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import {
  collection,
  collectionGroup,
  CollectionReference,
  deleteDoc,
  doc,
  DocumentSnapshot,
  getCountFromServer,
  getDoc,
  getDocs,
  Query,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  WriteBatch,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as fileRef, uploadBytes } from 'firebase/storage';
import { ApiError, Json, Role } from './api';
import { firebase } from './firebase';
import { clock12, couple, dayLabel, FunctionInput, fnValues, localParts, newInvite, prettyPhone, qrToken, toE164 } from './local';

const db = () => firebase().db;
const c = (path: string) => collection(db(), path);
const d = (path: string) => doc(db(), path);
const uid = () => {
  const u = getAuth(firebase().app).currentUser?.uid;
  if (!u) throw new ApiError('UNAUTHORIZED', 'Sign in to continue', 401);
  return u;
};
const now = serverTimestamp;

/* ───────── errors ───────── */

const SAYS: Record<string, [string, string, number]> = {
  'permission-denied': ['FORBIDDEN', 'You do not have access to this', 403],
  unauthenticated: ['UNAUTHORIZED', 'Sign in to continue', 401],
  unavailable: ['NETWORK', 'Could not reach the server. Check your connection and try again.', 0],
  'storage/unauthorized': ['FORBIDDEN', 'That file was refused: check its type and size, and that you may upload here', 403],
  'storage/retry-limit-exceeded': ['NETWORK', 'The upload took too long. Please try again.', 0],
};

function friendly(e: unknown): unknown {
  if (!(e instanceof FirebaseError)) return e;
  const known = SAYS[e.code] ?? SAYS[e.code.replace(/^firestore\//, '')];
  return known ? new ApiError(known[0], known[1], known[2]) : e;
}

/** every call below goes through this, so screens only ever see an ApiError */
const safe =
  <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
  async (...a: A): Promise<R> => {
    try {
      return await fn(...a);
    } catch (e) {
      throw friendly(e);
    }
  };

const notFound = (what: string) => new ApiError('NOT_FOUND', `${what} not found`, 404);
const conflict = (code: string, message: string) => new ApiError(code, message, 409);

/* ───────── reading ───────── */

/** dates come back as ISO strings, as the screens format them */
function plain(v: unknown): any {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
const row = (s: DocumentSnapshot | QueryDocumentSnapshot): Json => ({ ...plain(s.data()), id: s.id });
const rows = async (q: Query): Promise<Json[]> => (await getDocs(q)).docs.map(row);
const one = async (path: string): Promise<Json | null> => {
  const s = await getDoc(d(path));
  return s.exists() ? row(s) : null;
};
const count = async (q: Query) => (await getCountFromServer(q)).data().count;
async function byIds(path: string, ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const found = await Promise.all(uniq.map((id) => one(`${path}/${id}`)));
  return new Map(found.filter((x): x is Json => !!x).map((x) => [x.id, x]));
}

const byNewest = (a: Json, b: Json) => String(b.createdAt).localeCompare(String(a.createdAt));
const page = <T,>(xs: T[], q: { limit?: number; offset?: number }) => xs.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50));
const phoneOf = (p: string, field: string) => {
  const e = toE164(p);
  if (!e) throw new ApiError('VALIDATION', 'Enter a valid mobile number', 422, { [field]: 'Enter a valid mobile number' });
  return e;
};
const audit = (b: WriteBatch, action: string, weddingId: string | null, data: Json | null = null) =>
  b.set(doc(c('auditLog')), { actorType: 'admin', actorId: uid(), action, weddingId, data, createdAt: now() });

async function liveFunctions(weddingId: string) {
  const fns = await rows(query(c(`weddings/${weddingId}/functions`), where('deletedAt', '==', null)));
  return fns.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || a.sort - b.sort);
}
async function wedding(id: string) {
  const w = await one(`weddings/${id}`);
  if (!w) throw notFound('Wedding');
  return w;
}

/* ───────── the API ───────── */

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://api.invitekaroo.com').replace(/\/$/, '');

async function team(method: string, path: string, body?: Json): Promise<Response> {
  const token = await getAuth(firebase().app).currentUser?.getIdToken();
  if (!token) throw new ApiError('UNAUTHORIZED', 'Sign in to continue', 401);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/team${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection and try again.', 0);
  }
  if (res.ok) return res;
  const err = ((await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error;
  throw new ApiError(err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status})`, res.status, err?.fields);
}
const teamJson = async <T = any,>(method: string, path: string, body?: Json): Promise<T> => (await (await team(method, path, body)).json()) as T;

async function saveDownload(path: string, fallbackName: string) {
  const res = await team('GET', path);
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/* ───────── files ───────── */

const SIZE_MB = { image: 10, video: 30, pdf: 15, audio: 20 };
function checkFile(file: File, kind: keyof typeof SIZE_MB) {
  if (file.size > SIZE_MB[kind] * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE', `Files here can be at most ${SIZE_MB[kind]} MB`, 413);
}

async function put(folder: string, file: File) {
  const ext = (/\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? '').toLowerCase();
  const key = `${folder}/${crypto.randomUUID()}${ext}`;
  const r = fileRef(firebase().storage, key);
  await uploadBytes(r, file, { contentType: file.type || undefined });
  return { key, url: await getDownloadURL(r), name: file.name, size: file.size };
}
/** best effort: a file left behind costs little, a failed save would cost more */
const removeFile = (key: string) => deleteObject(fileRef(firebase().storage, key)).catch(() => undefined);

/** opens a stored file in a new tab, through its download link */
export const openFile = safe(async (key: string) => {
  window.open(await getDownloadURL(fileRef(firebase().storage, key)), '_blank', 'noopener');
});

/* ───────── me + team ───────── */

export const whoAmI = safe(async () => {
  const me = await one(`admins/${uid()}`);
  if (!me?.active) throw new ApiError('NOT_TEAM', 'This account is not on the Invite Karoo team', 403);
  await updateDoc(d(`admins/${me.id}`), { lastLoginAt: now() });
  return { id: me.id, email: me.email as string, name: me.name as string, role: me.role as Role };
});

export const teamMembers = safe(async () => (await rows(c('admins'))).sort((a, b) => a.name.localeCompare(b.name)));
export const addMember = safe((b: Json) => teamJson('POST', '/members', b));
export const editMember = safe((id: string, b: Json) => teamJson('PATCH', `/members/${id}`, b));

/* ───────── dashboard ───────── */

export const stats = safe(async () => {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const users = query(c('users'), where('deletedAt', '==', null));
  const [u, u7, w, wl, g, apps, tk, rs] = await Promise.all([
    count(users),
    count(query(users, where('createdAt', '>=', weekAgo))),
    count(c('weddings')),
    count(query(c('weddings'), where('status', '==', 'active'))),
    count(query(collectionGroup(db(), 'guests'), where('active', '==', true))),
    count(query(c('applications'), where('status', '==', 'new'))),
    count(query(c('tickets'), where('status', '==', 'open'))),
    count(query(collectionGroup(db(), 'invites'), where('respondedAt', '>=', weekAgo))),
  ]);
  return { users: u, newUsers7d: u7, weddings: w, liveWeddings: wl, guests: g, newApplications: apps, openTickets: tk, replies7d: rs };
});

/* ───────── host applications ───────── */

type Page = { q?: string; status?: string; limit?: number; offset?: number };
const byStatus = (col: CollectionReference, status?: string) => (status ? query(col, where('status', '==', status)) : col);

export const applications = safe(async (q: Page) => {
  const all = (await rows(byStatus(c('applications'), q.status))).sort(byNewest);
  const shown = page(all, q);
  const users = await byIds('users', shown.map((a) => a.userId ?? ''));
  const admins = await byIds('admins', shown.map((a) => a.assignedTo ?? ''));
  return {
    total: all.length,
    items: shown.map((a): Json => {
      const u = a.userId ? users.get(a.userId) : undefined;
      return {
        ...a,
        phonePretty: prettyPhone(a.phone),
        applicant: u ? `${u.firstName} ${u.familyName}` : null,
        assignedName: a.assignedTo ? (admins.get(a.assignedTo)?.name ?? null) : null,
      };
    }),
  };
});

export const application = safe(async (id: string): Promise<Json> => {
  const a = await one(`applications/${id}`);
  if (!a) throw notFound('Application');
  return { ...a, phonePretty: prettyPhone(a.phone) };
});

export const patchApplication = safe(async (id: string, b: Json) => {
  await updateDoc(d(`applications/${id}`), { ...b, updatedAt: now() });
  return { id };
});

/** turns an application into a draft wedding, importing its sheet if it came with one */
export const weddingFromApplication = safe((id: string) => teamJson('POST', `/applications/${id}/wedding`));

/* ───────── weddings ───────── */

export const weddings = safe(async (q: Page) => {
  let all = await rows(byStatus(c('weddings'), q.status));
  if (q.q) {
    const s = q.q.toLowerCase();
    const digits = q.q.replace(/\D/g, '');
    all = all.filter((w) => w.bride.name.toLowerCase().includes(s) || w.groom.name.toLowerCase().includes(s) || w.city.toLowerCase().includes(s) || (!!digits && w.ownerPhone.includes(digits)));
  }
  all.sort((a, b) => b.startDate.localeCompare(a.startDate));
  const shown = page(all, q);
  const counts = await Promise.all(
    shown.map(async (w) => {
      const [g, f] = await Promise.all([
        count(query(c(`weddings/${w.id}/guests`), where('active', '==', true))),
        count(query(c(`weddings/${w.id}/functions`), where('deletedAt', '==', null))),
      ]);
      return { g, f };
    }),
  );
  return {
    total: all.length,
    items: shown.map((w, i) => ({
      id: w.id,
      couple: couple(w as never),
      bride: w.bride.name,
      groom: w.groom.name,
      city: w.city,
      startDate: w.startDate,
      endDate: w.endDate,
      status: w.status,
      ownerPhone: prettyPhone(w.ownerPhone),
      handedOverAt: w.handedOverAt,
      guests: counts[i].g,
      functions: counts[i].f,
    })),
  };
});

export const getWedding = safe(async (id: string): Promise<Json> => {
  const base = `weddings/${id}`;
  const w = await wedding(id);
  const [fns, inv, gs, media, access, bl] = await Promise.all([
    liveFunctions(id),
    rows(query(c(`${base}/invites`), where('invited', '==', true))),
    rows(query(c(`${base}/guests`), where('active', '==', true))),
    rows(c(`${base}/media`)),
    rows(query(c(`${base}/access`), where('removedAt', '==', null))),
    rows(c(`${base}/blasts`)),
  ]);
  const activeGuests = new Set(gs.map((g) => g.id));
  const live = inv.filter((i) => activeGuests.has(i.guestId));
  media.sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort);
  return {
    ...w,
    ownerPhonePretty: prettyPhone(w.ownerPhone),
    couple: couple(w as never),
    guestCount: gs.length,
    functions: fns.map((f) => {
      const starts = new Date(f.startsAt);
      const lp = localParts(starts, w.timezone);
      const here = live.filter((x) => x.functionId === f.id);
      return {
        ...f,
        date: lp.date,
        start: lp.time,
        end: f.endsAt ? localParts(new Date(f.endsAt), w.timezone).time : null,
        dayLabel: dayLabel(starts, w.timezone),
        timeLabel: clock12(starts, w.timezone),
        invited: here.length,
        going: here.filter((x) => x.rsvp === 'going').length,
        giftOut: here.filter((x) => x.giftOut).length,
        blasts: bl.filter((b) => b.functionId === f.id).map((b) => ({ kind: b.kind, state: b.state, sentAt: b.sentAt, recipientCount: b.recipientCount })),
      };
    }),
    media,
    access: access.map((a) => ({ ...a, phonePretty: prettyPhone(a.phone) })),
  };
});

export const createWedding = safe(async (b: Json) => {
  const ref = doc(c('weddings'));
  const batch = writeBatch(db());
  batch.set(ref, {
    ownerPhone: phoneOf(b.ownerPhone, 'ownerPhone'),
    contactPhone: b.contactPhone ? phoneOf(b.contactPhone, 'contactPhone') : null,
    city: b.city,
    timezone: b.timezone ?? 'Asia/Kolkata',
    startDate: b.startDate,
    endDate: b.endDate,
    datesLocked: b.datesLocked ?? true,
    status: 'draft',
    statusReason: null,
    sendingEnabled: true,
    bride: b.bride,
    groom: b.groom,
    brideFamily: b.brideFamily,
    groomFamily: b.groomFamily,
    card: null,
    voice: null,
    applicationId: null,
    handedOverAt: null,
    endedAt: null,
    createdBy: uid(),
    createdAt: now(),
    updatedAt: now(),
  });
  audit(batch, 'wedding.create', ref.id);
  await batch.commit();
  return { id: ref.id };
});

export const updateWedding = safe(async (id: string, patch: Json) => {
  const w = await wedding(id);
  const set: Json = { updatedAt: now() };
  for (const k of ['city', 'timezone', 'startDate', 'endDate', 'datesLocked', 'bride', 'groom', 'brideFamily', 'groomFamily', 'status', 'statusReason', 'sendingEnabled']) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (patch.ownerPhone) set.ownerPhone = phoneOf(patch.ownerPhone, 'ownerPhone');
  if (patch.contactPhone !== undefined) set.contactPhone = patch.contactPhone ? phoneOf(patch.contactPhone, 'contactPhone') : null;
  if (patch.status === 'ended' && !w.endedAt) set.endedAt = now();
  const batch = writeBatch(db());
  batch.update(d(`weddings/${id}`), set);
  audit(batch, 'wedding.update', id, { fields: Object.keys(set) });
  await batch.commit();
  return getWedding(id);
});

/** opens the console on the owner's number and makes the wedding visible to guests */
export const handover = safe(async (id: string) => {
  await teamJson('POST', `/weddings/${id}/handover`);
  return getWedding(id);
});

/* ───────── functions ───────── */

export const addFunction = safe(async (weddingId: string, f: FunctionInput) => {
  const w = await wedding(weddingId);
  if (w.datesLocked && (f.date < w.startDate || f.date > w.endDate)) {
    throw new ApiError('OUTSIDE_DATES', `This date is outside the wedding’s dates (${w.startDate} to ${w.endDate})`, 422, { date: 'Outside the wedding dates' });
  }
  const ref = doc(c(`weddings/${weddingId}/functions`));
  const batch = writeBatch(db());
  batch.set(ref, { weddingId, ...fnValues(w as never, f), createdAt: now(), updatedAt: now(), deletedAt: null });
  audit(batch, 'function.add', weddingId, { functionId: ref.id });
  await batch.commit();
  return { id: ref.id };
});

/** on the server, which tells the guests of a live wedding */
export const updateFunction = safe((weddingId: string, fnId: string, f: Partial<FunctionInput>) => teamJson('PATCH', `/weddings/${weddingId}/functions/${fnId}`, f));

export const deleteFunction = safe(async (weddingId: string, fnId: string) => {
  const batch = writeBatch(db());
  batch.update(d(`weddings/${weddingId}/functions/${fnId}`), { deletedAt: now() });
  audit(batch, 'function.delete', weddingId, { functionId: fnId });
  await batch.commit();
  return { ok: true };
});

/* ───────── guests ───────── */

export const guests = safe(async (weddingId: string, q: { q?: string; removed?: boolean; limit: number; offset: number }) => {
  let all = await rows(query(c(`weddings/${weddingId}/guests`), where('active', '==', !q.removed)));
  if (q.q) {
    const s = q.q.toLowerCase();
    const digits = q.q.replace(/\D/g, '');
    all = all.filter((g) => g.name.toLowerCase().includes(s) || (!!digits && g.phone.includes(digits)));
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  const shown = page(all, q);
  const ids = new Set(shown.map((g) => g.id));
  const inv = shown.length ? (await rows(query(c(`weddings/${weddingId}/invites`), where('invited', '==', true)))).filter((i) => ids.has(i.guestId)) : [];
  return {
    total: all.length,
    items: shown.map((g) => ({
      ...g,
      phonePretty: prettyPhone(g.phone),
      functions: inv.filter((i) => i.guestId === g.id).map((i) => ({ functionId: i.functionId, rsvp: i.rsvp, pax: i.pax, giftOut: i.giftOut, giftOutGiven: i.giftOutGiven })),
    })),
  };
});

type GuestIn = { name: string; phone: string; side: 'bride' | 'groom'; relation: string; expectedPax: number; notes: string; functions: { functionId: string; giftOut: boolean }[] };

/** The browser SDK cannot query inside a transaction, so two people adding one number at the same moment could both succeed. */
export const saveGuest = safe(async (weddingId: string, guestId: string | null, b: GuestIn) => {
  const base = `weddings/${weddingId}`;
  const phone = phoneOf(b.phone, 'phone');
  const fns = await liveFunctions(weddingId);
  for (const f of b.functions) if (!fns.some((x) => x.id === f.functionId)) throw notFound('Function');
  const same = await rows(query(c(`${base}/guests`), where('phone', '==', phone), where('active', '==', true)));
  const dupe = same.find((g) => g.id !== guestId);
  if (dupe) throw conflict('GUEST_EXISTS', `${dupe.name} already has this number`);
  if (guestId && !(await getDoc(d(`${base}/guests/${guestId}`))).exists()) throw notFound('Guest');

  const gRef = guestId ? d(`${base}/guests/${guestId}`) : doc(c(`${base}/guests`));
  const current = guestId ? await rows(query(c(`${base}/invites`), where('guestId', '==', guestId))) : [];
  const fields = { name: b.name, phone, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes };
  const batch = writeBatch(db());
  if (guestId) batch.update(gRef, { ...fields, updatedAt: now() });
  else batch.set(gRef, { weddingId, ...fields, active: true, createdVia: 'admin', qrToken: qrToken(), createdAt: now(), updatedAt: now() });
  const have = new Set(current.map((i) => i.id));
  for (const f of b.functions) {
    const id = `${gRef.id}_${f.functionId}`;
    const ref = d(`${base}/invites/${id}`);
    if (have.has(id)) batch.update(ref, { invited: true, giftOut: f.giftOut, updatedAt: now() });
    else batch.set(ref, { ...newInvite(weddingId, gRef.id, f.functionId, f.giftOut), createdAt: now(), updatedAt: now() });
  }
  const keep = new Set(b.functions.map((f) => f.functionId));
  for (const i of current) {
    if (!keep.has(i.functionId) && i.invited) batch.update(d(`${base}/invites/${i.id}`), { invited: false, updatedAt: now() });
  }
  audit(batch, guestId ? 'guest.update' : 'guest.add', weddingId, { guestId: gRef.id });
  await batch.commit();
  return { id: gRef.id };
});

export const setGuestActive = safe(async (weddingId: string, guestId: string, active: boolean) => {
  const batch = writeBatch(db());
  batch.update(d(`weddings/${weddingId}/guests/${guestId}`), { active, updatedAt: now() });
  audit(batch, active ? 'guest.restore' : 'guest.remove', weddingId, { guestId });
  await batch.commit();
  return { ok: true };
});

/** The workbook goes through Storage: the API can take at most 4.5 MB in a request. */
export const importGuests = safe(async (weddingId: string, file: File, opts: { mode: string; dryRun: boolean; createFunctions: boolean }) => {
  if (file.size > 10 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE', 'Files here can be at most 10 MB', 413);
  const fileKey = `imports/${uid()}/${crypto.randomUUID()}`;
  await uploadBytes(fileRef(firebase().storage, fileKey), file);
  return teamJson('POST', `/weddings/${weddingId}/guests/import`, { fileKey, fileName: file.name, ...opts });
});

export const exportGuests = safe(async (weddingId: string) => {
  await saveDownload(`/weddings/${weddingId}/guests/export`, 'guests.xlsx');
  return true;
});

export const guestTemplate = safe(async () => {
  await saveDownload('/guest-template', 'invite-karoo-guest-list.xlsx');
  return true;
});

/* ───────── card, voice and photos ───────── */

export const addMedia = safe(async (weddingId: string, kind: 'cover' | 'couple' | 'family', file: File) => {
  const base = `weddings/${weddingId}`;
  const isVideo = file.type.startsWith('video/');
  checkFile(file, isVideo ? 'video' : 'image');
  if (isVideo && kind !== 'cover') throw new ApiError('VIDEO_COVER_ONLY', 'Videos can only go in the cover carousel', 422);
  if (isVideo && (await count(query(c(`${base}/media`), where('type', '==', 'video'))))) throw conflict('ONE_VIDEO', 'The cover can carry at most one video');
  const s = await put(`${base}/${kind}`, file);
  const sort = await count(query(c(`${base}/media`), where('kind', '==', kind)));
  const ref = doc(c(`${base}/media`));
  await setDoc(ref, { weddingId, kind, type: isVideo ? 'video' : 'image', key: s.key, url: s.url, posterUrl: null, sort, createdAt: now() });
  return { id: ref.id };
});

export const removeMedia = safe(async (weddingId: string, media: { id: string; key: string }) => {
  await deleteDoc(d(`weddings/${weddingId}/media/${media.id}`));
  await removeFile(media.key);
  return { ok: true };
});

export const reorderMedia = safe(async (weddingId: string, ids: string[]) => {
  const batch = writeBatch(db());
  ids.forEach((id, i) => batch.update(d(`weddings/${weddingId}/media/${id}`), { sort: i }));
  await batch.commit();
  return { ok: true };
});

export const setCard = safe(async (weddingId: string, pdf: File, pages: File[]) => {
  const w = await wedding(weddingId);
  checkFile(pdf, 'pdf');
  pages.forEach((p) => checkFile(p, 'image'));
  const s = await put(`weddings/${weddingId}/card`, pdf);
  const urls: string[] = [];
  for (const p of pages) urls.push((await put(`weddings/${weddingId}/card`, p)).url);
  if (w.card?.key) await removeFile(w.card.key);
  await updateDoc(d(`weddings/${weddingId}`), { card: { key: s.key, name: s.name, size: s.size, pages: urls }, updatedAt: now() });
  return getWedding(weddingId);
});

export const setVoice = safe(async (weddingId: string, audio: File, durationSec?: number) => {
  const w = await wedding(weddingId);
  checkFile(audio, 'audio');
  const s = await put(`weddings/${weddingId}/voice`, audio);
  if (w.voice?.key) await removeFile(w.voice.key);
  await updateDoc(d(`weddings/${weddingId}`), { voice: { key: s.key, url: s.url, durationSec: durationSec ?? null }, updatedAt: now() });
  return getWedding(weddingId);
});

export const setPersonPhoto = safe(async (weddingId: string, who: 'bride' | 'groom' | 'brideFamily' | 'groomFamily', img: File) => {
  const w = await wedding(weddingId);
  checkFile(img, 'image');
  const s = await put(`weddings/${weddingId}/people`, img);
  await updateDoc(d(`weddings/${weddingId}`), { [who]: { ...w[who], photoUrl: s.url }, updatedAt: now() });
  return getWedding(weddingId);
});

/* ───────── family access (team side) ───────── */

export const addAccess = safe(async (weddingId: string, b: { name: string; phone: string; relation: string }) => {
  const phone = phoneOf(b.phone, 'phone');
  const live = await rows(query(c(`weddings/${weddingId}/access`), where('removedAt', '==', null)));
  if (live.some((a) => a.phone === phone)) throw conflict('ALREADY_MEMBER', 'This number already has access');
  await setDoc(doc(c(`weddings/${weddingId}/access`)), { weddingId, phone, name: b.name, relation: b.relation, role: 'cohost', addedBy: `admin:${uid()}`, addedAt: now(), removedAt: null });
  return getWedding(weddingId);
});

export const removeAccess = safe(async (weddingId: string, accessId: string) => {
  await updateDoc(d(`weddings/${weddingId}/access/${accessId}`), { removedAt: now() });
  return getWedding(weddingId);
});

/* ───────── users ───────── */

export const users = safe(async (q: Page) => {
  let all = await rows(query(c('users'), where('deletedAt', '==', null)));
  if (q.q) {
    const s = q.q.toLowerCase();
    const digits = q.q.replace(/\D/g, '');
    all = all.filter((u) => u.firstName.toLowerCase().includes(s) || u.familyName.toLowerCase().includes(s) || u.city.toLowerCase().includes(s) || (!!digits && u.phone.includes(digits)));
  }
  all.sort(byNewest);
  return {
    total: all.length,
    items: page(all, q).map((u) => ({ id: u.id, name: `${u.firstName} ${u.familyName}`, city: u.city, phonePretty: prettyPhone(u.phone), email: u.email, lang: u.lang, createdAt: u.createdAt })),
  };
});

/* ───────── support ───────── */

const ticketView = (t: Json) => ({
  id: t.id,
  number: `IK-${String(t.number).padStart(5, '0')}`,
  subject: t.subject,
  category: t.category,
  status: t.status,
  weddingId: t.weddingId,
  unread: t.unreadForUser,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  closedAt: t.closedAt,
});
const ticketUser = (id: string, u?: Json | null) => ({ id, name: u ? `${u.firstName} ${u.familyName}` : 'Deleted user', phonePretty: u ? prettyPhone(u.phone) : '', city: u?.city ?? '' });

export const tickets = safe(async (q: Page) => {
  const all = (await rows(byStatus(c('tickets'), q.status))).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const shown = page(all, q);
  const people = await byIds('users', shown.map((t) => t.userId));
  return { total: all.length, items: shown.map((t) => ({ ...ticketView(t), unreadForTeam: t.unreadForTeam, user: ticketUser(t.userId, people.get(t.userId)) })) };
});

export const ticket = safe(async (id: string): Promise<Json> => {
  const t = await one(`tickets/${id}`);
  if (!t) throw notFound('Ticket');
  const u = await one(`users/${t.userId}`);
  await updateDoc(d(`tickets/${id}`), { unreadForTeam: 0 });
  const msgs = (await rows(c(`tickets/${id}/messages`))).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const admins = await byIds('admins', msgs.map((m) => m.adminId ?? ''));
  return {
    ...ticketView(t),
    user: ticketUser(t.userId, u),
    messages: msgs.map((m) => ({ id: m.id, author: m.author, adminName: m.adminId ? (admins.get(m.adminId)?.name ?? null) : null, body: m.body, createdAt: m.createdAt })),
  };
});

/** on the server, which tells the user */
export const replyTicket = safe(async (id: string, body: string) => {
  await teamJson('POST', `/tickets/${id}/messages`, { body });
  return ticket(id);
});

export const setTicketStatus = safe(async (id: string, status: string) => {
  await updateDoc(d(`tickets/${id}`), { status, closedAt: status === 'closed' ? now() : null, updatedAt: now() });
  return { id };
});

/* ───────── lookup ───────── */

/** guests across all weddings by phone: "which weddings is this number on?" */
export const lookupPhone = safe(async (phone: string) => {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 6) return [];
  // numbers are stored E.164; try the usual country codes for a 10-digit number
  const candidates = [...new Set([`+91${digits}`, `+${phone.replace(/\D/g, '')}`])];
  const gs = (await Promise.all(candidates.map((p) => rows(query(collectionGroup(db(), 'guests'), where('phone', '==', p)))))).flat().slice(0, 50);
  const ws = await byIds('weddings', gs.map((g) => g.weddingId));
  const inv = await Promise.all(gs.map((g) => rows(query(c(`weddings/${g.weddingId}/invites`), where('guestId', '==', g.id), where('invited', '==', true)))));
  return gs.map((g, i) => {
    const w = ws.get(g.weddingId);
    return { guestId: g.id, name: g.name as string, active: g.active as boolean, weddingId: g.weddingId as string, wedding: w ? couple(w as never) : '', invites: inv[i].length };
  });
});
