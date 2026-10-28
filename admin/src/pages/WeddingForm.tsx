import { FormEvent, useState } from 'react';
import { Btn, ErrorNote, Field } from '../ui';

export type Person = { name: string; parents?: string; city?: string; photoUrl?: string | null };
export type Family = { name: string; elders: string[]; city?: string; photoUrl?: string | null };
export type WeddingValues = {
  ownerPhone: string;
  contactPhone: string | null;
  city: string;
  startDate: string;
  endDate: string;
  datesLocked: boolean;
  bride: Person;
  groom: Person;
  brideFamily: Family;
  groomFamily: Family;
};

export const emptyWedding = (): WeddingValues => ({
  ownerPhone: '',
  contactPhone: null,
  city: '',
  startDate: '',
  endDate: '',
  datesLocked: true,
  bride: { name: '', parents: '' },
  groom: { name: '', parents: '' },
  brideFamily: { name: '', elders: [] },
  groomFamily: { name: '', elders: [] },
});

/** turns the API's wedding into form values */
export const weddingValues = (w: any): WeddingValues => ({
  ownerPhone: w.ownerPhonePretty ?? w.ownerPhone ?? '',
  contactPhone: w.contactPhone ?? null,
  city: w.city ?? '',
  startDate: w.startDate ?? '',
  endDate: w.endDate ?? '',
  datesLocked: w.datesLocked ?? true,
  bride: { ...w.bride },
  groom: { ...w.groom },
  brideFamily: { ...w.brideFamily, elders: w.brideFamily?.elders ?? [] },
  groomFamily: { ...w.groomFamily, elders: w.groomFamily?.elders ?? [] },
});

/** what the API wants back (people's cities follow the wedding city unless set) */
export function weddingPayload(v: WeddingValues) {
  const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== '' && x !== undefined));
  return {
    ownerPhone: v.ownerPhone.trim(),
    contactPhone: v.contactPhone?.trim() ? v.contactPhone.trim() : null,
    city: v.city.trim(),
    startDate: v.startDate,
    endDate: v.endDate || v.startDate,
    datesLocked: v.datesLocked,
    bride: clean({ ...v.bride, name: v.bride.name.trim(), city: v.bride.city || v.city.trim() }),
    groom: clean({ ...v.groom, name: v.groom.name.trim(), city: v.groom.city || v.city.trim() }),
    brideFamily: { ...clean({ ...v.brideFamily, city: v.brideFamily.city || v.city.trim() }), name: v.brideFamily.name.trim() || `${lastName(v.bride.name)} Family`, elders: v.brideFamily.elders.filter(Boolean) },
    groomFamily: { ...clean({ ...v.groomFamily, city: v.groomFamily.city || v.city.trim() }), name: v.groomFamily.name.trim() || `${lastName(v.groom.name)} Family`, elders: v.groomFamily.elders.filter(Boolean) },
  };
}
const lastName = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || 'The';

export function WeddingForm({
  initial,
  onSubmit,
  submitLabel,
  busy,
  error,
  fields,
  readOnly,
  onCancel,
}: {
  initial: WeddingValues;
  onSubmit: (v: WeddingValues) => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  fields?: Record<string, string>;
  readOnly?: boolean;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<WeddingValues>(initial);
  const f = fields ?? {};
  const set = <K extends keyof WeddingValues>(k: K, x: WeddingValues[K]) => setV((p) => ({ ...p, [k]: x }));
  const setP = (k: 'bride' | 'groom', x: Partial<Person>) => setV((p) => ({ ...p, [k]: { ...p[k], ...x } }));
  const setF = (k: 'brideFamily' | 'groomFamily', x: Partial<Family>) => setV((p) => ({ ...p, [k]: { ...p[k], ...x } }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(v);
  };

  return (
    <form className="form" onSubmit={submit}>
      <fieldset disabled={readOnly} className="plainset">
        <div className="form-cols">
          <div>
            <h3>Bride</h3>
            <Field label="Bride’s name" error={f['bride.name']}>
              <input value={v.bride.name} onChange={(e) => setP('bride', { name: e.target.value })} required maxLength={60} />
            </Field>
            <Field label="Daughter of" hint="e.g. Mr & Mrs Rajesh Sharma">
              <input value={v.bride.parents ?? ''} onChange={(e) => setP('bride', { parents: e.target.value })} maxLength={80} />
            </Field>
            <Field label="Family name" hint="Shown as “The Sharma Family”">
              <input value={v.brideFamily.name} onChange={(e) => setF('brideFamily', { name: e.target.value })} maxLength={60} placeholder={v.bride.name ? `${lastName(v.bride.name)} Family` : ''} />
            </Field>
            <Field label="Elders (one per line)">
              <textarea rows={3} value={v.brideFamily.elders.join('\n')} onChange={(e) => setF('brideFamily', { elders: e.target.value.split('\n') })} />
            </Field>
          </div>
          <div>
            <h3>Groom</h3>
            <Field label="Groom’s name" error={f['groom.name']}>
              <input value={v.groom.name} onChange={(e) => setP('groom', { name: e.target.value })} required maxLength={60} />
            </Field>
            <Field label="Son of">
              <input value={v.groom.parents ?? ''} onChange={(e) => setP('groom', { parents: e.target.value })} maxLength={80} />
            </Field>
            <Field label="Family name">
              <input value={v.groomFamily.name} onChange={(e) => setF('groomFamily', { name: e.target.value })} maxLength={60} placeholder={v.groom.name ? `${lastName(v.groom.name)} Family` : ''} />
            </Field>
            <Field label="Elders (one per line)">
              <textarea rows={3} value={v.groomFamily.elders.join('\n')} onChange={(e) => setF('groomFamily', { elders: e.target.value.split('\n') })} />
            </Field>
          </div>
        </div>
        <h3>Wedding</h3>
        <div className="form-cols three">
          <Field label="City" error={f.city}>
            <input value={v.city} onChange={(e) => set('city', e.target.value)} required minLength={2} maxLength={40} />
          </Field>
          <Field label="First day" error={f.startDate}>
            <input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} required />
          </Field>
          <Field label="Last day" error={f.endDate}>
            <input type="date" value={v.endDate} min={v.startDate} onChange={(e) => set('endDate', e.target.value)} required />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={v.datesLocked} onChange={(e) => set('datesLocked', e.target.checked)} />
          Functions must fall between these dates
        </label>
        <div className="form-cols">
          <Field label="Host’s mobile (owns the console)" hint="They sign in to the app with this number" error={f.ownerPhone}>
            <input inputMode="tel" value={v.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} required placeholder="98765 43210" />
          </Field>
          <Field label="Contact number for guests" hint="Shown to guests. Leave empty to show none — never a host’s personal number unless they agree." error={f.contactPhone}>
            <input inputMode="tel" value={v.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </fieldset>
      <ErrorNote>{error}</ErrorNote>
      {readOnly ? null : (
        <div className="row-end">
          {onCancel ? <Btn onClick={onCancel}>Cancel</Btn> : null}
          <Btn kind="primary" type="submit" busy={busy}>
            {submitLabel}
          </Btn>
        </div>
      )}
    </form>
  );
}
