import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cropToDataUrl } from "./images";

export default function ImageCrop({ src, outputSize = 960, mime = "image/jpeg", onCancel, onConfirm }) {
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const fittedRef = useRef("");
  const [box, setBox] = useState(0);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.classList.add("sheet-open");
    return () => document.body.classList.remove("sheet-open");
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => setBox(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  const cover = natural.w && natural.h && box ? box / Math.min(natural.w, natural.h) : 1;
  const scale = cover * zoom;
  const dw = natural.w * scale;
  const dh = natural.h * scale;

  function clamp(nextZoom, nextPos) {
    const nextScale = cover * nextZoom;
    const width = natural.w * nextScale;
    const height = natural.h * nextScale;
    return {
      x: Math.min(0, Math.max(box - width, nextPos.x)),
      y: Math.min(0, Math.max(box - height, nextPos.y)),
    };
  }

  useLayoutEffect(() => {
    if (!box || !natural.w) return;
    if (fittedRef.current === src) return;
    fittedRef.current = src;
    const nextCover = box / Math.min(natural.w, natural.h);
    setZoom(1);
    setPos({
      x: (box - natural.w * nextCover) / 2,
      y: (box - natural.h * nextCover) / 2,
    });
  }, [box, natural.w, natural.h, src]);

  function zoomAroundCenter(nextZoom) {
    if (!scale) return;
    const limited = Math.min(3, Math.max(1, nextZoom));
    const cx = (box / 2 - pos.x) / scale;
    const cy = (box / 2 - pos.y) / scale;
    const nextScale = cover * limited;
    setZoom(limited);
    setPos(clamp(limited, { x: box / 2 - cx * nextScale, y: box / 2 - cy * nextScale }));
  }

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: event.clientX, y: event.clientY, pos };
    }
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchRef.current = {
        dist: Math.hypot(second.x - first.x, second.y - first.y),
        zoom,
      };
    }
  }

  function onPointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2 && pinchRef.current?.dist) {
      const [first, second] = [...pointersRef.current.values()];
      const dist = Math.hypot(second.x - first.x, second.y - first.y);
      zoomAroundCenter((pinchRef.current.zoom * dist) / pinchRef.current.dist);
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    setPos(clamp(zoom, { x: drag.pos.x + event.clientX - drag.x, y: drag.pos.y + event.clientY - drag.y }));
  }

  function onPointerUp(event) {
    pointersRef.current.delete(event.pointerId);
    dragRef.current = null;
    pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      const [left] = [...pointersRef.current.values()];
      dragRef.current = { x: left.x, y: left.y, pos };
    }
  }

  function confirm() {
    const image = imageRef.current;
    if (!image || busy || !box) return;
    setBusy(true);
    try {
      onConfirm(
        cropToDataUrl(
          image,
          { sx: -pos.x / scale, sy: -pos.y / scale, size: box / scale },
          { output: outputSize, type: mime },
        ),
      );
    } catch (failure) {
      setBusy(false);
      setError(failure.message || "Não foi possível recortar a imagem.");
    }
  }

  const frame = useMemo(
    () => (box ? { width: dw, height: dh, left: pos.x, top: pos.y } : { width: 0, height: 0, left: 0, top: 0 }),
    [box, dw, dh, pos.x, pos.y],
  );

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="crop-card">
        <h2 id="crop-title">Recortar foto</h2>
        <p className="hint">Arraste para enquadrar. A área visível é o quadrado que aparece no cardápio.</p>
        <div
          ref={stageRef}
          className="crop-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imageRef}
            src={src}
            alt=""
            draggable={false}
            style={frame}
            onLoad={(event) => {
              if (event.target.naturalWidth) {
                setNatural({ w: event.target.naturalWidth, h: event.target.naturalHeight });
              }
            }}
          />
        </div>
        <label className="crop-zoom">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => zoomAroundCenter(Number(event.target.value))}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="crop-actions">
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={confirm} disabled={busy || !natural.w}>
            {busy ? "Recortando…" : "Usar foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
