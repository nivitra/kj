'use client';
import { useRef, useState } from 'react';
import { Link as LinkIcon, Copy, Share2, Check, ArrowUpRight, LockKeyhole, LoaderCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import Modal from './Modal';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.warmkelvin.com/api';
export function customerLink(path: string) {
  const base = process.env.NEXT_PUBLIC_CUSTOMER_APP_URL || new URL(API_URL).origin.replace('://api.', '://app.');
  return new URL(path, base).toString();
}
export async function getShortLink(path: string): Promise<string> {
  const response = await api.post('/admin/links', { path });
  return response.data.data.url;
}
export default function ShareLinkButton({ path, title = 'Share link' }: { path: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const request = useRef(0);
  async function prepare() {
    const generation = ++request.current;
    setOpen(true); setBusy(true); setError(''); setUrl(''); setCopied(false);
    try { const link = await getShortLink(path); if (generation === request.current) setUrl(link); }
    catch (e: any) { if (generation === request.current) setError(e.response?.data?.error?.message || 'Could not prepare this link. Please try again.'); }
    finally { if (generation === request.current) setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); toast.success('Link copied'); }
    catch { toast.error('Select and copy the link below'); }
  }
  return <>
    <button type="button" className="btn-ghost inline-flex items-center whitespace-nowrap shrink-0 gap-2 px-3 py-2 text-sm" onClick={prepare}><LinkIcon size={15}/>{title}</button>
    <Modal open={open} onClose={() => { request.current++; setOpen(false); }} title={title === 'Client-only link' ? 'Share this gallery' : title} description="A short, reusable link to the exact item." size="md">
      <div className="share-access-note"><LockKeyhole size={18} className="shrink-0"/><p>{path.startsWith('/gallery/') ? 'Assigned clients can open this gallery with their invited account. Use the guest link or QR code for friends and family.' : 'The recipient signs in to open this item. Client documents keep their existing access permissions.'}</p></div>
      {busy && <div className="share-link-loading" role="status"><LoaderCircle size={20} className="animate-spin"/>Preparing your link…</div>}
      {error && <div role="alert" className="mt-4 space-y-3"><p style={{color:'var(--rose)'}}>{error}</p><button type="button" className="btn-ghost px-4 py-2" onClick={prepare}>Try again</button></div>}
      {url && <>
        <label className="block text-[12px] font-medium mt-5 mb-2" htmlFor={`share-${path.replace(/[^a-z0-9]/gi, '')}`}>Shareable link</label>
        <input id={`share-${path.replace(/[^a-z0-9]/gi, '')}`} aria-label="Share link" className="input w-full font-mono text-[13px]" readOnly value={url} onFocus={e => e.target.select()}/>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" className="btn-primary flex-1 px-4 py-2.5 inline-flex items-center justify-center gap-2" onClick={copy}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" className="btn-ghost flex-1 px-4 py-2.5 inline-flex items-center justify-center gap-2" onClick={async () => { try { if (navigator.share) await navigator.share({ title, url }); else await copy(); } catch (e) { if ((e as Error).name !== 'AbortError') toast.error('Use Copy link to share this item'); } }}><Share2 size={16}/>Share</button>
          <a className="btn-ghost px-3 py-2.5 inline-flex items-center justify-center" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open shared link" title="Open shared link"><ArrowUpRight size={18}/></a>
        </div>
      </>}
    </Modal>
  </>;
}
