# WhatsApp CRM — reusable React + Node module

A self-contained, drop-in WhatsApp CRM you can reuse across projects. It talks
to the official **Meta WhatsApp Cloud API** and ships two parts:

- **`frontend/`** — React 18 + Vite + TypeScript. The whole CRM lives in a
  single reusable `src/crm/` folder you copy into any React app.
- **`backend/`** — Node + Express + MongoDB + Socket.IO. The server the CRM
  talks to (chats, messages, media, templates, live events, webhook).

Styled end-to-end with the **WhatsApp design system** (voltage-green `#25d366`,
warm-cream canvas `#fcf5eb`, Inter at a uniform weight 400, pill-everywhere
radius) captured as CSS tokens in `frontend/src/styles/tokens.css`.

---

## Features

Every feature from the original CRM, rebuilt in React:

- **Chat list** — conversations sorted by recent activity, unread badges,
  avatar initials, last-message preview, per-chat time.
- **24-hour session timer** — live countdown per chat; turns red under 10h;
  shows a "window closed → use a template" state when the WhatsApp session
  expires (and blocks free-text accordingly).
- **Pause / resume automation** — toggles `botPaused`; when paused the backend
  bot stops auto-replying so an agent can chat manually.
- **Templates** — list with live Meta approval status, expandable **preview**
  (header / body / footer / buttons), send an approved template, and a full
  **create-template** form with text/image/video headers, reply/URL/call
  buttons, and a live WhatsApp-style preview.
- **Emoji reactions** — hover a message → quick 6-emoji row or a full grid;
  reactions send to WhatsApp and sync live both ways; one reaction per message.
- **Multimedia** — send/receive images, video, audio, documents (with caption
  and a download button); media is hosted on Cloudinary.
- **Country flags** — phone dialing-code → country flag (via flagcdn.com).
- **Delivery / read ticks** — ✓ / ✓✓ / read (blue) / ✕ failed, live.
- **Live updates** — Socket.IO pushes inbound messages, status, and reactions.
- **Desktop notifications + sound** on inbound messages.
- **Delete chat** — confirmation modal; removes messages, conversation, and the
  associated Cloudinary media.
- **Mobile responsive** — WhatsApp-style single pane (list → tap → thread → back).

---

## Quick start (local)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # then fill in the values (see below)
npm start                    # http://localhost:5000
```

Required `.env` values at minimum:

| Variable | What it is |
|---|---|
| `MONGODB_URI` | MongoDB connection string (Atlas or local) |
| `ADMIN_TOKEN` | Bearer token the frontend sends on every CRM request |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Login credentials (login returns `ADMIN_TOKEN`) |
| `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_WABA_ID` | Meta WhatsApp Cloud API |
| `WA_VERIFY_TOKEN` | Webhook verification handshake token |
| `WA_APP_SECRET` | (optional) verifies webhook signatures |
| `WA_APP_ID` | needed to create image/video-header templates |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | media hosting |

Point your Meta app's webhook callback at `/api/whatsapp/webhook` with the
`WA_VERIFY_TOKEN` you set, and subscribe to the `messages` field.

> **Auth note:** the CRM API is guarded by a single shared bearer token
> (`ADMIN_TOKEN`). It is intentionally simple. For multi-user or production use,
> swap `middleware/auth.js` for real per-user auth (JWT/session).

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env         # set VITE_API_BASE to your backend URL
npm run dev                  # http://localhost:5173
```

Then obtain a token once (any REST client), store it, and the CRM is live:

```bash
curl -X POST http://localhost:5000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your ADMIN_PASSWORD>"}'
# -> { "success": true, "token": "<ADMIN_TOKEN>" }
```

In the browser console on the frontend origin:

```js
localStorage.setItem('crm_admin_token', '<ADMIN_TOKEN>');
```

(Or wire the included `CrmApi.login()` into a login screen — see below.)

---

## Reusing the CRM in another React project

The entire UI is isolated in **`frontend/src/crm/`**. To drop it into an
existing React app:

1. Copy `frontend/src/crm/` into your project.
2. Copy `frontend/src/styles/tokens.css` (the WhatsApp design tokens) and
   `@import` it, or merge the `--wa-*` / `--k-*` variables into your own theme.
3. Load **Material Icons** and (ideally) **Inter 400** — e.g. the two
   `<link>` tags in `frontend/index.html`.
4. Mount it:

