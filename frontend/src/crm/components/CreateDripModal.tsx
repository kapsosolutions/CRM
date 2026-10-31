// "Create drip campaign": a named sequence of follow-up templates, each sent a
// wait after the previous message to that number, optionally stopped when the
// customer replies. The campaign sends its main template first, then these
// (backend services/campaignRunner.js). Campaigns always go out from the
// business's connected WhatsApp number, so there's no number to pick here.
import { useEffect, useMemo, useState } from 'react';
import type { TemplateItem } from '../types';
import { Dropdown, type KOption } from './Dropdown';

export interface DripMessageStep {
  id: string;
  enabled: boolean;
  templateName: string;
  delay: number;
  delayUnit: 'Minutes' | 'Hours' | 'Days';
}

export interface DripCampaign {
  id: string;
  name: string;
  /** Older saved drips carried the sender number; it isn't used. */
  number?: string;
  messages: DripMessageStep[];
  stopOnReply: boolean;
  createdAt: string;
}

const firstStep = (template = ''): DripMessageStep => ({ id: 'step-1', enabled: true, templateName: template, delay: 1, delayUnit: 'Days' });

const DELAY_UNIT_OPTIONS: KOption[] = [
  { value: 'Minutes', label: 'Minutes' },
  { value: 'Hours', label: 'Hours' },
  { value: 'Days', label: 'Days' },
];

interface CreateDripModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (drip: DripCampaign) => void;
  templates: TemplateItem[];
}

export function CreateDripModal({
  isOpen,
  onClose,
  onSave,
  templates,
}: CreateDripModalProps) {
  const [name, setName] = useState('');
  const [stopOnReply, setStopOnReply] = useState(true);
  const [error, setError] = useState('');

  const approvedTemplates = useMemo(() => templates.filter((t) => t.status === 'APPROVED'), [templates]);

  const templateOptions: KOption[] = useMemo(() => {
    return approvedTemplates.map((t) => ({
      value: t.name,
      label: t.name,
    }));
  }, [approvedTemplates]);

  const [messages, setMessages] = useState<DripMessageStep[]>(() => [firstStep()]);

  // A fresh form each time it opens, with the first approved template picked.
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setStopOnReply(true);
    setError('');
    setMessages([firstStep(approvedTemplates[0]?.name || '')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  // Templates that arrive after it opened fill a step still without one.
  useEffect(() => {
    if (!isOpen || !approvedTemplates.length) return;
    setMessages((prev) => prev.map((s) => (s.templateName ? s : { ...s, templateName: approvedTemplates[0].name })));
  }, [isOpen, approvedTemplates]);

  if (!isOpen) return null;

  function addMessageStep() {
    setMessages((prev) => [
      ...prev,
      {
        id: `step-${Date.now()}`,
        enabled: true,
        templateName: approvedTemplates[0]?.name || '',
        delay: 1,
        delayUnit: 'Hours',
      },
    ]);
  }

  function updateStep(index: number, patch: Partial<DripMessageStep>) {
    setMessages((prev) =>
      prev.map((step, i) => (i === index ? { ...step, ...patch } : step))
    );
  }

  function removeStep(index: number) {
    if (messages.length <= 1) return;
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    if (!name.trim()) {
      setError('Please enter a drip campaign name.');
      return;
    }
    const enabled = messages.filter((m) => m.enabled);
    if (!enabled.length) {
      setError('Switch on at least one message.');
      return;
    }
    if (enabled.some((m) => !m.templateName)) {
      setError('Choose a template for every message that is switched on.');
      return;
    }
    const tooLong = enabled.some((m) => m.delay * ({ Minutes: 1, Hours: 60, Days: 1440 }[m.delayUnit]) > 90 * 1440);
    if (tooLong) {
      setError('A message can wait at most 90 days.');
      return;
    }
    const newDrip: DripCampaign = {
      id: `drip_${Date.now()}`,
      name: name.trim(),
      messages,
      stopOnReply,
      createdAt: new Date().toISOString(),
    };
    onSave(newDrip);
    onClose();
  }

  return (
    <div className="demo-backdrop drip-modal-backdrop" onClick={onClose}>
      <div className="drip-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drip-modal-head">
          <h3>Create drip campaign</h3>
          <button type="button" className="drip-modal-close" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="drip-modal-body">
          {error && <div className="drip-modal-err">{error}</div>}

          {/* Name Field */}
          <div className="drip-field">
            <label className="drip-label">Name</label>
            <input
              type="text"
              className="k-input drip-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError('');
              }}
              placeholder="Enter drip campaign"
              autoFocus
            />
          </div>

          {/* Add Messages Section */}
          <div className="drip-messages-section">
            <h4 className="drip-section-title">Add Messages</h4>
            <p className="drip-hint" data-testid="drip-hint">
              The campaign’s template goes first. Each message here is sent the set time after the previous one.
            </p>

            <div className="drip-steps-list">
              {messages.map((step, idx) => (
                <div className="drip-step-row" key={step.id} data-testid="drip-step">
                  {/* Toggle Switch */}
                  <label className="drip-switch">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      onChange={(e) => updateStep(idx, { enabled: e.target.checked })}
                    />
                    <span className="drip-slider" />
                  </label>

                  {/* Step Chain Badge */}
                  <div className="drip-step-badge">
                    <span className="material-icons drip-chain-icon">link</span>
                    <span>{idx + 1}</span>
                  </div>

                  <span className="drip-step-lbl">Send message:</span>

                  {/* Template Select */}
                  <div className="drip-tmpl-select-wrap">
                    <Dropdown
                      options={templateOptions}
                      value={step.templateName}
                      onChange={(val) => updateStep(idx, { templateName: val })}
                      placeholder="Send message"
                      size="sm"
                    />
                  </div>

                  <span className="drip-step-lbl">After</span>

                  {/* Delay Number */}
                  <input
                    type="number"
                    min={0}
                    className="drip-delay-input"
                    value={step.delay}
                    onChange={(e) => updateStep(idx, { delay: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  />

                  {/* Delay Unit */}
                  <div className="drip-unit-select-wrap">
                    <Dropdown
                      options={DELAY_UNIT_OPTIONS}
                      value={step.delayUnit}
                      onChange={(val) => updateStep(idx, { delayUnit: val as any })}
                      size="sm"
                    />
                  </div>

                  {/* Cancel / Remove Step Button (Using requested SVG icon) */}
                  <button
                    type="button"
                    className="drip-del-step-btn"
                    onClick={() => removeStep(idx)}
                    title={messages.length > 1 ? "Remove message step" : "Cannot remove only message"}
                    disabled={messages.length <= 1}
                    aria-label="Remove message"
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5"></circle>
                      <path d="M7 7L13 13M13 7L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"></path>
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* + Add Message Button */}
            <button
              type="button"
              className="drip-add-msg-btn"
              onClick={addMessageStep}
              disabled={messages.length >= 10}
              data-testid="drip-add-step"
            >
              <span>+ Add Message</span>
            </button>
          </div>

          {/* When should we stop this drip campaign? */}
          <div className="drip-stop-section">
            <h4 className="drip-section-title">When should we stop this drip campaign?</h4>
            <div className="drip-stop-row">
              <label className="drip-switch">
                <input
                  type="checkbox"
                  checked={stopOnReply}
                  onChange={(e) => setStopOnReply(e.target.checked)}
                />
                <span className="drip-slider" />
              </label>
              <span className="drip-stop-text">Stop drip campaign on customer reply</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="drip-modal-foot">
          <button type="button" className="drip-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="drip-btn-save" onClick={handleSave} data-testid="drip-save">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
