# Smart Truck (frontend)

The website of Smart Truck: problems and requests from Telegram (and Gmail) in one simple place. It is
deliberately small: three pages, plain colours, big buttons, so anyone can use it without training.
It is a client-rendered Next.js (App Router) app with TypeScript and Tailwind CSS that talks to the
FastAPI backend in `../backend`. The UI is in Uzbek (Latin script, default), Russian and English.

## Run it

Requirements: Node.js 20.9 or newer (developed on Node 24 / npm 11) and the backend running.

```bash
cd frontend
cp .env.example .env.local      # set BACKEND_URL if the API is not on http://127.0.0.1:8010
npm ci                          # or: npm install
npm run dev                     # http://localhost:3000
```

Production build:

```bash
npm run build                   # BACKEND_URL is read here
npm run start                   # serves on port 3000 (another port: npm run start -- -p 3100)
```

Other scripts: `npm run lint` (ESLint with the Next.js rules) and `npm run typecheck` (`tsc --noEmit`).

### Same-origin API (one HTTPS origin, no CORS)

The browser calls `/api/...` on the dashboard's own origin. `next.config.ts` rewrites `/api/:path*` to
`${BACKEND_URL}/api/:path*`, so a single public URL (for example an HTTPS tunnel pointing at the
dashboard) serves both the UI and the API, and the backend needs no CORS settings.

| Variable | Default | Notes |
|---|---|---|
| `BACKEND_URL` | `http://127.0.0.1:8010` | Where `/api/*` is proxied. Read at **build** time (the rewrite is stored in the build), so rebuild after changing it. Docker: build arg, default `http://api:8000`. |
| `NEXT_PUBLIC_API_URL` | empty | Leave empty for same-origin. Set it only to call a backend on another origin directly (that backend must allow CORS). Inlined at build time. |

Sign in with a backend user (email and password). To get users, use the backend CLI
(`backend/app/cli.py`): `python -m app.cli reset-demo` seeds demo data (password `demo12345`, e.g.
`owner@demo-trucking.com`), and `python -m app.cli create-admin --email ... --password ... --company ...`
creates a real owner account.

## What is on the site

| Page | Who | What it does |
|---|---|---|
| **Muammolar** (Issues, `/`) | everyone | Four tabs: **Yangi** (new) · **Ishda** (in work) · **Tekshiruvda** (checking) · **Bajarildi** (done), each with its count, plus an "Only mine" tick (on by default for agents). Each row: title in the reader's language, truck, department, who does it, how long ago, and red **Urgent** (P1) / **Late** tags. Until Telegram is linked, a blue banner offers **Connect Telegram** (can be hidden). |
| **Issue** (`/tasks/{id}`) | everyone | "What to do" with only the buttons that work right now, then the facts (who, truck, department, deadline, from, load) and the original message with "Open in Telegram". |
| **Xabarlar** (Messages, `/messages`) | everyone | Messages nobody has answered yet, oldest first, "waiting 7 minutes"; red after the 5-minute limit. **No reply needed** closes the timer. The red number in the top bar is the same count. |
| **Sozlamalar** (Settings, `/settings`) | owner, admin (`groups.manage`) | Turn Telegram groups on / off; tick which Telegram people are staff (`users.manage`), so their replies stop the timer. |

The 8 API statuses are shown as 4 plain stages (`STAGE_STATUSES` in `components/ui.tsx`):
new = detected, needs_review; in work = assigned, in_progress, blocked (with a "Waiting" tag);
checking = pending_verification; done = completed. Cancelled issues are not listed.

Buttons on the issue page, each shown only when the API lists the target in `allowed_transitions`:

| Stage | Buttons | API call |
|---|---|---|
| New | choose a person + **Give the task** · **Not an issue** | `assigned` with `assignee_id` · `cancelled` with a preset reason |
| In work | **Start** · **I'm done** · **Continue** (when waiting) | `in_progress` · `pending_verification` · `in_progress` |
| Checking | **Confirm done** · **Send back** | `completed` · `in_progress` with a preset reason |

