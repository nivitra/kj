# Wedding Service Agreement — form template (SJ Clicks)

This is the structured “Google Forms–style” template used by **Admin → Clients → Make agreement**.

> Note: The original Markdown file from Downloads was not available on the server; this documents the live form sections and Scope options shipped in the product.

## Sections

1. **Parties & contacts** — client name, email, phone, partner, billing address  
2. **Event details** — date, city, venues, ceremony/reception times, guests  
3. **Package** — package name, coverage hours/days, notes  
4. **Scope of services** (multi-select + Custom)  
   - Traditional Photographer  
   - Candid / Documentary Photographer  
   - Traditional Videographer  
   - Cinematic Videographer  
   - Drone Operator  
   - Same-day Edit  
   - Live Streaming  
   - Album Design  
   - Photo Booth  
   - **Custom** (free-text description)  
5. **Deliverables** — edited count, raws, films, albums, delivery timeline/method  
6. **Payment terms** — total, advance, paid, balance, due date, schedule text  
7. **Terms & special conditions**  
8. **Review & finalize** → branded PDF for studio + client  

## After finalize

- PDF stored on S3 and attached as a **Contract** (status SENT)  
- Client sees it under **Profile → Agreements** and can **download / accept**  
- Admin sees it under client **Agreements**  
- Payment fields on the client profile are updated from the Payment section  
