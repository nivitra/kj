 'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { billingApi } from '@/lib/api';
import Modal from '@/components/Modal';
export default function PaymentsPage() {
 const qc = useQueryClient();
 const [selected, setSelected] = useState<any>(null);
 const [note, setNote] = useState('');
 const { data, isLoading, isError, refetch } = useQuery({queryKey:['payment-claims'], queryFn:()=>billingApi.paymentClaims().then(r=>r.data)});
 const review = useMutation({mutationFn:(approve:boolean)=>billingApi.reviewPaymentClaim(selected.id,{approve,note}),onSuccess:()=>{setSelected(null);qc.invalidateQueries({queryKey:['payment-claims']});qc.invalidateQueries({queryKey:['invoices']});qc.invalidateQueries({queryKey:['billing-summary']});qc.invalidateQueries({queryKey:['customer']});qc.invalidateQueries({queryKey:['customers']});toast.success('Payment report updated');},onError:(e:any)=>toast.error(e.response?.data?.error?.message || e.message)});
 return <div className="max-w-5xl"><p className="kicker mb-2">Money</p><h1 className="font-display text-3xl">Confirm payments</h1><p className="text-sm mt-2 mb-6" style={{color:'var(--ink-2)'}}>Check each reference in your bank or UPI account. Confirming creates one receipt and updates the client’s balance.</p>
 {isLoading && <p>Loading payment reports…</p>}{isError && <button className="btn-ghost" onClick={()=>refetch()}>Could not load reports. Try again</button>}
 {!isLoading && !isError && !data?.claims?.length && <div className="card p-10 text-center">All caught up. No payments awaiting confirmation.</div>}
 <div className="space-y-3">{data?.claims?.map((c:any)=><div key={c.id} className="card p-5 flex flex-wrap justify-between gap-4"><div><h2 className="font-semibold">{c.invoice?.customer?.name || 'Client'}</h2><Link className="text-sm underline" href={`/dashboard/invoices?invoiceId=${c.invoiceId}`}>{c.invoice?.invoiceNumber}</Link><p className="text-sm mt-2">UTR / reference: {c.reference}</p><p className="text-xs mt-1">Reported {new Date(c.createdAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p></div><div className="text-right"><p className="text-xl font-semibold">₹{Number(c.amount).toLocaleString('en-IN')}</p><button className="btn-primary px-4 py-2 mt-3" onClick={()=>{setSelected(c);setNote('');}}>Review payment</button></div></div>)}</div>
 <Modal open={!!selected} onClose={()=>!review.isPending&&setSelected(null)} title="Verify payment received" preventClose={review.isPending} footer={<><button className="btn-ghost px-4 py-2" disabled={review.isPending||!note.trim()} onClick={()=>review.mutate(false)}>Reject report</button><button className="btn-primary px-4 py-2" disabled={review.isPending} onClick={()=>review.mutate(true)}>{review.isPending?'Saving…':'Confirm received & issue receipt'}</button></>}>
 <p className="mb-4">Confirm ₹{Number(selected?.amount||0).toLocaleString('en-IN')} only after checking reference <strong>{selected?.reference}</strong> in your account.</p><label className="text-sm">Note (required to reject)<textarea className="input mt-2" value={note} onChange={e=>setNote(e.target.value)} /></label></Modal></div>;
}
