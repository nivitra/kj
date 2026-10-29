'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { adminApi } from '@/lib/api';
import Modal from '@/components/Modal';

const roleBadge: Record<string, string> = { OWNER: 'badge-blue', MANAGER: 'badge-amber', STAFF: 'badge-neutral' };

export default function TeamPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const { register, handleSubmit, reset } = useForm<{ name: string; email: string; password: string; role: string }>();

  const { data: members } = useQuery({ queryKey: ['team'], queryFn: () => adminApi.team().then((r) => r.data) });

  const createMutation = useMutation({
    mutationFn: (d: any) => adminApi.createTeamMember(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Team member added'); setShowModal(false); reset(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7">
        <div>
          <p className="kicker mb-2">Team</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>Your team</h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>Who can access this dashboard.</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-4 py-2.5">
          <Plus size={16} /> Add member
        </button>
      </div>

      <div className="space-y-2.5">
        {members?.map((m: any) => (
          <div key={m.id} className="card flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm shrink-0" style={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}>{m.name[0]?.toUpperCase()}</div>
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--ink)' }}>{m.name}</div>
                <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>{m.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {m.lastLoginAt && <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Last seen {new Date(m.lastLoginAt).toLocaleDateString()}</span>}
              <span className={`badge ${roleBadge[m.role]}`}>{m.role.toLowerCase()}</span>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={showModal}
        onClose={() => !createMutation.isPending && setShowModal(false)}
        title="Add team member"
        description="They'll sign in with the temporary password you set."
        preventClose={createMutation.isPending}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost flex-1 py-2.5" disabled={createMutation.isPending}>Cancel</button>
            <button type="submit" form="add-team-form" disabled={createMutation.isPending} className="btn-primary flex-1 py-2.5">{createMutation.isPending ? 'Adding…' : 'Add member'}</button>
          </>
        }
      >
        <form id="add-team-form" onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
          <input {...register('name', { required: true })} placeholder="Full name" className="input" />
          <input {...register('email', { required: true })} type="email" placeholder="Email" className="input" />
          <input {...register('password', { required: true })} type="password" placeholder="Temporary password" className="input" />
          <select {...register('role')} className="input">
            <option value="STAFF">Staff — upload &amp; manage photos</option>
            <option value="MANAGER">Manager — full access except billing</option>
          </select>
        </form>
      </Modal>
    </div>
  );
}
