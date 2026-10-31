import React from 'react';

export interface CrmEmptyStateProps {
  icon?: string;
  iconTone?: 'primary' | 'success' | 'amber' | 'purple' | 'slate';
  customIcon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export function CrmEmptyState({
  icon = 'inbox',
  iconTone = 'primary',
  customIcon,
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}: CrmEmptyStateProps) {
  return (
    <div className={`crm-empty-state-box ${className}`.trim()}>
      <div className={`crm-empty-icon-wrap ${iconTone}`}>
        {customIcon ? (
          customIcon
        ) : (
          <span className="material-icons">{icon}</span>
        )}
      </div>
      <h3 className="crm-empty-title">{title}</h3>
      <p className="crm-empty-desc">{description}</p>

      {(actionLabel || secondaryActionLabel) && (
        <div className="crm-empty-actions-row">
          {actionLabel && onAction && (
            <button type="button" className="crm-empty-btn" onClick={onAction}>
              {actionIcon && <span className="material-icons">{actionIcon}</span>}
              <span>{actionLabel}</span>
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button type="button" className="crm-empty-btn secondary" onClick={onSecondaryAction}>
              <span>{secondaryActionLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
