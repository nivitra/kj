'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';

export type CropRect = { x: number; y: number; width: number; height: number; aspect: number };

type Props = {
  open: boolean;
  title?: string;
  /** File or remote URL to crop. */
  src: string | null;
  aspect?: number;
  saving?: boolean;
  onClose: () => void;
  onSave: (result: { blob: Blob | null; crop: CropRect }) => void;
};

/**
 * Pan + zoom cropper. The framed window is the saved crop (16:10 gallery cards by default).
 */
export default function ImageCropModal({
  open,
  title = 'Crop image',
  src,
  aspect = 16 / 10,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setMinZoom(1);
    setOffset({ x: 0, y: 0 });
    setNatural({ w: 0, h: 0 });
  }, []);

  useEffect(() => {
    reset();
    setError(null);
  }, [open, src, aspect, reset]);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img || !img.naturalWidth) return;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    setNatural({ w: nw, h: nh });
    const cover = Math.max(fw / nw, fh / nh);
    setMinZoom(cover);
    setZoom(cover);
    setOffset({ x: (fw - nw * cover) / 2, y: (fh - nh * cover) / 2 });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!open || !frame) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [open, aspect, fit]);

  const clampOffset = useCallback((nx: number, ny: number, z: number) => {
    const frame = frameRef.current;
    if (!frame || !natural.w) return { x: nx, y: ny };
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const w = natural.w * z;
    const h = natural.h * z;
    const minX = Math.min(0, fw - w);
    const minY = Math.min(0, fh - h);
    return {
      x: Math.min(0, Math.max(minX, nx)),
      y: Math.min(0, Math.max(minY, ny)),
    };
  }, [natural.w, natural.h]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setOffset(clampOffset(drag.current.ox + dx, drag.current.oy + dy, zoom));
  };
  const onPointerUp = () => { drag.current = null; };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const next = Math.min(minZoom * 4, Math.max(minZoom, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    const scale = next / zoom;
    const nx = cx - (cx - offset.x) * scale;
    const ny = cy - (cy - offset.y) * scale;
    setZoom(next);
    setOffset(clampOffset(nx, ny, next));
  };

  const hint = useMemo(
    () => (aspect > 1.4 ? 'Cover (wide)' : aspect > 1.1 ? 'Landscape' : aspect < 0.9 ? 'Portrait' : 'Square'),
    [aspect],
  );

  const exportCrop = async () => {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img || !natural.w) return;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const sx = Math.max(0, -offset.x / zoom);
    const sy = Math.max(0, -offset.y / zoom);
    const sw = Math.min(natural.w - sx, fw / zoom);
    const sh = Math.min(natural.h - sy, fh / zoom);
    const crop: CropRect = {
      x: sx / natural.w,
      y: sy / natural.h,
      width: sw / natural.w,
      height: sh / natural.h,
      aspect,
    };
    const outW = Math.max(1, Math.min(1600, Math.round(sw)));
    const outH = Math.max(1, Math.round(outW / aspect));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    setExporting(true);
    try {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      canvas.toBlob((blob) => {
        setExporting(false);
        if (!blob) { setError('Could not prepare this crop. Please try again.'); return; }
        onSave({ blob, crop });
      }, 'image/jpeg', 0.9);
    } catch {
      setExporting(false);
      setError('Could not save this image. Check image access or choose a local file.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={title}
      preventClose={saving}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost flex-1 py-2.5" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-1 py-2.5" disabled={saving || exporting || !src || !natural.w || !!error} onClick={exportCrop}>
            {saving ? 'Saving…' : 'Save crop'}
          </button>
        </>
      }
    >
      <p className="text-[12px] mb-3" style={{ color: 'var(--ink-3)' }}>
        Drag to reframe · scroll to zoom · {hint} frame. Saved pixels match this window.
      </p>
      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-xl touch-none bg-[var(--surface-sunken)]"
        style={{ aspectRatio: String(aspect), cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={src}
            crossOrigin="anonymous"
            onError={() => setError("Could not load the image. Please choose it again.")}
            alt=""
            draggable={false}
            onLoad={fit}
            className="absolute top-0 left-0 max-w-none select-none pointer-events-none"
            style={{
              width: natural.w ? natural.w : 'auto',
              height: natural.h ? natural.h : 'auto',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[13px]" style={{ color: 'var(--ink-3)' }}>
            No image
          </div>
        )}
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.7)' }} />
      </div>
      {error && <p role="alert" className="text-sm mt-3" style={{ color: "var(--rose)" }}>{error}</p>}
      <button type="button" onClick={fit} className="btn-ghost mt-2" disabled={saving}>Reset framing</button>
      <input
        aria-label="Image zoom"
        type="range"
        min={minZoom}
        max={minZoom * 4}
        step={0.01}
        value={zoom}
        onChange={(e) => {
          const next = Number(e.target.value);
          const frame = frameRef.current;
          if (!frame) { setZoom(next); return; }
          const cx = frame.clientWidth / 2;
          const cy = frame.clientHeight / 2;
          const scale = next / zoom;
          setZoom(next);
          setOffset(clampOffset(cx - (cx - offset.x) * scale, cy - (cy - offset.y) * scale, next));
        }}
        className="mt-3 w-full"
      />
    </Modal>
  );
}
