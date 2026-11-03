// Editor for the chat message that opens a flow.
//
// A flow is delivered as ONE interactive WhatsApp message: an optional media
// header (image / video / PDF), body text, a small footer line, and the button
// that opens the form. It belongs to the flow — not to any single screen — so
// it lives here rather than on the screen nodes.
//
// None of it is part of the published Flow JSON, so edits take effect
// immediately without republishing.
import { useRef, useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import { useLeaveCleanup, useMediaApi, usePendingUploads } from './uploadCtx';
import { useNotify } from './Dialogs';
import type { CrmApi } from '../api';
import type { FlowBlockHeader, WaFlowDef } from '../types';

const HEADERS: FlowBlockHeader[] = ['none', 'image', 'video', 'pdf'];
const HEADER_ICON: Record<FlowBlockHeader, string> = {
  none: 'block',
  image: 'image',
  video: 'videocam',
  pdf: 'picture_as_pdf',
};
const ACCEPT: Record<FlowBlockHeader, string> = {
  none: '',
  image: 'image/*',
  video: 'video/*',
  pdf: 'application/pdf',
};

export interface FlowMessage {
  cta: string;
  msgHeader: FlowBlockHeader;
  msgHeaderMediaUrl: string;
  msgHeaderFileName: string;
  msgBody: string;
  msgFooter: string;
}

export function flowMessageOf(flow?: Partial<WaFlowDef> | null): FlowMessage {
  return {
    cta: flow?.cta || 'Open',
    msgHeader: flow?.msgHeader || 'none',
    msgHeaderMediaUrl: flow?.msgHeaderMediaUrl || '',
    msgHeaderFileName: flow?.msgHeaderFileName || '',
    msgBody: flow?.msgBody || '',
    msgFooter: flow?.msgFooter || '',
  };
}

/**
 * The form itself. `value`/`onChange` keep it controlled so it can be embedded
 * in the builder rail (saved with the flow) or in a modal (saved on its own).
 */
export function FlowMessageFields({
  value,
  onChange,
  upload,
  discard,
  compact = false,
}: {
  value: FlowMessage;
  onChange: (patch: Partial<FlowMessage>) => void;
  upload: (file: File) => Promise<string>;
  /** Reclaims a file uploaded in this session once nothing uses it (uploadCtx). */
  discard?: (url?: string) => void;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const notify = useNotify();

  const pickHeader = (h: FlowBlockHeader) => {
    // No attachment: the file just uploaded goes (a saved one is deleted by the server on save).
    if (h === 'none') discard?.(value.msgHeaderMediaUrl);
    onChange({ msgHeader: h, ...(h === 'none' ? { msgHeaderMediaUrl: '', msgHeaderFileName: '' } : {}) });
    if (h !== 'none') setTimeout(() => fileRef.current?.click(), 0);
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const previous = value.msgHeaderMediaUrl;
    const previousName = value.msgHeaderFileName;
    onChange({ msgHeaderMediaUrl: URL.createObjectURL(f), msgHeaderFileName: f.name });
    setBusy(true);
    upload(f)
      .then((url) => {
        onChange({ msgHeaderMediaUrl: url });
        discard?.(previous); // replaced → reclaim the earlier upload
      })
      .catch((err) => {
        onChange({ msgHeaderMediaUrl: previous || '', msgHeaderFileName: previousName || '' });
        notify('error', 'Attachment not uploaded', err instanceof Error ? err.message : 'Please try again.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={`fmsg${compact ? ' compact' : ''}`}>
      <div className="fmsg-label">Attachment</div>
      <div className="fl-header-tabs">
        {HEADERS.map((h) => (
          <button
            key={h}
            type="button"
            className={`fl-htab${value.msgHeader === h ? ' active' : ''}`}
            onClick={() => pickHeader(h)}
            title={h === 'none' ? 'No attachment' : `Upload ${h}`}
          >
            <span className="material-icons">{HEADER_ICON[h]}</span>
          </button>
        ))}
      </div>

      {value.msgHeader !== 'none' && (
        <div className="fl-header-tile" onClick={() => fileRef.current?.click()} title="Upload / replace">
          {value.msgHeaderMediaUrl ? (
            value.msgHeader === 'image' ? (
              <img src={value.msgHeaderMediaUrl} alt="" />
            ) : value.msgHeader === 'video' ? (
              <video src={value.msgHeaderMediaUrl} />
            ) : (
              <div className="fl-pdf-chip">
                <span className="material-icons">picture_as_pdf</span>
                <span className="fl-pdf-name">{value.msgHeaderFileName || 'document.pdf'}</span>
              </div>
            )
          ) : (
            <div className="fl-upload-hint">
              <span className="material-icons">upload</span>
              <span>{busy ? 'Uploading…' : `Upload ${value.msgHeader}`}</span>
            </div>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" hidden accept={ACCEPT[value.msgHeader]} onChange={onFile} />

      <div className="k-field">
        <label className="k-label">Body</label>
        <textarea
          className="k-input"
          rows={compact ? 3 : 2}
          value={value.msgBody}
          onChange={(e) => onChange({ msgBody: e.target.value })}
          placeholder="Message shown above the button…"
        />
      </div>

      <div className="k-field">
        <label className="k-label">Footer</label>
        <input
          className="k-input sm"
          value={value.msgFooter}
          onChange={(e) => onChange({ msgFooter: e.target.value })}
          placeholder="Small print under the message (optional)"
          maxLength={60}
        />
      </div>

      <div className="k-field">
        <label className="k-label">Button label</label>
        <input
          className="k-input sm"
          value={value.cta}
          onChange={(e) => onChange({ cta: e.target.value })}
          placeholder="Open"
          maxLength={20}
        />
      </div>

      {/* How it will look in the chat. */}
      <div className="fmsg-label">Preview</div>
      <div className="fmsg-preview">
        {value.msgHeader !== 'none' && value.msgHeaderMediaUrl && (
          value.msgHeader === 'image' ? (
            <img className="fmsg-prev-media" src={value.msgHeaderMediaUrl} alt="" />
          ) : value.msgHeader === 'video' ? (
            <video className="fmsg-prev-media" src={value.msgHeaderMediaUrl} />
          ) : (
            <div className="fmsg-prev-doc">
              <span className="material-icons">picture_as_pdf</span>
              {value.msgHeaderFileName || 'document.pdf'}
            </div>
          )
        )}
        <div className="fmsg-prev-body">{value.msgBody || 'Message shown above the button…'}</div>
        {value.msgFooter && <div className="fmsg-prev-footer">{value.msgFooter}</div>}
        <div className="fmsg-prev-cta">{value.cta || 'Open'}</div>
      </div>
    </div>
  );
}

/** Modal wrapper used from the flow card, saving on its own (no republish). */
export function FlowMessageModal({
  api,
  flow,
  onClose,
  onSaved,
}: {
  api: CrmApi;
  flow: WaFlowDef;
  onClose: () => void;
  onSaved: (updated: WaFlowDef) => void;
}) {
  const [msg, setMsg] = useState<FlowMessage>(() => flowMessageOf(flow));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useBackHandler(true, onClose);
  // Files uploaded while this is open: a replaced one goes straight away, and
  // on closing, any the saved message doesn't use (Cancel, or replaced).
  const media = useMediaApi(
    (f) => api.uploadMedia(f, 'flows'),
    (url) => api.deleteMedia(url),
  );
  const uploading = usePendingUploads(media);
  const savedRef = useRef(JSON.stringify(flowMessageOf(flow)));
  useLeaveCleanup(media, () => savedRef.current, (url) => { api.deleteMedia(url).catch(() => {}); });

  function save() {
    setSaving(true);
    setError('');
    api
      .updateFlowMessage(flow._id, msg)
      .then((r) => {
        savedRef.current = JSON.stringify(msg);
        media.markSaved(savedRef.current);
        onSaved(r.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setSaving(false));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Chat message · {flow.name}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>
        <div className="modal-body">
          <p className="k-hint" style={{ marginTop: 0 }}>
            This is the message customers receive. The attachment, text and button are sent with the
            flow — changing them takes effect right away, no republish needed.
          </p>
          {error && <p className="err">{error}</p>}
          <FlowMessageFields
            value={msg}
            onChange={(p) => setMsg((m) => ({ ...m, ...p }))}
            upload={media.upload}
            discard={media.discard}
            compact
          />
        </div>
        <div className="modal-foot">
          <button className="k-btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="k-btn" onClick={save} disabled={saving || uploading > 0} data-testid="fmsg-save">
            <span className="material-icons">save</span> {saving ? 'Saving…' : uploading ? 'Uploading…' : 'Save message'}
          </button>
        </div>
      </div>
    </div>
  );
}
