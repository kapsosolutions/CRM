// A page whose items each need something made first (a product needs a
// category, a doctor a specialisation, an agent a property type): this says
// so, with the button that goes and makes one.
export function RequireFirstBanner({ text, action, onAction }: { text: string; action: string; onAction?: () => void }) {
  return (
    <div className="require-first" role="note" data-testid="require-first">
      <span className="material-icons require-first-ic" aria-hidden="true">lock</span>
      <span className="require-first-text">{text}</span>
      {onAction && (
        <button type="button" className="k-btn sm" onClick={onAction} data-testid="require-first-action">
          <span className="material-icons">add</span> {action}
        </button>
      )}
    </div>
  );
}
