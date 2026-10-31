// Slide-in flow picker: choose a published WhatsApp Flow and push it into the
// open chat as an interactive form message. Mirrors TemplateDrawer so the two
// composer pickers behave the same way.
import { useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import type { WaFlowDef } from '../types';
import { BladeSpinner } from './BladeSpinner';

interface Props {
  flows: WaFlowDef[];
  loading: boolean;
  sending: boolean;
  onClose: () => void;
  onSend: (f: WaFlowDef) => void;
}

const screenCount = (f: WaFlowDef) => (f.screens || []).length;

export function FlowDrawer({ flows, loading, sending, onClose, onSend }: Props) {
  useBackHandler(true, onClose);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Only a published flow can be opened by a customer — Meta rejects a send
  // against a draft, so drafts are listed as disabled rather than hidden,
  // otherwise the list looks empty and the reason isn't obvious.
  const ready = flows.filter((f) => f.status === 'PUBLISHED' && f.metaFlowId);
  const drafts = flows.filter((f) => !(f.status === 'PUBLISHED' && f.metaFlowId));

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="tmpl-drawer">
        <header className="drawer-head">
          <h3>Flows</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-sec">
            <div className="sec-title">Send a form</div>
            {loading && <BladeSpinner center={true} containerHeight={120} />}
            {!loading && flows.length === 0 && (
              <p className="muted-note">No flows yet. Build one on the Flows page.</p>
            )}

            {ready.map((f) => {
              const isOpen = expanded === f._id;
              return (
                <div key={f._id}>
                  <div className="tmpl-item">
                    <button className="tmpl-name-btn" onClick={() => setExpanded(isOpen ? null : f._id)}>
                      <span className={`material-icons chev${isOpen ? ' open' : ''}`}>chevron_right</span>
                      <span className="tmpl-name">{f.name}</span>
                      <span className="k-chip sm green">PUBLISHED</span>
                    </button>
                    <button
                      className="ic-send"
                      disabled={sending}
                      title="Send this form"
                      onClick={() => onSend(f)}
                    >
                      <span className="material-icons">send</span>
                    </button>
                  </div>

                  {isOpen && (
                    <div className="tmpl-preview">
                      <div className="tp-bubble">
                        {f.msgHeader === 'image' && f.msgHeaderMediaUrl && (
                          <img className="tp-media-img" src={f.msgHeaderMediaUrl} alt="" />
                        )}
                        {f.msgHeader === 'video' && f.msgHeaderMediaUrl && (
                          <video className="tp-media-img" src={f.msgHeaderMediaUrl} controls />
                        )}
                        {f.msgHeader === 'pdf' && (
                          <div className="tp-media">
                            <span className="material-icons">picture_as_pdf</span>
                          </div>
                        )}
                        <div className="tp-body">
                          {f.msgBody || `${screenCount(f)} screen${screenCount(f) === 1 ? '' : 's'}`}
                        </div>
                        {f.msgFooter && <div className="tp-footer">{f.msgFooter}</div>}
                      </div>
                      <div className="tp-buttons">
                        <div className="tp-btn">
                          <span className="material-icons">dynamic_form</span> {f.cta || 'Open'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {drafts.length > 0 && (
              <>
                <div className="sec-title">Not published yet</div>
                {drafts.map((f) => (
                  <div className="tmpl-item" key={f._id}>
                    <button className="tmpl-name-btn" disabled>
                      <span className="material-icons chev">chevron_right</span>
                      <span className="tmpl-name">{f.name}</span>
                      <span className="k-chip sm amber">DRAFT</span>
                    </button>
                    <button className="ic-send" disabled title="Publish this flow first">
                      <span className="material-icons">send</span>
                    </button>
                  </div>
                ))}
              </>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
