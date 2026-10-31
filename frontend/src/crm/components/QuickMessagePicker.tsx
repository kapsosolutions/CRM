// The chat composer's "Quick messages" drawer for Messenger / Instagram chats.
//
// Inside the 24-hour window it lists the saved quick messages for the chat's
// channel. Outside it, a Messenger chat gets the approved utility templates
// instead (the only thing Messenger allows then), with each {{n}} filled from
// the contact's name where the template says so. Instagram has nothing to
// offer outside the window.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { MetaChannel, QuickMessage, UtilityTemplate } from '../types';
import { CHANNEL_LABEL, KIND_LABEL, errorCode, errorText, paramCount, problemsOf, quickProblems, renderParams } from '../metaMessaging';
import { QuickMessagePreview, UtilityPreview } from './MetaTemplates';
import { useNotify } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import './MetaMessaging.css';

interface Props {
  api: CrmApi;
  phone: string;
  channel: MetaChannel;
  windowOpen: boolean;
  contactName: string;
  onClose: () => void;
  /** After a send, e.g. to close the window-closed state on the chat. */
  onSent?: () => void;
  /** Templates page, to create one (unused while its Messenger / Instagram tabs are hidden). */
  onOpenTemplatesPage?: () => void;
}

export function QuickMessagePicker({ api, phone, channel, windowOpen, contactName, onClose, onSent }: Props) {
  const notify = useNotify();
  const utilityMode = !windowOpen && channel === 'messenger';
  const [quick, setQuick] = useState<QuickMessage[]>([]);
  const [templates, setTemplates] = useState<UtilityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState('');
  const [pick, setPick] = useState<UtilityTemplate | null>(null);
  const [bodyVals, setBodyVals] = useState<string[]>([]);
  const [btnVals, setBtnVals] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    const p = utilityMode
      ? api.getUtilityTemplates().then((r) => setTemplates((r.data || []).filter((t) => t.status === 'APPROVED' && t.onCurrentPage)))
      : api.getQuickMessages(channel).then((r) => setQuick(r.data || []));
    p.catch(() => {}).finally(() => setLoading(false));
  }, [api, channel, utilityMode]);

  function choose(t: UtilityTemplate) {
    setPick(t);
    const n = paramCount(t.bodyText);
    setBodyVals(Array.from({ length: n }, (_, i) => {
      const v = t.variables.find((x) => x.index === i + 1);
      return v?.source === 'contact_name' ? contactName.trim() || v.fallback || '' : '';
    }));
    setBtnVals(Array.from({ length: t.urlParamCount }, () => ''));
  }

  const missing = useMemo(() => (pick ? [...bodyVals, ...btnVals].some((v) => !v.trim()) : true), [pick, bodyVals, btnVals]);

  async function sendQuick(q: QuickMessage) {
    setSending(q._id);
    try {
      await api.sendQuickMessage(phone, q._id);
      notify('success', 'Sent', `“${q.name}” was sent.`);
      onSent?.();
      onClose();
    } catch (e) {
      notify('error', errorCode(e) === 'CHANNEL_WINDOW_CLOSED' ? 'Reply window closed' : 'Not sent', errorText(e));
    } finally {
      setSending('');
    }
  }
  async function sendUtility() {
    if (!pick) return;
    setSending(pick._id);
    try {
      await api.sendUtilityTemplate(phone, pick._id, { body: bodyVals, buttons: btnVals });
      notify('success', 'Sent', `“${pick.name}” was sent.`);
      onSent?.();
      onClose();
    } catch (e) {
      const p = problemsOf(e);
      notify('error', 'Not sent', p[0]?.message || errorText(e));
    } finally {
      setSending('');
    }
  }

  const title = utilityMode ? (pick ? pick.name : 'Utility templates') : 'Quick messages';
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="tmpl-drawer qm-drawer" data-testid="qm-picker" data-mode={utilityMode ? 'utility' : 'quick'}>
        <header className="drawer-head">
          {pick && (
            <button className="icon-btn" onClick={() => setPick(null)} aria-label="Back to templates">
              <span className="material-icons">arrow_back</span>
            </button>
          )}
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="drawer-body">
          {utilityMode && !pick && (
            <p className="mm-notice warn" data-testid="qm-picker-closed">
              <span className="material-icons">schedule</span>
              More than 24 hours since this customer’s last message. Messenger only allows an approved utility template now:
              an update about an order, account, appointment or event, not a promotion.
            </p>
          )}
          {!utilityMode && !windowOpen && (
            <p className="mm-notice warn">
              <span className="material-icons">schedule</span>
              {CHANNEL_LABEL[channel]} only allows messages within 24 hours of the customer’s last message.
            </p>
          )}
          {loading && <BladeSpinner center={true} containerHeight={100} />}

          {!loading && !utilityMode && quick.length === 0 && (
            <p className="muted-note">
              No quick messages for {CHANNEL_LABEL[channel]} yet.
            </p>
          )}
          {!loading && !utilityMode && quick.map((q) => {
            const bad = quickProblems(q, channel);
            return (
              <div className="qm-item" key={q._id} data-testid="qm-picker-item">
                <div className="qm-item-head">
                  <div>
                    <strong>{q.name}</strong>
                    <div className="qm-item-kind">{KIND_LABEL[q.kind]}</div>
                  </div>
                  <button
                    type="button"
                    className="k-btn sm qm-send-btn"
                    disabled={!windowOpen || !!sending || bad.length > 0}
                    title={bad[0]?.message || 'Send'}
                    onClick={() => sendQuick(q)}
                  >
                    <span className="material-icons">send</span> {sending === q._id ? 'Sending…' : 'Send'}
                  </button>
                </div>
                <QuickMessagePreview qm={q} channel={channel} compact />
              </div>
            );
          })}

          {!loading && utilityMode && !pick && templates.length === 0 && (
            <p className="muted-note">
              No approved utility templates yet.
            </p>
          )}
          {!loading && utilityMode && !pick && templates.map((t) => (
            <button type="button" className="qm-item mm-lib-item" key={t._id} onClick={() => choose(t)} data-testid="qm-picker-template">
              <span className="mm-lib-name">{t.name}</span>
              <span className="mm-lib-body">{renderParams(t.bodyText, t.bodyExamples)}</span>
            </button>
          ))}
          {utilityMode && pick && (
            <>
              {bodyVals.map((v, i) => (
                <div className="k-field" key={`b${i}`}>
                  <label className="k-label" htmlFor={`qm-param-${i}`}>
                    {`{{${i + 1}}}`}{pick.variables.find((x) => x.index === i + 1)?.source === 'contact_name' ? ' · contact’s name' : ''}
                  </label>
                  <input id={`qm-param-${i}`} className="k-input" value={v} placeholder={pick.bodyExamples[i] || ''} onChange={(e) => setBodyVals(bodyVals.map((x, j) => (j === i ? e.target.value : x)))} data-testid={`qm-param-${i}`} />
                </div>
              ))}
              {btnVals.map((v, i) => (
                <div className="k-field" key={`u${i}`}>
                  <label className="k-label" htmlFor={`qm-url-${i}`}>End of link {i + 1}</label>
                  <input id={`qm-url-${i}`} className="k-input" value={v} onChange={(e) => setBtnVals(btnVals.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
              ))}
              <UtilityPreview bodyText={pick.bodyText} values={bodyVals.map((x, i) => x || pick.bodyExamples[i] || '')} buttons={pick.buttons} />
              <button type="button" className="k-btn qm-send-btn" disabled={missing || !!sending} onClick={sendUtility} data-testid="qm-picker-send-utility">
                <span className="material-icons">send</span> {sending ? 'Sending…' : 'Send utility message'}
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
