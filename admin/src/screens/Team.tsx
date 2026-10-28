'use client';
import { FormEvent, useState } from 'react';
import { api, can, Role } from '../api';
import { useAuth } from '../auth';
import { ago, Btn, Empty, ErrorNote, Field, Loading, Modal, PageHead, Pill, useAction, useConfirm, useLoad } from '../ui';

type Member = { id: string; email: string; name: string; role: Role; active: boolean; lastLoginAt: string | null; createdAt: string };

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including the team',
  setup: 'Sets up weddings: functions, guest lists, photos, handover',
  support: 'Answers tickets; can look at weddings but not change them',
};

export function TeamPage() {
  const { admin } = useAuth();
  const list = useLoad(() => api.get<Member[]>('/team'), []);
  const [edit, setEdit] = useState<Member | 'new' | null>(null);
  const confirm = useConfirm();
  const act = useAction();

  if (!can(admin?.role, 'admin')) return <Empty title="Only admins can manage the team" />;

  const toggle = async (m: Member) => {
    if (m.active && !(await confirm({ title: `Turn off ${m.name}?`, body: 'They will not be able to sign in. You can turn them back on later.', ok: 'Turn off', danger: true }))) return;
    await act.run(() => api.patch(`/team/${m.id}`, { active: !m.active }), m.active ? `${m.name} can no longer sign in` : `${m.name} can sign in again`);
    list.reload();
  };

  return (
    <>
      <PageHead title="Team" sub="Who can sign in to this console" actions={<Btn kind="primary" onClick={() => setEdit('new')}>Add a team member</Btn>} />
      <ErrorNote>{list.error ?? act.error}</ErrorNote>
      <div className="card flush">
        {!list.data ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th className="hide-sm">Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'dim'}>
                  <td>
                    {m.name} {m.id === admin?.id ? <span className="muted">(you)</span> : null}
                  </td>
                  <td>{m.email}</td>
                  <td>
                    <Pill v={m.role} /> {m.active ? null : <Pill tone="muted">Off</Pill>}
                  </td>
                  <td className="hide-sm">{m.lastLoginAt ? ago(m.lastLoginAt) : 'Never'}</td>
                  <td className="row-actions">
                    <Btn small onClick={() => setEdit(m)}>
                      Edit
                    </Btn>
                    {m.id !== admin?.id ? (
                      <Btn small kind={m.active ? 'danger' : 'ghost'} onClick={() => toggle(m)}>
                        {m.active ? 'Turn off' : 'Turn on'}
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit ? (
        <MemberForm
          member={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function MemberForm({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'setup');
  const [password, setPassword] = useState('');
  const act = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = member
      ? await act.run(() => api.patch(`/team/${member.id}`, { name, role, ...(password ? { password } : {}) }), 'Saved')
      : await act.run(() => api.post('/team', { name, email, role, password }), `${name} added`);
    if (r) onSaved();
  };

  return (
    <Modal
      title={member ? `Edit ${member.name}` : 'Add a team member'}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" form="member-form" busy={act.busy}>
            {member ? 'Save' : 'Add'}
          </Btn>
        </>
      }
    >
      <form id="member-form" className="form" onSubmit={submit}>
        <Field label="Name" error={act.fields.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </Field>
        <Field label="Email" error={act.fields.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!member} />
        </Field>
        <Field label="Role" hint={ROLE_HELP[role]}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="admin">Admin</option>
            <option value="setup">Setup</option>
            <option value="support">Support</option>
          </select>
        </Field>
        <Field label={member ? 'New password (leave empty to keep)' : 'Password'} hint="At least 10 characters. Share it with them privately; they can change it under My account." error={act.fields.password}>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!member} minLength={10} />
        </Field>
        <ErrorNote>{act.error}</ErrorNote>
      </form>
    </Modal>
  );
}
