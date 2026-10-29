'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import Modal from './Modal';
export default function PdfUploadButton({ endpoint, onUploaded, beforeUpload, updatedAt, disabled = false }: { endpoint: string; onUploaded: () => void | Promise<void>; beforeUpload?: () => Promise<string | undefined>; updatedAt?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try { const savedVersion = await beforeUpload?.(); const body = new FormData(); body.append('file', file); if (savedVersion || updatedAt) body.append('updatedAt', savedVersion || updatedAt!); await api.post(endpoint, body, { timeout: 120000, onUploadProgress: e => setProgress(Math.round((e.loaded / (e.total || file.size)) * 100)) }); await onUploaded(); setFile(null); toast.success('PDF uploaded and available in the client app'); }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: { message?: string } } } }; toast.error(err.response?.data?.error?.message || 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Choose PDF" onChange={async e => { const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return; if (!selected.size || selected.size > 25 * 1024 * 1024 || !selected.name.toLowerCase().endsWith('.pdf') || await selected.slice(0, 5).text() !== '%PDF-') { toast.error('Choose a valid PDF, up to 25 MB'); return; } setFile(selected); }}/>
    <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-sm"><Upload size={16}/>Upload PDF</button>
    <Modal open={!!file} onClose={() => { if (!busy) setFile(null); }} title="Upload client PDF">
      <p className="text-sm break-words">{file?.name}</p>
      <p className="text-xs mt-1 opacity-60">{((file?.size || 0) / 1024 / 1024).toFixed(2)} MB · PDF</p>
      <p className="text-sm my-4">This PDF will become the current document in the client app. Check that its prices and terms match the saved quotation or agreement.</p>
      {busy && <div className="mb-4"><progress className="w-full" aria-label="PDF upload progress" max={100} value={progress}/><p className="text-xs">{progress >= 100 ? 'Publishing PDF…' : `Uploading ${progress}%`}</p></div>}
      <div className="flex gap-3"><button disabled={busy} className="btn-secondary px-4 py-2" onClick={() => setFile(null)}>Cancel</button><button disabled={busy} className="btn-primary px-4 py-2" onClick={upload}>{busy ? 'Uploading…' : 'Upload & publish PDF'}</button></div>
    </Modal>
  </>;
}