```tsx
import { CrmApp } from './crm';

export default function Page() {
  return (
    <CrmApp
      config={{ apiBase: 'https://your-backend.example.com' }}
      // initialPhone="15551234567"   // optional deep-link into a chat
    />
  );
}
```

`CrmApp` props:

| Prop | Type | Default |
|---|---|---|
| `config` | `Partial<{ apiBase: string; tokenKey: string }>` | from `VITE_API_BASE` / `VITE_ADMIN_TOKEN_KEY` |
| `initialPhone` | `string \| null` | `null` |

The module also exports the pieces if you want to build your own screens:

```ts
import { CrmApi, CrmSocket, phoneToFlagUrl } from './crm';
import type { Chat, ChatMessage, TemplateItem } from './crm';

const api = new CrmApi({ apiBase: '...', tokenKey: 'crm_admin_token' });
const { token } = await api.login('admin', 'secret');
api.setToken(token);
```

### Backend reuse

Deploy `backend/` as-is (Render, Railway, a VPS, etc.), set the `.env`, and
point `VITE_API_BASE` at it. Multiple frontends can share one backend, or each
project can run its own copy.

---

## Project structure

```
CRM/
├─ frontend/
│  ├─ src/
│  │  ├─ crm/                  ← the reusable module (copy this)
│  │  │  ├─ components/        ← CrmApp, ChatList, MessageItem, Composer,
│  │  │  │                        TemplateDrawer, TemplateCreate, Dropdown,
│  │  │  │                        ReactionPicker, DeleteModal (+ CSS)
│  │  │  ├─ api.ts             ← fetch-based CrmApi client
│  │  │  ├─ socket.ts          ← Socket.IO live feed
│  │  │  ├─ config.ts          ← apiBase / tokenKey
│  │  │  ├─ types.ts           ← domain types
│  │  │  ├─ countryFlag.ts     ← phone → flag
│  │  │  ├─ emojis.ts          ← reaction emoji sets
│  │  │  ├─ utils.ts           ← formatters, beep, notifications
│  │  │  └─ index.ts           ← public API (barrel)
│  │  ├─ styles/
│  │  │  ├─ tokens.css         ← WhatsApp design system tokens
│  │  │  └─ global.css         ← base + shared primitives
│  │  ├─ App.tsx               ← demo host shell
│  │  └─ main.tsx
│  └─ index.html               ← loads Inter + Material Icons
└─ backend/
   ├─ server.js                ← Express + Socket.IO + health
   ├─ routes/                  ← crm.js, webhook.js, admin.js
   ├─ services/                ← metaCloud, cloudinary, chatbot, eventBus, …
   ├─ models/                  ← Conversation, Message, Template
   ├─ middleware/              ← auth (bearer), upload (multer)
   └─ .env.example
```

---

## API surface (backend)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/login` | exchange credentials for the bearer token |
| `GET` | `/api/crm/chats` | conversation list (+ 24h window info) |
| `GET` | `/api/crm/messages/:phone` | messages for a chat (marks read) |
| `POST` | `/api/crm/send` | send free-text (within 24h window) |
| `POST` | `/api/crm/send-media` | send image/video/audio/document |
| `POST` | `/api/crm/send-template` | send an approved template |
| `POST` | `/api/crm/react` | react to a message with an emoji |
| `POST` | `/api/crm/pause` | pause / resume automation |
| `POST` | `/api/crm/read` | clear a chat's unread count |
| `DELETE` | `/api/crm/chats/:phone` | delete a whole chat + its media |
| `GET` | `/api/crm/templates` | list templates (live Meta status) |
| `POST` | `/api/crm/templates` | create a template |
| `DELETE` | `/api/crm/templates/:name` | delete a template |
| `GET/POST` | `/api/whatsapp/webhook` | Meta webhook (verify + inbound) |

Socket.IO events (server → client): `crm:message`, `crm:status`, `crm:reaction`.

---

## Notes & limitations

- Free-text replies only deliver inside WhatsApp's 24-hour customer-service
  window; outside it you must send an approved template (the UI enforces this).
- Template creation and media/image headers require a correctly configured Meta
  app (`WA_APP_ID` + `WA_APP_SECRET`) and a WABA.
- Auth is a single shared token — fine for an internal admin tool, not for
  multi-tenant/public use. Replace `middleware/auth.js` for production.
- The design tokens are derived from WhatsApp's public marketing site styling;
  this project is not affiliated with or endorsed by WhatsApp/Meta.
```
