'use client';
import { useState } from 'react';
import { Copy, Link as LinkIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { customerLink, getShortLink } from './ShareLinkButton';
import Modal from './Modal';

export default function QuotationRequestLink({ quoteId }: { quoteId?: string }) {
  const studioId = useAuthStore(s => s.admin?.studio?.id);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState('');
  async function copy() {
    if (!studioId || busy) return;
    setBusy(true);
    try {
      let path = `/quotation-request?${new URLSearchParams({ studioId })}`;
      if (quoteId) {
        const response = await api.get(`/admin/quotes/${quoteId}/request-link`);
        path = response.data.data.path;
      }
      const url = quoteId ? customerLink(path) : await getShortLink(path);
      try { await navigator.clipboard.writeText(url); toast.success(quoteId ? 'Private tracking link copied' : 'Quotation request link copied'); }
      catch { setFallback(url); }
    } catch { toast.error('Could not get the link. Please try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn-secondary inline-flex items-center gap-2 px-4 py-2.5 text-sm" disabled={!studioId || busy} onClick={copy}>
      {quoteId ? <LinkIcon size={16}/> : <Copy size={16}/>}{busy ? 'Getting link…' : quoteId ? 'Copy tracking link' : 'Copy link'}
    </button>
    <Modal open={!!fallback} onClose={() => setFallback('')} title={quoteId ? 'Private quotation tracking link' : 'Quotation request link'}>
      <p className="text-sm mb-4">{quoteId ? 'Anyone with this private link can view this request and its published PDFs. Share it with the client.' : 'Anyone can open this link and request a wedding or corporate quotation. No sign-in is required.'}</p>
      <input aria-label="Quotation request link" className="input w-full" readOnly value={fallback} onFocus={e => e.target.select()}/>
    </Modal>
  </>;
}