The top bar holds the three links, a company picker (only for users with access to more than one
company; it sends `X-Company-Id`), the language picker and **Log out**. On phones the links get their
own row.

**Removed from the website for now** (the backend and its API still do all of it, so screens can come
back when needed): dashboard charts and reports, review queue with keyboard shortcuts, task table and
board, creating tasks by hand, editing, merging, reopening, comments and timeline, escalations page,
shifts and handovers, companies overview, team management, trucks, integrations (Gmail connect, TMS
import), notifications bell, search (Ctrl+K), dark mode and the simple/advanced mode switch.

## How it works

- **Auth**: `POST /api/auth/login` returns a bearer token, which is kept in `localStorage`. Every
  request sends `Authorization: Bearer <token>`. Any 401 clears the token and redirects to
  `/login?next=<current page>`.
- **Permissions**: `GET /api/auth/me` returns `permissions`. Settings is shown only with
  `groups.manage` (the staff list also needs `users.manage`). Issue buttons come only from the task's
  `allowed_transitions`.
- **Languages**: `lib/i18n.ts` holds a small homegrown i18n (no library): typed flat dictionaries in
  `lib/i18n/{uz,ru,en}.ts` (about 110 short phrases each), `t(key, params)` with `{name}` placeholders,
  and English fallback. The UZ / RU / EN switch (top bar and login page) is stored
  in `localStorage` and, when signed in, on the account (`PATCH /api/me`), which is also the language
  of server-side notifications. On sign-in the account's `language` is applied unless the user picked
  one on the login page. `<html lang>` follows the choice. Only labels are translated; enum values
  sent to the API stay unchanged. AI tasks carry `i18n` titles/summaries; `taskTitle()` picks the
  user's language.
- **Errors**: known backend `detail.code` values are shown as translated messages; anything else
  falls back to the server's `message`. FastAPI 422 validation lists are summarised.
- **Times and numbers** use `Intl` in the active locale (`uz-Latn-UZ`, `ru-RU`, `en-US`), always in
  the company time zone (`company_timezone`).
- **Refresh**: lists reload by themselves (issues every 30 s, messages and the top-bar count every 15–20 s).

## Look

- Plain and familiar: white cards on a light gray page, the operating system's own font (no web
  font, so the build needs no Google Fonts access), no icons library, no dark mode.
- Colours: **blue** buttons and links; tags in blue (new), yellow (in work), purple (checking),
  green (done), red (urgent, late, waiting too long).
- Text is at least 16 px, buttons are large (44–48 px tall), and every page works on a 400 px phone.
- All building blocks are in one file, `components/ui.tsx` (Button, Card, Tag, ErrorBox, …).

## Adding or changing text

Add the key to `lib/i18n/en.ts` first, then to `ru.ts` and `uz.ts`; the compiler rejects a dictionary
that misses a key. Keep phrases short and everyday.

## Layout

```
app/
  layout.tsx                root html, system font
  providers.tsx             session + <html lang>
  globals.css               Tailwind + plain base styles
  login/page.tsx            sign-in (with language picker)
  (app)/layout.tsx          signed-in area: waits for /auth/me, sends anonymous users to /login, top bar
  (app)/page.tsx            Issues: 4 stage tabs, "only mine", list
  (app)/tasks/[id]/page.tsx one issue: buttons, facts, original message
  (app)/messages/page.tsx   messages waiting for a reply
  (app)/settings/page.tsx   Telegram groups on/off, Telegram staff
components/
  ui.tsx                    buttons, cards, tags, stage mapping, time formatting, language picker
  Nav.tsx                   top bar
  TelegramBanner.tsx        "Connect Telegram" banner
lib/types.ts                API contract types (mirror backend/app/api/schemas.py)
lib/api.ts                  typed fetch wrapper, endpoint functions, translated error messages
lib/i18n.ts, lib/i18n/      language store, t(), dictionaries
lib/hooks.ts                useApi (tiny data hook with refetch-in-place), useNow
lib/auth.tsx                session context (token, /auth/me, permissions, language)
lib/company.ts              selected company (X-Company-Id)
```
