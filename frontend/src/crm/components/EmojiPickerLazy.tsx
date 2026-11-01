// The emoji picker and its emoji list (~600 KB together). Its own chunk:
// Composer.tsx fetches it and builds the picker (hidden) while the browser is
// idle after a chat opens, so the emoji button opens it at once.
import { memo, useEffect, useRef, useState } from 'react';
import data from '@emoji-mart/data';
import EmojiPicker from '@emoji-mart/react';

type Theme = 'light' | 'dark';
const crmTheme = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

/** The CRM's light / dark theme, following the toggle. */
function useCrmThemeAttr(): Theme {
  const [theme, setTheme] = useState<Theme>(crmTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(crmTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// @emoji-mart/react pushes its props into the picker on every render, which
// re-renders the whole grid. Memoised with a stable callback, it only updates
// when the theme changes, not on every keystroke in the composer.
const Picker = memo(function Picker({ theme, pick }: { theme: Theme; pick: { current: (e: string) => void } }) {
  return (
    <EmojiPicker
      data={data}
      theme={theme}
      previewPosition="none"
      skinTonePosition="search"
      onEmojiSelect={(e: { native: string }) => pick.current(e.native)}
    />
  );
});

export default function EmojiPickerLazy({ onSelect }: { onSelect: (emoji: string) => void }) {
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const theme = useCrmThemeAttr();
  return <Picker theme={theme} pick={pick} />;
}
