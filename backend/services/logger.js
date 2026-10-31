// Tiny leveled logger. Set LOG_LEVEL=debug|info|warn|error (default info).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function log(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  const args = meta ? [line, meta] : [line];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

const logger = {
  debug: (m, meta) => log('debug', m, meta),
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta),
};

export default logger;
