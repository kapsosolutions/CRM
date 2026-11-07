// "Create WhatsApp template" form with a live preview. Emits onCreated() on success.
import { useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import { Dropdown, type KOption } from './Dropdown';
import { WA_TEMPLATE_LANGUAGES } from '../waLanguages';
import { TemplateBodyEditor } from './TemplateBodyEditor';
import { TemplatePhonePreview } from './TemplatePhonePreview';
import { UploadSvg } from './TemplateComposerPage';

type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone?: string;
}

interface Props {
  api: CrmApi;
  onCreated: () => void;
}

const CATEGORY_OPTIONS: KOption[] = [
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'UTILITY', label: 'Utility' },
];
// Every language Meta accepts for templates (crm/waLanguages.ts).
const LANGUAGE_OPTIONS: KOption[] = WA_TEMPLATE_LANGUAGES;
const HEADER_TYPE_OPTIONS: KOption[] = [
  { value: 'none', label: 'None' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image / Photo' },
  { value: 'video', label: 'Video' },
];

function kindLabel(t: ButtonType): string {
  return t === 'URL' ? 'URL' : t === 'PHONE_NUMBER' ? 'Call' : 'Reply';
}

export function TemplateCreate({ api, onCreated }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('MARKETING');
  const [language, setLanguage] = useState('en_US');
  const [headerType, setHeaderType] = useState('none');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<TemplateButton[]>([]);

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaName, setMediaName] = useState('');
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const nameValid = useMemo(() => /^[a-z0-9_]+$/.test(name), [name]);
  const formValid = nameValid && !!bodyText.trim();

  function onMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setMediaFile(f);
    setMediaName(f?.name ?? '');
    setImagePreviewUrl(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  }

  function addButton(type: ButtonType) {
    setButtons((b) => [...b, { type, text: '', url: '', phone: '' }]);
  }
  function removeButton(i: number) {
    setButtons((b) => b.filter((_, idx) => idx !== i));
  }
  function updateButton(i: number, patch: Partial<TemplateButton>) {
    setButtons((b) => b.map((btn, idx) => (idx === i ? { ...btn, ...patch } : btn)));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    if ((headerType === 'image' || headerType === 'video') && !mediaFile) {
      setError(`Please choose a ${headerType} file for the header.`);
      return;
    }
    const cleanButtons = buttons.filter((b) => b.text.trim());
    if (cleanButtons.some((b) => b.type === 'URL' && !b.url?.trim())) {
      setError('Add a URL for the CTA button.');
      return;
    }
    if (cleanButtons.some((b) => b.type === 'PHONE_NUMBER' && !b.phone?.trim())) {
      setError('Add a phone number for the call button.');
      return;
    }

    setSaving(true);
    setError('');
    setOk(false);

    const fd = new FormData();
    fd.append('name', name);
    fd.append('category', category);
    fd.append('language', language);
    fd.append('headerType', headerType);
    if (headerType === 'text') fd.append('headerText', headerText || '');
    fd.append('bodyText', bodyText);
    fd.append('footerText', footerText || '');
    if ((headerType === 'image' || headerType === 'video') && mediaFile) {
      fd.append('headerMedia', mediaFile);
    }
    if (cleanButtons.length) fd.append('buttons', JSON.stringify(cleanButtons));

    try {
      await api.createTemplate(fd);
      setSaving(false);
      setOk(true);
      setMediaFile(null);
      setMediaName('');
      setImagePreviewUrl('');
      setButtons([]);
      setName('');
      setBodyText('');
      setFooterText('');
      setHeaderText('');
      setHeaderType('none');
      setCategory('MARKETING');
      setLanguage('en_US');
      onCreated();
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <form onSubmit={create}>
      <div className="k-field">
        <label className="k-label">Name (lowercase, no spaces)</label>
        <input
          className="k-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="demo_followup"
        />
      </div>

      <div className="two">
        <div className="k-field">
          <label className="k-label">Category</label>
          <Dropdown options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        </div>
        <div className="k-field">
          <label className="k-label">Language</label>
          <Dropdown options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} searchable searchPlaceholder="Search languages…" />
        </div>
      </div>

      <div className="k-field">
        <label className="k-label">Header (optional)</label>
        <Dropdown options={HEADER_TYPE_OPTIONS} value={headerType} onChange={setHeaderType} />
      </div>

      {headerType === 'text' && (
        <div className="k-field">
          <label className="k-label">Header text</label>
          <input
            className="k-input"
            type="text"
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
          />
        </div>
      )}

      {(headerType === 'image' || headerType === 'video') && (
        <div className="k-field">
          <label className="k-label">
            {headerType === 'image' ? 'Header image' : 'Header video'}
          </label>
          <div className="uploader">
            <label className="k-btn ghost sm file-btn">
              <UploadSvg /> Choose {headerType}
              <input
                type="file"
                accept={headerType === 'image' ? 'image/*' : 'video/*'}
                onChange={onMedia}
                hidden
              />
            </label>
            {mediaName && <span className="file-name">{mediaName}</span>}
          </div>
        </div>
      )}

      <div className="k-field">
        <label className="k-label">Body</label>
        <TemplateBodyEditor
          value={bodyText}
          onChange={setBodyText}
          max={1024}
          placeholder="Template Message..."
        />
      </div>
      <div className="k-field">
        <label className="k-label">Footer (optional)</label>
        <input
          className="k-input"
          type="text"
          value={footerText}
          onChange={(e) => setFooterText(e.target.value)}
        />
      </div>

      <div className="k-field">
        <label className="k-label">Buttons (optional)</label>
        <div className="btn-adds">
          <button type="button" className="k-btn ghost sm" onClick={() => addButton('QUICK_REPLY')}>
            <span className="material-icons">reply</span> Reply
          </button>
          <button type="button" className="k-btn ghost sm" onClick={() => addButton('URL')}>
            <span className="material-icons">open_in_new</span> URL
          </button>
          <button type="button" className="k-btn ghost sm" onClick={() => addButton('PHONE_NUMBER')}>
            <span className="material-icons">call</span> Call
          </button>
        </div>
        {buttons.map((b, i) => (
          <div className="btn-row" key={i}>
            <span className="btn-kind">{kindLabel(b.type)}</span>
            <input
              className="k-input"
              placeholder="Button text"
              value={b.text}
              maxLength={25}
              onChange={(e) => updateButton(i, { text: e.target.value })}
            />
            {b.type === 'URL' && (
              <input
                className="k-input"
                placeholder="https://example.com"
                value={b.url}
                onChange={(e) => updateButton(i, { url: e.target.value })}
              />
            )}
            {b.type === 'PHONE_NUMBER' && (
              <input
                className="k-input"
                placeholder="+91 98765 43210"
                value={b.phone}
                onChange={(e) => updateButton(i, { phone: e.target.value })}
              />
            )}
            <button type="button" className="ic-del" onClick={() => removeButton(i)}>
              <span className="material-icons">close</span>
            </button>
          </div>
        ))}
      </div>

      {/* Live preview — WhatsApp mobile mock */}
      <div className="k-field">
        <TemplatePhonePreview
          kind="standard"
          header={
            headerType === 'text' && headerText
              ? { type: 'text', text: headerText }
              : headerType === 'image'
                ? { type: 'image', url: imagePreviewUrl }
                : headerType === 'video'
                  ? { type: 'video' }
                  : { type: 'none' }
          }
          body={bodyText}
          footer={footerText}
          buttons={buttons.map((b) => ({ type: b.type, text: b.text }))}
          highlightVars
        />
      </div>

      {error && <p className="err">{error}</p>}
      {ok && <p className="ok">Template submitted for approval.</p>}

      <button className="k-btn submit" type="submit" disabled={!formValid || saving}>
        {saving ? 'Submitting…' : 'Create template'}
      </button>
    </form>
  );
}
