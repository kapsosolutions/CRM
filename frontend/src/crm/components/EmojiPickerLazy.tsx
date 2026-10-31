// The emoji picker and its emoji list (~600 KB together). Loaded only when
// someone opens the emoji button in the composer (Composer.tsx).
import data from '@emoji-mart/data';
import EmojiPicker from '@emoji-mart/react';

export default function EmojiPickerLazy({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <EmojiPicker
      data={data}
      theme="light"
      previewPosition="none"
      skinTonePosition="search"
      onEmojiSelect={(e: { native: string }) => onSelect(e.native)}
    />
  );
}
