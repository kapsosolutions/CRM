import { useState, useRef, useEffect, useMemo } from 'react';
import { CalendarSvg } from './TemplateIcons';

export interface CustomDateTimePickerProps {
  value: string; // Formatted as "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD"
  onChange: (val: string) => void;
  min?: string;
  showTime?: boolean; // default: true
  hidePastDates?: boolean; // default: true (false allows selecting previous dates)
  dateDisplayFormat?: 'short' | 'long'; // default: 'short' ('short' = MM/DD/YYYY, 'long' = '16 October 2026')
  variant?: 'default' | 'pill'; // default: 'default' ('pill' renders as overview filter pill)
  pillTitle?: string;
  align?: 'left' | 'right';
  className?: string;
  disabled?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CustomDateTimePicker({
  value,
  onChange,
  showTime = true,
  hidePastDates = true,
  dateDisplayFormat = 'short',
  variant = 'default',
  pillTitle,
  align = 'left',
  className = '',
  disabled = false,
}: CustomDateTimePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCalOpen, setIsCalOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);

  // Parse current value with timezone-safe parsing for "YYYY-MM-DD"
  const parsedDate = useMemo(() => {
    if (!value) return new Date();
    if (value.includes('T')) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    const parts = value.split('-');
    if (parts.length === 3) {
      const yr = parseInt(parts[0], 10);
      const mo = parseInt(parts[1], 10) - 1;
      const da = parseInt(parts[2], 10);
      if (!Number.isNaN(yr) && !Number.isNaN(mo) && !Number.isNaN(da)) {
        return new Date(yr, mo, da, 12, 0, 0);
      }
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [value]);

  // Calendar month/year navigation state
  const [viewYear, setViewYear] = useState(() => parsedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parsedDate.getMonth());

  // Update view when value changes externally
  useEffect(() => {
    setViewYear(parsedDate.getFullYear());
    setViewMonth(parsedDate.getMonth());
  }, [parsedDate]);

  // Close popups on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsCalOpen(false);
        setIsTimeOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format date display
  const dateDisplay = useMemo(() => {
    if (dateDisplayFormat === 'long') {
      const day = parsedDate.getDate();
      const month = MONTH_NAMES[parsedDate.getMonth()];
      const year = parsedDate.getFullYear();
      return `${day} ${month} ${year}`;
    }
    const mm = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(parsedDate.getDate()).padStart(2, '0');
    const yyyy = parsedDate.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }, [parsedDate, dateDisplayFormat]);

  // Format time display: hh:mm AM/PM
  const timeDisplay = useMemo(() => {
    let hours = parsedDate.getHours();
    const minutes = String(parsedDate.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 becomes 12
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${minutes} ${ampm}`;
  }, [parsedDate]);

  // Current time reference
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDate = now.getDate();

  const availableYears = useMemo(() => {
    if (!hidePastDates) {
      const start = currentYear - 10;
      const end = currentYear + 5;
      const list = Array.from({ length: end - start + 1 }).map((_, i) => start + i);
      if (!list.includes(viewYear)) {
        list.push(viewYear);
        list.sort((a, b) => a - b);
      }
      return list;
    }
    return Array.from({ length: 6 }).map((_, i) => currentYear + i);
  }, [currentYear, hidePastDates, viewYear]);

  // Calendar days computation
  const daysInMonth = useMemo(() => {
    return new Date(viewYear, viewMonth + 1, 0).getDate();
  }, [viewYear, viewMonth]);

  const firstDayOfWeek = useMemo(() => {
    return new Date(viewYear, viewMonth, 1).getDay();
  }, [viewYear, viewMonth]);

  const isAtMinMonth = hidePastDates
    ? viewYear === currentYear && viewMonth <= currentMonth
    : viewYear === availableYears[0] && viewMonth === 0;

  function prevMonth() {
    if (isAtMinMonth) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function selectDate(day: number) {
    const next = new Date(parsedDate);
    next.setFullYear(viewYear);
    next.setMonth(viewMonth);
    next.setDate(day);

    if (hidePastDates) {
      const checkNow = new Date();
      if (
        next.getFullYear() === checkNow.getFullYear() &&
        next.getMonth() === checkNow.getMonth() &&
        next.getDate() === checkNow.getDate()
      ) {
        if (next.getTime() <= checkNow.getTime()) {
          next.setHours(checkNow.getHours() + 1);
          next.setMinutes(0);
        }
      }
    }

    emitChange(next);
    setIsCalOpen(false);
  }

  function selectTime(hours24: number, minutes: number) {
    const next = new Date(parsedDate);
    next.setHours(hours24);
    next.setMinutes(minutes);
    emitChange(next);
  }

  function emitChange(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (!showTime) {
      onChange(`${yyyy}-${mm}-${dd}`);
      return;
    }
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}T${hh}:${min}`);
  }

  // Current parsed hour, minute, ampm
  const currentHours24 = parsedDate.getHours();
  const currentMinutes = parsedDate.getMinutes();
  const currentIsPM = currentHours24 >= 12;
  const currentHours12 = currentHours24 % 12 || 12;

  return (
    <div
      className={`custom-dt-picker${isCalOpen || isTimeOpen ? ' open' : ''}${disabled ? ' disabled' : ''} ${className}`}
      ref={containerRef}
    >
      {variant === 'pill' ? (
        <div
          className={`co-date-pill${isCalOpen ? ' active' : ''}`}
          onClick={() => {
            if (disabled) return;
            setIsCalOpen((prev) => !prev);
            setIsTimeOpen(false);
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
          title={pillTitle || 'Click to choose date'}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="4.5" width="14" height="13" rx="2" stroke="#6b7280" strokeWidth="1.5" />
            <path d="M6.5 2.5V6.5M13.5 2.5V6.5M3 8H17" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="co-date-text">{dateDisplay}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              transform: isCalOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          >
            <path d="M5 7.5L10 12.5L15 7.5" stroke="#6b7280" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <div className="custom-dt-boxes">
          {/* Date Box */}
          <div
            className={`custom-dt-box date-box${isCalOpen ? ' active' : ''}`}
            onClick={() => {
              if (disabled) return;
              setIsCalOpen((prev) => !prev);
              setIsTimeOpen(false);
            }}
            role="button"
            tabIndex={disabled ? -1 : 0}
          >
            <span className="custom-dt-text">{dateDisplay}</span>
            <button
              type="button"
              className="custom-dt-icon-btn"
              aria-label="Open Calendar"
              tabIndex={-1}
            >
              <CalendarSvg width={18} height={18} />
            </button>
          </div>

          {/* Time Box */}
          {showTime && (
            <div
              className={`custom-dt-box time-box${isTimeOpen ? ' active' : ''}`}
              onClick={() => {
                if (disabled) return;
                setIsTimeOpen((prev) => !prev);
                setIsCalOpen(false);
              }}
              role="button"
              tabIndex={disabled ? -1 : 0}
            >
              <span className="custom-dt-text">{timeDisplay}</span>
              <button
                type="button"
                className="custom-dt-icon-btn"
                aria-label="Open Time Picker"
                tabIndex={-1}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 5.5V10L13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Custom Calendar Popup */}
      {isCalOpen && (
        <div
          className={`custom-cal-popup${align === 'right' ? ' align-right' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="custom-cal-head">
            <div className="custom-cal-month-wrap">
              {/* Month Dropdown */}
              <select
                className="custom-cal-select custom-cal-month-select"
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                aria-label="Select month"
              >
                {MONTH_NAMES.map((name, idx) => {
                  const isPastMonth = hidePastDates && viewYear === currentYear && idx < currentMonth;
                  return (
                    <option key={name} value={idx} disabled={isPastMonth}>
                      {name}
                    </option>
                  );
                })}
              </select>

              {/* Year Dropdown */}
              <select
                className="custom-cal-select custom-cal-year-select"
                value={viewYear}
                onChange={(e) => {
                  const yr = Number(e.target.value);
                  setViewYear(yr);
                  if (hidePastDates && yr === currentYear && viewMonth < currentMonth) {
                    setViewMonth(currentMonth);
                  }
                }}
                aria-label="Select year"
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            <div className="custom-cal-nav">
              <button
                type="button"
                className={`custom-cal-nav-btn${isAtMinMonth ? ' disabled' : ''}`}
                onClick={prevMonth}
                disabled={isAtMinMonth}
                aria-label="Previous month"
                title={isAtMinMonth ? 'Cannot select past months' : 'Previous month'}
              >
                ‹
              </button>
              <button
                type="button"
                className="custom-cal-nav-btn"
                onClick={nextMonth}
                aria-label="Next month"
                title="Next month"
              >
                ›
              </button>
            </div>
          </div>

          <div className="custom-cal-weekdays">
            {WEEKDAYS.map((wd) => (
              <span key={wd} className="custom-cal-wd">
                {wd}
              </span>
            ))}
          </div>

          <div className="custom-cal-grid">
            {/* Blank padding cells before the 1st */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <span key={`blank-${i}`} className="custom-cal-day empty" />
            ))}

            {/* Days of month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;

              // Show past dates in gray and not selectable if hidePastDates is enabled
              const isPastDate =
                viewYear < currentYear ||
                (viewYear === currentYear && viewMonth < currentMonth) ||
                (viewYear === currentYear && viewMonth === currentMonth && day < currentDate);

              if (hidePastDates && isPastDate) {
                return (
                  <button
                    type="button"
                    key={day}
                    className="custom-cal-day disabled past"
                    disabled
                    tabIndex={-1}
                    aria-disabled="true"
                    title="Past date cannot be selected"
                  >
                    <span className="custom-cal-day-num">{day}</span>
                  </button>
                );
              }

              const isSelected =
                parsedDate.getFullYear() === viewYear &&
                parsedDate.getMonth() === viewMonth &&
                parsedDate.getDate() === day;

              const isToday =
                currentYear === viewYear &&
                currentMonth === viewMonth &&
                currentDate === day;

              return (
                <button
                  type="button"
                  key={day}
                  className={`custom-cal-day${isSelected ? ' selected' : ''}${isToday && !isSelected ? ' today' : ''}`}
                  onClick={() => selectDate(day)}
                >
                  <span className="custom-cal-day-num">{day}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom Time Popup */}
      {showTime && isTimeOpen && (
        <div className="custom-time-popup" onClick={(e) => e.stopPropagation()}>
          <div className="custom-time-head">
            <span>Select Time</span>
            <button
              type="button"
              className="custom-time-done-btn"
              onClick={() => setIsTimeOpen(false)}
            >
              Done
            </button>
          </div>
          <div className="custom-time-selectors">
            {/* Hours Column */}
            <div className="custom-time-col">
              <span className="custom-time-col-lbl">Hour</span>
              <div className="custom-time-scroll">
                {Array.from({ length: 12 }).map((_, i) => {
                  const h = i + 1;
                  const isSelected = currentHours12 === h;
                  return (
                    <button
                      type="button"
                      key={h}
                      className={`custom-time-item${isSelected ? ' active' : ''}`}
                      onClick={() => {
                        const h24 = currentIsPM ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
                        selectTime(h24, currentMinutes);
                      }}
                    >
                      {String(h).padStart(2, '0')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Minutes Column */}
            <div className="custom-time-col">
              <span className="custom-time-col-lbl">Minute</span>
              <div className="custom-time-scroll">
                {[0, 5, 10, 15, 20, 23, 25, 30, 35, 40, 45, 50, 55].map((m) => {
                  const isSelected = currentMinutes === m;
                  return (
                    <button
                      type="button"
                      key={m}
                      className={`custom-time-item${isSelected ? ' active' : ''}`}
                      onClick={() => {
                        selectTime(currentHours24, m);
                      }}
                    >
                      {String(m).padStart(2, '0')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* AM / PM Column */}
            <div className="custom-time-col ampm-col">
              <span className="custom-time-col-lbl">Period</span>
              <div className="custom-time-ampm-wrap">
                <button
                  type="button"
                  className={`custom-ampm-btn${!currentIsPM ? ' active' : ''}`}
                  onClick={() => {
                    if (currentIsPM) {
                      selectTime(currentHours24 - 12, currentMinutes);
                    }
                  }}
                >
                  AM
                </button>
                <button
                  type="button"
                  className={`custom-ampm-btn${currentIsPM ? ' active' : ''}`}
                  onClick={() => {
                    if (!currentIsPM) {
                      selectTime(currentHours24 + 12, currentMinutes);
                    }
                  }}
                >
                  PM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
