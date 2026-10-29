'use client';
import {useEffect,useState} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {api} from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';
type Choice={id:string;label:string};
const sections=[['services','Coverage services'],['budgetTiers','Budget ranges'],['schedules','Times of day'],['eventTypes','Other event types']] as const;
export default function Templates(){
 const [draft,setDraft]=useState<Record<string,Choice[]>>({});
 const [section,setSection]=useState<string>('services');
 const {data,error,isLoading}=useQuery({queryKey:['inquiry-settings'],queryFn:async()=>{const r=await api.get('/admin/portal/inquiry-settings');return r.data.data||r.data;}});
 useEffect(()=>{if(data)setDraft(data);},[data]);
 const save=useMutation({mutationFn:()=>api.put('/admin/portal/inquiry-settings',Object.fromEntries(sections.map(([key])=>[key,draft[key]]))),onSuccess:()=>toast.success('Inquiry choices saved'),onError:(e:any)=>toast.error(e.response?.data?.error?.message||'Could not save choices')});
 function update(index:number,field:keyof Choice,value:string){setDraft(d=>({...d,[section]:(d[section]||[]).map((r,i)=>i===index?{...r,[field]:value}:r)}));}
 function move(index:number,delta:number){setDraft(d=>{const rows=[...d[section]];const other=index+delta;if(other<0||other>=rows.length)return d;[rows[index],rows[other]]=[rows[other],rows[index]];return {...d,[section]:rows};});}
 return <div className="max-w-4xl mx-auto p-6"><h1 className="text-3xl font-semibold">Inquiry templates</h1><p className="text-sm opacity-70 my-3">Edit the choices customers see in wedding and event enquiries. Changes apply to new enquiries; existing records keep their submitted details.</p><Link className="btn-secondary inline-flex mb-6 mr-3" href="/dashboard/templates/addons">Edit quotation add-ons</Link><Link className="btn-secondary inline-flex mb-6" href="/dashboard/service-packages">Edit packages &amp; pricing</Link>
 <div className="flex gap-2 flex-wrap mb-6">{sections.map(([key,label])=><button key={key} className={section===key?'btn-primary':'btn-secondary'} onClick={()=>setSection(key)}>{label}</button>)}</div>
 {isLoading?<p>Loading…</p>:error?<p>Could not load templates. Refresh to try again.</p>:<div className="card p-5 space-y-4">{(draft[section]||[]).map((row,i)=><div key={`${section}-${i}`} className="flex gap-2 items-center flex-wrap"><label className="flex-1 min-w-40 text-xs">Label<input className="input mt-1" value={row.label} maxLength={120} onChange={e=>update(i,'label',e.target.value)}/></label><label className="text-xs w-40">Identifier<input className="input mt-1" value={row.id} maxLength={60} onChange={e=>update(i,'id',e.target.value)}/></label><button className="btn-secondary" aria-label="Move up" onClick={()=>move(i,-1)} disabled={i===0}>↑</button><button className="btn-secondary" aria-label="Move down" onClick={()=>move(i,1)} disabled={i===draft[section].length-1}>↓</button><button className="btn-secondary" onClick={()=>setDraft(d=>({...d,[section]:d[section].filter((_,n)=>n!==i)}))}>Remove</button></div>)}<p className="text-xs opacity-60">Keep identifiers stable when renaming choices so saved enquiries remain recognisable.</p><button className="btn-secondary" onClick={()=>setDraft(d=>({...d,[section]:[...(d[section]||[]),{id:'',label:''}]}))}>Add choice</button></div>}
 <button className="btn-primary mt-6" disabled={!data||save.isPending} onClick={()=>save.mutate()}>{save.isPending?'Saving…':'Save all templates'}</button></div>;
}
