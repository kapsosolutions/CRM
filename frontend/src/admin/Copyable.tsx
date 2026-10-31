// A labelled read-only value with a copy button (webhook URLs, tokens, logins).
import { useState } from 'react';

export function Copyable({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="pa-copy">
      <span className="pa-copy-label">{label}</span>
      <code className="pa-copy-val">{value}</code>
      <button
        className="pa-btn ghost sm"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
