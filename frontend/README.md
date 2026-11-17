# Smart Truck dashboard (frontend)

Web dashboard for the Smart Truck AI Management Platform. It is a client-rendered Next.js (App Router)
app with TypeScript and Tailwind CSS that talks to the FastAPI backend in `../backend`. The UI is in
Uzbek (Latin script, default), Russian and English.

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
| `NEXT_PUBLIC_TELEGRAM_BOT` | `truckdipatchbot` | Bot username shown on the Groups page while no group is connected. |

Sign in with a backend user (email and password). To get users, use the backend CLI
(`backend/app/cli.py`): `python -m app.cli reset-demo` seeds demo data (password `demo12345`, e.g.
`owner@demo-trucking.com`), and `python -m app.cli create-admin --email ... --password ... --company ...`
creates a real owner account.

## Simple and advanced mode

Everyone starts in **simple mode**, built for dispatchers, ELD staff and accountants on phones:

- **Plain stages**: the 8 API statuses become 4 stages: New, In work, Checking and Done. Blocked is
  "In work" plus a "Waiting" tag, and cancelled tasks are hidden. The mapping is `stage()` in `lib/stage.ts`.
  API values never change.
- **Big buttons** map onto transitions: Start, I'm done, I'm stuck, Continue, Assign, Not a task,
  Confirm and Send back. A button is shown only when its target is in the task's
  `allowed_transitions` (`simpleActions()`). Reasons are picked from preset chips, plus optional text.
- **One home per role**:
  - agent: "My tasks";
  - dept lead: "Today", with new / said-done / team sections;
  - manager, owner and admin: four tiles, the late list and new tasks;
  - viewer: the manager page, read-only.
  Each tile and menu item opens `/list?kind=…`. Owners and admins get "Settings", which leads to
  Telegram groups and trucks.
- **Frame**: logo, page title, language, bell and avatar. There are 3–4 menu items, shown as a bottom
  tab bar on phones. Ctrl/⌘+K still opens search, and the theme switch lives in the avatar menu.
- **Onboarding**: a first-visit welcome card, a help panel ("?"), a "connect Telegram" banner and
  one-time tips on a card's main button. Dismissals are remembered per browser.

**Advanced mode** is the full UI described below. It is a switch in the avatar menu, remembered per
user (`localStorage` key `smart-truck.mode.<userId>`). `/tasks/{id}` works in both modes. The simple
task page keeps everything else (properties, deadline bar, timeline, merge, all status changes) under
"More details".

## How it works

- **Auth**: `POST /api/auth/login` returns a bearer token, which is kept in `localStorage`. Every
  request sends `Authorization: Bearer <token>`. Any 401 clears the token and redirects to
  `/login?next=<current page>`.
- **Permissions**: `GET /api/auth/me` returns `permissions`. Navigation items and controls are shown
  only when the user has the matching permission (for example `groups.manage` or `fleet.manage`).
  Task status buttons come only from the task's `allowed_transitions`.
- **Languages**: `lib/i18n.ts` holds a small homegrown i18n (no library): typed flat dictionaries in
  `lib/i18n/{uz,ru,en}.ts`, `t(key, params)` with `{name}` placeholders, plural forms via
  `Intl.PluralRules`, and English fallback. The UZ / RU / EN switch (top bar and login page) is stored
  in `localStorage` and, when signed in, on the account (`PATCH /api/me`), which is also the language
  of server-side notifications. On sign-in the account's `language` is applied unless the user picked
  one on the login page. `<html lang>` follows the choice. Only labels are translated; enum values
  sent to the API stay unchanged. AI tasks carry `i18n` titles/summaries; `taskTitle()` /
  `taskSummary()` pick the user's language and the task page also shows the English original.
- **Errors**: known backend `detail.code` values are shown as translated messages; anything else
  falls back to the server's `message`. FastAPI 422 validation lists are summarised.
- **Times and numbers** use `Intl` in the active locale (`uz-Latn-UZ`, `ru-RU`, `en-US`), always in
  the company time zone (`company_timezone`). Due-date inputs are also interpreted in that zone.
- **Attachments** are fetched with the bearer token as blobs (`GET /api/attachments/{id}/file`):
  images show as thumbnails with a lightbox, PDFs open in a new tab, voice notes get an audio player,
  other files download. Object URLs are revoked when the message card unmounts.

## Design system

- **Tokens** live in `app/globals.css` as CSS variables (light + dark), exposed to Tailwind v4 through
  `@theme inline` (`bg-surface`, `text-fg-3`, `border-line`, `bg-accent`, `text-danger-text`, …).
  Dark mode is a `dark` class on `<html>`; the theme (light / dark / system) is chosen in the top bar,
  stored in `localStorage` and applied before first paint by a small inline script in `app/layout.tsx`.
- **Font**: Inter via `next/font/google` (latin, latin-ext, cyrillic). It is downloaded at build time,
  so `npm run build` needs network access to Google Fonts.
- **Icons**: `lucide-react` (pinned). **Charts** are hand-built SVG/HTML following the dataviz rules
  (validated palette in the tokens, table view for every chart).
- **Shell**: collapsible sidebar with count badges (`GET /api/dashboard/badges`, refreshed on every
  local change), breadcrumb top bar, command palette (Ctrl/⌘+K), theme and language switches.
- Review queue keyboard shortcuts: A approve & assign, E edit, N not a task, D duplicate, J/K next/previous.

## Adding or changing text

Add the key to `lib/i18n/en.ts` first, then to `ru.ts` and `uz.ts`; the compiler rejects a dictionary
that misses a key. Plural keys end in `_one` / `_other` (Russian also `_few` / `_many`).

## Layout

```
app/
  login/page.tsx            sign-in (with language switch)
  (app)/layout.tsx          signed-in shell (simple or advanced; waits for /auth/me, redirects anonymous users)
  (app)/page.tsx            home: role home (simple) or Overview (advanced, components/AdvancedOverview.tsx)
  (app)/list/page.tsx       simple lists behind the home tiles and menu (?kind=new|doing|check|late|done|my_done)
  (app)/settings/page.tsx   simple-mode settings (owner/admin): links to groups and trucks, mode switch
  (app)/tasks/page.tsx      task table, filters kept in the URL query string, "New task" dialog
  (app)/tasks/[id]/page.tsx task page: simple (components/simple/SimpleTaskPage.tsx) or full detail
                            (components/AdvancedTaskDetail.tsx)
  (app)/review/page.tsx     review queue for detected / needs_review tasks
  (app)/groups/page.tsx     Telegram group allow-list
  (app)/trucks/page.tsx     fleet list with open and overdue counts
components/                 shell, language switch, badges, charts, pickers, attachments, dialogs
components/simple/          simple mode: shell, role homes, task cards, big buttons, onboarding and help
lib/stage.ts, lib/mode.ts   status -> stage mapping, plain deadlines, simple actions; simple/advanced switch
lib/types.ts                API contract types (mirror backend/app/api/schemas.py)
lib/api.ts                  typed fetch wrapper, endpoint functions, translated error messages
lib/i18n.ts, lib/i18n/      language store, t(), dictionaries
lib/format.ts               useFmt(): labels, company-time-zone dates, relative times, task text
lib/hooks.ts                useApi (tiny data hook with refetch-in-place), useNow, useDebounced
lib/auth.tsx                session context (token, /auth/me, permissions, language)
```
