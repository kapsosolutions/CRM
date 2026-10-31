// Reusable 12-blade spinner for data loading across the CRM
import './BladeSpinner.css';

interface BladeSpinnerProps {
  /** If true, wraps in a relative container so .center centers vertically and horizontally */
  center?: boolean;
  /** Custom size (e.g. 24, 28, 36 or '1.5em') */
  size?: number | string;
  className?: string;
  /** Optional container min-height if centered (defaults to 180px) */
  containerHeight?: number | string;
}

export function BladeSpinner({
  center = true,
  size,
  className = '',
  containerHeight,
}: BladeSpinnerProps) {
  const spinnerElement = (
    <div
      className={`spinner${center ? ' center' : ''} ${className}`.trim()}
      style={size ? { fontSize: typeof size === 'number' ? `${size}px` : size } : undefined}
      role="status"
      aria-label="Loading"
    >
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
    </div>
  );

  if (center) {
    return (
      <div
        className="blade-spinner-container"
        style={containerHeight ? { minHeight: typeof containerHeight === 'number' ? `${containerHeight}px` : containerHeight } : undefined}
      >
        {spinnerElement}
      </div>
    );
  }

  return spinnerElement;
}
