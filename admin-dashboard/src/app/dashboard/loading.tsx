export default function Loading() {
  return <div role="status" aria-label="Loading page" className="space-y-6 animate-pulse">
    <div className="h-8 w-48 rounded-lg" style={{background:'var(--surface-sunken)'}}/>
    <div className="h-4 w-72 max-w-full rounded" style={{background:'var(--surface-sunken)'}}/>
    <div className="grid sm:grid-cols-3 gap-4">{[0,1,2].map(i => <div key={i} className="card h-28"/>)}</div>
    <div className="card h-72"/>
    <span className="sr-only">Loading your page…</span>
  </div>;
}
