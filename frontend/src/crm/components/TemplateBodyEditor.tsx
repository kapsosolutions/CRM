import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_EMOJIS } from '../emojis';
import type { TemplateSource } from '../types';

export interface TemplateBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  max?: number;
  readOnly?: boolean;
  placeholder?: string;
  nextIndex?: number;
  onInsertVariable?: (index: number) => void;
  sources?: TemplateSource[];
  onInsertSourceVariable?: (index: number, sourceKey: string) => void;
  showHint?: boolean;
  rows?: number;
  className?: string;
}

export function TemplateBodyEditor({
  value,
  onChange,
  max,
  readOnly,
  placeholder,
  nextIndex,
  onInsertVariable,
  sources: _sources,
  onInsertSourceVariable,
  showHint = true,
  rows = 5,
  className,
}: TemplateBodyEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Compute placeholder indexes from current text
  const computedIndexes = useMemo(
    () =>
      [...new Set([...value.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort(
        (a, b) => a - b,
      ),
    [value],
  );
  const computedNextIndex = (computedIndexes.length ? Math.max(...computedIndexes) : 0) + 1;
  const currentNextIndex = nextIndex ?? computedNextIndex;

  // Auto-close emoji popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!showEmoji) return;
    function handleDown(e: MouseEvent) {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowEmoji(false);
      }
    }
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showEmoji]);

  /** Inserts text at current cursor position and preserves focus */
  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;

    const nextVal = value.substring(0, start) + text + value.substring(end);
    onChange(nextVal);

    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  /** Wraps selected text or inserts formatted token at cursor */
  function applyFormatting(prefix: string, suffix: string, defaultText = '') {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.substring(start, end);

    let nextVal = '';
    let newStart = 0;
    let newEnd = 0;

    if (selected.length > 0) {
      if (
        selected.startsWith(prefix) &&
        selected.endsWith(suffix) &&
        selected.length >= prefix.length + suffix.length
      ) {
        // Toggle off if already wrapped
        const unwrapped = selected.slice(prefix.length, selected.length - suffix.length);
        nextVal = value.substring(0, start) + unwrapped + value.substring(end);
        newStart = start;
        newEnd = start + unwrapped.length;
      } else {
        // Wrap
        const wrapped = `${prefix}${selected}${suffix}`;
        nextVal = value.substring(0, start) + wrapped + value.substring(end);
        newStart = start + prefix.length;
        newEnd = newStart + selected.length;
      }
    } else {
      // Nothing selected: insert sample word or empty wrapper
      const sample = defaultText || '';
      const inserted = `${prefix}${sample}${suffix}`;
      nextVal = value.substring(0, start) + inserted + value.substring(end);
      newStart = start + prefix.length;
      newEnd = newStart + sample.length;
    }

    onChange(nextVal);

    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(newStart, newEnd);
      }
    });
  }

  /** Insert a variable placeholder {{n}} at cursor position */
  function handleInsertVariable(sourceKey?: string) {
    const targetIdx = currentNextIndex;
    insertAtCursor(`{{${targetIdx}}}`);
    if (sourceKey) {
      onInsertSourceVariable?.(targetIdx, sourceKey);
    } else {
      onInsertVariable?.(targetIdx);
    }
  }

  return (
    <div className={`tp-body-editor-wrap ${className || ''}`}>
      {showHint && (
        <p className="tp-body-hint">
          Make your messages personal: click <span className="tp-var-tag">{'{ }'}</span> to add a variable like <span className="tp-var-tag">{'{{1}}'}</span>, then choose what it shows (for example the customer’s name) under “What each value means”.
        </p>
      )}

      <div className={`tp-editor-box ${isFocused ? 'focused' : ''}`}>
        <div className="tp-editor-toolbar">
          <div className="tp-tb-left">
            {/* Emoji Button */}
            <div className="tp-emoji-wrap" ref={emojiWrapRef}>
              <button
                type="button"
                className={`tp-tb-btn tp-tb-emoji ${showEmoji ? 'active' : ''}`}
                onClick={() => setShowEmoji((v) => !v)}
                title="Insert emoji"
                disabled={readOnly}
                aria-label="Insert emoji"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 19 19"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M9.50016 17.4166C5.12779 17.4166 1.5835 13.8723 1.5835 9.49992C1.5835 5.12754 5.12779 1.58325 9.50016 1.58325C13.8725 1.58325 17.4168 5.12754 17.4168 9.49992C17.4168 13.8723 13.8725 17.4166 9.50016 17.4166ZM9.50016 15.8333C11.1799 15.8333 12.7908 15.166 13.9785 13.9783C15.1662 12.7905 15.8335 11.1796 15.8335 9.49992C15.8335 7.82021 15.1662 6.20931 13.9785 5.02158C12.7908 3.83385 11.1799 3.16659 9.50016 3.16659C7.82046 3.16659 6.20955 3.83385 5.02182 5.02158C3.83409 6.20931 3.16683 7.82021 3.16683 9.49992C3.16683 11.1796 3.83409 12.7905 5.02182 13.9783C6.20955 15.166 7.82046 15.8333 9.50016 15.8333ZM6.3335 10.2916H12.6668C12.6668 11.1314 12.3332 11.9369 11.7393 12.5308C11.1455 13.1246 10.34 13.4583 9.50016 13.4583C8.66031 13.4583 7.85486 13.1246 7.26099 12.5308C6.66713 11.9369 6.3335 11.1314 6.3335 10.2916ZM6.3335 8.70825C6.01855 8.70825 5.71651 8.58314 5.49381 8.36044C5.27111 8.13774 5.146 7.8357 5.146 7.52075C5.146 7.20581 5.27111 6.90376 5.49381 6.68106C5.71651 6.45836 6.01855 6.33325 6.3335 6.33325C6.64844 6.33325 6.95049 6.45836 7.17319 6.68106C7.39588 6.90376 7.521 7.20581 7.521 7.52075C7.521 7.8357 7.39588 8.13774 7.17319 8.36044C6.95049 8.58314 6.64844 8.70825 6.3335 8.70825ZM12.6668 8.70825C12.3519 8.70825 12.0498 8.58314 11.8271 8.36044C11.6044 8.13774 11.4793 7.8357 11.4793 7.52075C11.4793 7.20581 11.6044 6.90376 11.8271 6.68106C12.0498 6.45836 12.3519 6.33325 12.6668 6.33325C12.9818 6.33325 13.2838 6.45836 13.5065 6.68106C13.7292 6.90376 13.8543 7.20581 13.8543 7.52075C13.8543 7.8357 13.7292 8.13774 13.5065 8.36044C13.2838 8.58314 12.9818 8.70825 12.6668 8.70825Z"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="0.5"
                  />
                </svg>
              </button>

              {showEmoji && (
                <div className="tp-emoji-popover">
                  <div className="tp-emoji-grid">
                    {ALL_EMOJIS.map((e) => (
                      <button
                        type="button"
                        key={e}
                        className="tp-emoji-btn"
                        onClick={() => insertAtCursor(e)}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <span className="tp-tb-sep" aria-hidden="true" />

            {/* Bold */}
            <button
              type="button"
              className="tp-tb-btn tp-tb-bold"
              onClick={() => applyFormatting('*', '*', 'bold')}
              title="Bold (*text*)"
              disabled={readOnly}
              aria-label="Bold"
            >
              <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M8.75827 14.7897C9.18123 14.9703 9.58132 15.0605 9.95855 15.0605C12.1076 15.0605 13.1822 14.1155 13.1822 12.2253C13.1822 11.582 13.065 11.0742 12.8307 10.7018C12.6763 10.4536 12.5006 10.2448 12.3034 10.0755C12.1062 9.90625 11.9133 9.77507 11.7247 9.68197C11.5361 9.58887 11.306 9.51834 11.0345 9.47038C10.763 9.42242 10.523 9.3928 10.3144 9.38151C10.1057 9.37023 9.83567 9.36458 9.50416 9.36458C9.08692 9.36458 8.79828 9.3928 8.63824 9.44922C8.63824 9.74826 8.63681 10.1968 8.63395 10.7949C8.6311 11.393 8.62967 11.8388 8.62967 12.1322C8.62967 12.1773 8.62681 12.3677 8.62109 12.7035C8.61538 13.0392 8.61395 13.3114 8.61681 13.5202C8.61966 13.7289 8.63252 13.9645 8.65539 14.2269C8.67825 14.4893 8.71254 14.6769 8.75827 14.7897ZM8.63824 8.47591C8.8783 8.51541 9.1898 8.53516 9.57275 8.53516C10.0414 8.53516 10.4501 8.49848 10.7988 8.42513C11.1474 8.35178 11.4618 8.22624 11.7418 8.0485C12.0219 7.87077 12.2348 7.61827 12.3806 7.29102C12.5263 6.96376 12.5992 6.56315 12.5992 6.08919C12.5992 5.69423 12.5163 5.34863 12.3505 5.05241C12.1848 4.75618 11.959 4.52485 11.6732 4.3584C11.3875 4.19195 11.0788 4.06923 10.7473 3.99023C10.4158 3.91124 10.0614 3.87174 9.6842 3.87174C9.39842 3.87174 9.0269 3.90842 8.56965 3.98177C8.56965 4.26389 8.58108 4.68989 8.60395 5.25977C8.62681 5.82964 8.63824 6.25846 8.63824 6.54622C8.63824 6.69857 8.63681 6.92426 8.63395 7.22331C8.6311 7.52235 8.62967 7.74523 8.62967 7.89193C8.62967 8.15148 8.63252 8.34614 8.63824 8.47591ZM4 16L4.01715 15.2044C4.10288 15.1819 4.3458 15.1367 4.74589 15.069C5.14599 15.0013 5.44891 14.9251 5.65468 14.8405C5.69469 14.7728 5.73041 14.6966 5.76185 14.612C5.79328 14.5273 5.81757 14.4328 5.83472 14.3285C5.85187 14.2241 5.86758 14.1324 5.88187 14.0534C5.89616 13.9744 5.90474 13.8686 5.90759 13.736C5.91045 13.6034 5.91188 13.5075 5.91188 13.4482V12.8939C5.91188 7.35308 5.84901 4.46137 5.72326 4.21875C5.7004 4.17361 5.63753 4.1327 5.53465 4.09603C5.43177 4.05935 5.30459 4.02832 5.15313 4.00293C5.00167 3.97754 4.8602 3.95779 4.72874 3.94368C4.59728 3.92958 4.45868 3.91688 4.31293 3.9056C4.16718 3.89431 4.08002 3.88585 4.05144 3.88021L4.01715 3.17773C4.57728 3.16645 5.54894 3.13401 6.93212 3.0804C8.31531 3.0268 9.38127 3 10.13 3C10.2615 3 10.4572 3.00141 10.7173 3.00423C10.9774 3.00705 11.1703 3.00846 11.296 3.00846C11.6961 3.00846 12.0862 3.04514 12.4663 3.11849C12.8464 3.19184 13.2136 3.31033 13.568 3.47396C13.9223 3.63759 14.231 3.83789 14.4939 4.07487C14.7568 4.31185 14.9683 4.60666 15.1283 4.95931C15.2884 5.31196 15.3684 5.69987 15.3684 6.12305C15.3684 6.41645 15.3213 6.68587 15.2269 6.93132C15.1326 7.17676 15.0212 7.37988 14.8926 7.54069C14.764 7.7015 14.5796 7.86372 14.3396 8.02734C14.0995 8.19097 13.8909 8.31793 13.7137 8.4082C13.5365 8.49848 13.2965 8.61133 12.9936 8.74675C13.8738 8.94423 14.6068 9.32227 15.1926 9.88086C15.7785 10.4395 16.0714 11.1391 16.0714 11.9798C16.0714 12.5441 15.9714 13.0505 15.7714 13.499C15.5713 13.9476 15.3041 14.3158 14.9697 14.6035C14.6354 14.8913 14.241 15.1325 13.7866 15.3271C13.3322 15.5218 12.865 15.6586 12.3848 15.7376C11.9047 15.8166 11.4018 15.8561 10.8759 15.8561C10.6244 15.8561 10.2472 15.8477 9.74422 15.8307C9.24124 15.8138 8.86401 15.8053 8.61252 15.8053C8.00666 15.8053 7.12931 15.8364 5.98047 15.8984C4.83163 15.9605 4.17147 15.9944 4 16Z"
                  fill="currentColor"
                />
              </svg>
            </button>

            {/* Italic */}
            <button
              type="button"
              className="tp-tb-btn tp-tb-italic"
              onClick={() => applyFormatting('_', '_', 'italic')}
              title="Italic (_text_)"
              disabled={readOnly}
              aria-label="Italic"
            >
              <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M14.2143 3H8.64286C8.39658 3 8.1604 3.11414 7.98626 3.3173C7.81212 3.52047 7.71429 3.79602 7.71429 4.08333C7.71429 4.37065 7.81212 4.6462 7.98626 4.84937C8.1604 5.05253 8.39658 5.16667 8.64286 5.16667H10.0543L7.08286 13.8333H4.92857C4.6823 13.8333 4.44611 13.9475 4.27197 14.1506C4.09783 14.3538 4 14.6293 4 14.9167C4 15.204 4.09783 15.4795 4.27197 15.6827C4.44611 15.8859 4.6823 16 4.92857 16H10.5C10.7463 16 10.9825 15.8859 11.1566 15.6827C11.3307 15.4795 11.4286 15.204 11.4286 14.9167C11.4286 14.6293 11.3307 14.3538 11.1566 14.1506C10.9825 13.9475 10.7463 13.8333 10.5 13.8333H9.08857L12.06 5.16667H14.2143C14.4606 5.16667 14.6967 5.05253 14.8709 4.84937C15.045 4.6462 15.1429 4.37065 15.1429 4.08333C15.1429 3.79602 15.045 3.52047 14.8709 3.3173C14.6967 3.11414 14.4606 3 14.2143 3Z"
                  fill="currentColor"
                />
              </svg>
            </button>

            {/* Strikethrough */}
            <button
              type="button"
              className="tp-tb-btn tp-tb-strike"
              onClick={() => applyFormatting('~', '~', 'strike')}
              title="Strikethrough (~text~)"
              disabled={readOnly}
              aria-label="Strikethrough"
            >
              <svg width="18" height="18" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M12.0457 6.91773C12.0457 6.64904 12.0024 6.40635 11.9157 6.18099C11.8377 5.94697 11.7077 5.75628 11.5343 5.5916C11.361 5.42692 11.1443 5.30557 10.8842 5.21023C10.6242 5.12355 10.3122 5.07155 9.96548 5.07155C9.62745 5.07155 9.32408 5.10622 9.07272 5.18422C8.82137 5.26223 8.61334 5.36624 8.44866 5.49626C8.28398 5.63494 8.15396 5.79095 8.06729 5.97297C7.98061 6.15499 7.93727 6.34568 7.93727 6.54503C7.93727 6.96107 8.15396 7.30777 8.57867 7.5938C8.90804 7.81049 9.24608 8.00985 9.8008 8.20053H5.80506C5.76172 8.13119 5.70971 8.05318 5.67504 7.98384C5.44969 7.5678 5.33701 7.09109 5.33701 6.53636C5.33701 6.00764 5.44969 5.53093 5.68371 5.08888C5.90907 4.6555 6.22977 4.2828 6.64581 3.97077C7.06185 3.6674 7.5559 3.42471 8.11929 3.25136C8.69135 3.08668 9.32408 3 10.0088 3C10.7109 3 11.3436 3.09534 11.9243 3.2947C12.4964 3.48538 12.9905 3.76275 13.3892 4.10945C13.7965 4.45615 14.1086 4.87219 14.3253 5.34891C14.542 5.82562 14.6546 6.34568 14.6546 6.91773H12.0457ZM16.7348 9.06729H2.86676C2.39004 9.06729 2 9.45733 2 9.93404C2 10.4108 2.39004 10.8008 2.86676 10.8008H10.3382C10.4942 10.8615 10.6849 10.9221 10.8149 10.9742C11.1356 11.1215 11.387 11.2688 11.569 11.4162C11.751 11.5635 11.8723 11.7282 11.9417 11.9102C12.0024 12.0836 12.037 12.283 12.037 12.5083C12.037 12.7077 11.9937 12.8983 11.9157 13.0804C11.8377 13.2537 11.7163 13.4097 11.5516 13.5397C11.387 13.6698 11.1876 13.7651 10.9362 13.8431C10.6849 13.9125 10.3902 13.9558 10.0608 13.9558C9.68812 13.9558 9.34142 13.9211 9.03805 13.8431C8.73469 13.7651 8.466 13.6438 8.24931 13.4791C8.03262 13.3144 7.85927 13.0977 7.73792 12.829C7.61658 12.5603 7.52123 12.1703 7.52123 11.7802H4.94697C4.94697 12.2569 5.01631 12.7597 5.15499 13.1497C5.29367 13.5397 5.47569 13.8864 5.71838 14.1985C5.96107 14.5018 6.23843 14.7705 6.5678 14.9959C6.8885 15.2213 7.24387 15.4119 7.62524 15.5593C8.00661 15.7066 8.40532 15.8193 8.82137 15.8973C9.23741 15.9667 9.65345 16.01 10.0695 16.01C10.7629 16.01 11.3956 15.932 11.959 15.7673C12.5224 15.6026 13.0078 15.3773 13.4065 15.0826C13.8052 14.7879 14.1172 14.4152 14.3339 13.9818C14.5506 13.5484 14.6633 13.0544 14.6633 12.4996C14.6633 11.9796 14.5766 11.5115 14.3946 11.1042C14.3513 11.0088 14.2993 10.9048 14.2473 10.8181H16.7348C17.2116 10.8181 17.6016 10.4281 17.6016 9.95138V9.93404C17.6016 9.45733 17.2116 9.06729 16.7348 9.06729Z"
                  fill="currentColor"
                />
              </svg>
            </button>

            <span className="tp-tb-sep" aria-hidden="true" />

            {/* Variable button ->{}<- */}
            <button
              type="button"
              className="tp-tb-btn tp-tb-var"
              onClick={() => handleInsertVariable()}
              title={`Add variable {{${currentNextIndex}}}`}
              disabled={readOnly}
              aria-label="Add variable"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M7 3H6.5C5.4 3 5 4 5 5.5V7C5 8.5 4.5 9 3.5 9.5C4.5 10 5 10.5 5 12V14.5C5 16 5.4 17 6.5 17H7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M13 3H13.5C14.6 3 15 4 15 5.5V7C15 8.5 15.5 9 16.5 9.5C15.5 10 15 10.5 15 12V14.5C15 16 14.6 17 13.5 17H13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Right counter */}
          <div className={`tp-tb-count ${max && value.length > max ? 'over' : ''}`}>
            {value.length}{max ? `/${max}` : ''}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          className="tp-editor-textarea"
          rows={rows}
          value={value}
          readOnly={readOnly}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Template Message...'}
        />
      </div>

    </div>
  );
}
