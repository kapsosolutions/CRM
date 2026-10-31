declare module '@emoji-mart/data';
declare module '@emoji-mart/react' {
  import type { ComponentType } from 'react';
  interface PickerProps {
    data?: unknown;
    onEmojiSelect?: (emoji: { native: string; id: string; name: string }) => void;
    theme?: 'auto' | 'light' | 'dark';
    previewPosition?: 'none' | 'top' | 'bottom';
    skinTonePosition?: 'none' | 'preview' | 'search';
    searchPosition?: 'none' | 'sticky' | 'static';
    navPosition?: 'none' | 'top' | 'bottom';
    perLine?: number;
    maxFrequentRows?: number;
    [key: string]: unknown;
  }
  const Picker: ComponentType<PickerProps>;
  export default Picker;
}
