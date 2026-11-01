// WhatsApp-style attachment preview (shown inside the conversation panel).
// Supports MULTIPLE files with a vertical thumbnail strip + "+" to add more.
// The active file previews in the stage; images can be cropped (8 handles +
// move) and rotated left/right with reset. Per-file caption. Light CRM theme.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import { uiScale } from '../uiScale';

interface Item {
  file: File;
  original: File;
  caption: string;
}

interface Props {
  files: File[];
  sending: boolean;
  onCancel: () => void;
  onSend: (items: { file: File; caption: string }[]) => void;
}

type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'doc';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN = 24;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

function kindOf(file: File): Kind {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  return 'doc';
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Small self-contained thumbnail that manages its own object URL.
function Thumb({ file }: { file: File }) {
  const [u, setU] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setU(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (file.type.startsWith('image/')) return <img src={u} alt="" />;
  if (file.type.startsWith('video/')) return <span className="material-icons">movie</span>;
  if (file.type.startsWith('audio/')) return <span className="material-icons">audiotrack</span>;
  return <span className="material-icons">description</span>;
}

export function AttachmentPreview({ files, sending, onCancel, onSend }: Props) {
  const [items, setItems] = useState<Item[]>(
    files.map((f) => ({ file: f, original: f, caption: '' })),
  );
  const [active, setActive] = useState(0);
  const [url, setUrl] = useState('');
  const [showDiscard, setShowDiscard] = useState(false);

  const current = items[active];
  const kind = current ? kindOf(current.file) : 'doc';

  const imgRef = useRef<HTMLImageElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState(false);
  // Back behaves like Esc: leave cropping, else ask before discarding (and a
  // second Back with that prompt up keeps the selection).
  useBackHandler(true, () => {
    if (cropping) setCropping(false);
    else setShowDiscard((open) => !open);
  });
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<{ mode: Handle | 'move'; startX: number; startY: number; box: Box } | null>(
    null,
  );

  // Object URL for the active file (effect-based so StrictMode stays valid).
  useEffect(() => {
    if (!current) return;
    const u = URL.createObjectURL(current.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [current?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cropping) setCropping(false);
        else setShowDiscard(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, cropping]);

  const patchActive = (file: File) =>
    setItems((prev) => prev.map((it, i) => (i === active ? { ...it, file } : it)));

  function switchTo(i: number) {
    setCropping(false);
    setActive(i);
  }

  function addMore(e: React.ChangeEvent<HTMLInputElement>) {
    const more = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!more.length) return;
    setItems((prev) => [...prev, ...more.map((f) => ({ file: f, original: f, caption: '' }))]);
  }

  function removeActive() {
    setItems((prev) => prev.filter((_, i) => i !== active));
    setActive((a) => Math.max(0, a - (a > 0 ? 1 : 0)));
  }

  // ---- Crop box ----
  const fullBox = useCallback((): Box | null => {
    const img = imgRef.current;
    if (!img || !img.clientWidth) return null;
    return { x: 0, y: 0, w: img.clientWidth, h: img.clientHeight };
  }, []);

  function onImgLoad() {
    if (cropping) setBox(fullBox());
  }
  function startCrop() {
    setCropping(true);
    setBox(fullBox());
  }
  function startDrag(e: React.PointerEvent, mode: Handle | 'move') {
    e.preventDefault();
    e.stopPropagation();
    if (!box) return;
    drag.current = { mode, startX: e.clientX, startY: e.clientY, box };
  }
  const onMove = useCallback((e: PointerEvent) => {
    const img = imgRef.current;
    const d = drag.current;
    if (!d || !img) return;
    const W = img.clientWidth;
    const H = img.clientHeight;
    // Mouse moves are screen px; the crop box is in the image's CSS px.
    const s = uiScale();
    const dx = (e.clientX - d.startX) / s;
    const dy = (e.clientY - d.startY) / s;
    const b = d.box;
    if (d.mode === 'move') {
      setBox({ x: clamp(b.x + dx, 0, W - b.w), y: clamp(b.y + dy, 0, H - b.h), w: b.w, h: b.h });
      return;
    }
    let l = b.x;
    let t = b.y;
    let r = b.x + b.w;
    let bot = b.y + b.h;
    if (d.mode.includes('w')) l = clamp(b.x + dx, 0, r - MIN);
    if (d.mode.includes('e')) r = clamp(b.x + b.w + dx, l + MIN, W);
    if (d.mode.includes('n')) t = clamp(b.y + dy, 0, bot - MIN);
    if (d.mode.includes('s')) bot = clamp(b.y + b.h + dy, t + MIN, H);
    setBox({ x: l, y: t, w: r - l, h: bot - t });
  }, []);
  const onUp = useCallback(() => {
    drag.current = null;
  }, []);
  useEffect(() => {
    if (!cropping) return;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [cropping, onMove, onUp]);

  function rotate(dir: 1 | -1) {
    const img = imgRef.current;
    if (!img || !current) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = h;
    canvas.height = w;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(img, -w / 2, -h / 2);
    const outType = current.file.type.startsWith('image/') ? current.file.type : 'image/png';
    canvas.toBlob((blob) => {
      if (blob) patchActive(new File([blob], current.file.name, { type: blob.type || outType }));
    }, outType);
  }

  function resetEdits() {
    if (current) patchActive(current.original);
    setBox(null);
  }

  function applyCrop() {
    const img = imgRef.current;
    if (!img || !box || !current || box.w < 6 || box.h < 6) {
      setCropping(false);
      return;
    }
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.w * scaleX);
    canvas.height = Math.round(box.h * scaleY);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      img,
      box.x * scaleX,
      box.y * scaleY,
      box.w * scaleX,
      box.h * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const outType = current.file.type.startsWith('image/') ? current.file.type : 'image/png';
    canvas.toBlob((blob) => {
      if (blob) patchActive(new File([blob], current.file.name, { type: blob.type || outType }));
      setCropping(false);
    }, outType);
  }

  if (!current) return null;
  const ext = (current.file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'file').toUpperCase();
  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  return (
    <div className="att-overlay">
      <header className="att-head">
        <button className="att-close" onClick={() => setShowDiscard(true)} aria-label="Close">
          <span className="material-icons">close</span>
        </button>
        <div className="att-filename">{current.file.name}</div>
        {items.length > 1 && !cropping && (
          <button className="att-tool" onClick={removeActive} title="Remove this file">
            <span className="material-icons">delete</span>
          </button>
        )}
        {kind === 'image' &&
          (cropping ? (
            <div className="att-crop-actions">
              <button className="att-tool" onClick={() => setCropping(false)}>
                Cancel
              </button>
              <button className="att-tool apply" onClick={applyCrop}>
                <span className="material-icons">check</span> Apply
              </button>
            </div>
          ) : (
            <button className="att-tool" onClick={startCrop} title="Crop & rotate">
              <span className="material-icons">crop_rotate</span> Crop
            </button>
          ))}
      </header>

      <div className="att-stage">
        {kind === 'image' && (
          <div className="att-crop-wrap">
            <img ref={imgRef} className="att-media" src={url} alt="" onLoad={onImgLoad} />
            {cropping && box && (
              <div
                className="att-crop-sel"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                onPointerDown={(e) => startDrag(e, 'move')}
              >
                <span className="cg v1" />
                <span className="cg v2" />
                <span className="cg h1" />
                <span className="cg h2" />
                {handles.map((h) => (
                  <span key={h} className={`ch ${h}`} onPointerDown={(e) => startDrag(e, h)} />
                ))}
              </div>
            )}
          </div>
        )}
        {kind === 'video' && <video className="att-media" src={url} controls />}
        {kind === 'audio' && (
          <div className="att-filecard">
            <span className="material-icons att-filecard-icon">audiotrack</span>
            <div className="att-filecard-name">{current.file.name}</div>
            <audio src={url} controls />
          </div>
        )}
        {kind === 'pdf' && <iframe className="att-pdf" src={url} title={current.file.name} />}
        {kind === 'doc' && (
          <div className="att-filecard">
            <span className={`att-doc-icon ${ext === 'PDF' ? 'pdf' : ''}`}>{ext.slice(0, 4)}</span>
            <div className="att-filecard-name">{current.file.name}</div>
            <div className="att-filecard-sub">
              {ext} • {prettySize(current.file.size)}
            </div>
          </div>
        )}

        {/* Right rail: crop tools while cropping, else the file strip + add. */}
        {cropping ? (
          <div className="att-crop-bar">
            <button className="att-rotate" onClick={() => rotate(-1)} title="Rotate left">
              <span className="material-icons">rotate_left</span>
            </button>
            <button className="att-rotate" onClick={() => rotate(1)} title="Rotate right">
              <span className="material-icons">rotate_right</span>
            </button>
            <button className="att-reset" onClick={resetEdits}>
              Reset
            </button>
          </div>
        ) : (
          <div className="att-strip">
            {items.map((it, i) => (
              <button
                key={i}
                className={`att-thumb${i === active ? ' active' : ''}`}
                onClick={() => switchTo(i)}
                title={it.file.name}
              >
                <Thumb file={it.file} />
              </button>
            ))}
            <button className="att-add" onClick={() => addRef.current?.click()} title="Add files">
              <span className="material-icons">add</span>
            </button>
            <input
              ref={addRef}
              type="file"
              multiple
              hidden
              onChange={addMore}
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt"
            />
          </div>
        )}
      </div>

      <div className="att-footer">
        <input
          className="att-caption"
          type="text"
          placeholder="Add a caption…"
          value={current.caption}
          autoFocus
          onChange={(e) =>
            setItems((prev) =>
              prev.map((it, i) => (i === active ? { ...it, caption: e.target.value } : it)),
            )
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !sending) onSend(items);
          }}
        />
        <button
          className="att-send"
          onClick={() => onSend(items)}
          disabled={sending}
          aria-label="Send"
        >
          <span className="material-icons">send</span>
          {items.length > 1 && <span className="att-send-count">{items.length}</span>}
        </button>
      </div>

      {showDiscard && (
        <div className="disc-backdrop" onClick={() => setShowDiscard(false)}>
          <div className="disc-box" onClick={(e) => e.stopPropagation()}>
            <div className="disc-title">Discard selection?</div>
            <div className="disc-actions">
              <button className="disc-cancel" onClick={() => setShowDiscard(false)}>
                Cancel
              </button>
              <button className="disc-discard" onClick={onCancel}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
