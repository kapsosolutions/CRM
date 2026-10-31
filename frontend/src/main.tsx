import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';

// Parts of the app are downloaded on demand. After a deploy, a tab that was
// open on the old version asks for files that no longer exist: reload once to
// pick up the new version. (At most once a minute, so a real outage can't
// cause a reload loop.)
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'app_reloaded_for_update_at';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) || 0);
  } catch {
    /* storage blocked */
  }
  if (Date.now() - last < 60_000) return; // let the error show instead
  event.preventDefault();
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked */
  }
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
