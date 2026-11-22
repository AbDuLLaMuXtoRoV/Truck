# Trucking Operations CRM (frontend)

Web app of the Trucking Operations CRM: unified Telegram + Gmail inbox, a 5-minute human-response
timer on every inbound message, escalations (3 min team, 5 min supervisor, 10 min manager/owner),
issues tracked to resolution, shifts and handovers, and a multi-company owner view. It is a
client-rendered Next.js (App Router)
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

## CRM and simple mode

Supervisors (dept leads), managers, owners, admins and viewers start in the **CRM** (the "advanced"
mode); agents start in **simple mode**. The switch is in the avatar menu for everyone.

The CRM:

- **Dashboard**: KPIs (inbound messages, active / unresolved issues, overdue responses, resolved),
  then three panes: the unified inbox, the issues table (live reply countdown in the "Response SLA"
  column) and the issue panel (details, messages, activity, resolution; Mark as resolved / Update /
  Escalate; escalation history). Owners also get the all-company overview strip.
- **Company scope**: the top-bar switcher stores a company id (`localStorage` key `smart-truck.company`).
  `lib/api.ts` sends it as `X-Company-Id` on every request. "All companies" sends nothing, so the
  backend answers for the home company, and owners also see the all-company overview. `useApi` keys
  its cache by company.
- **Live timers**: reply clocks count down every second on the client from `due_at`; inbox, issues and
  badges refresh every 15 s. The issues table takes the clock from the inbox list, because `TaskOut`
  only carries `response_status`.
- **Pages**: Unified Inbox (`/inbox`; thread actions: create issue, link to issue, no reply needed),
  Issues (`/tasks`; the sidebar's department list filters it), Escalations, Companies (owner), Shifts
  (start / end with handover, accept handovers, coverage), Reports (reply speed charts), Team &
  Permissions (users + Telegram staff roster), Integrations (Telegram, Gmail OAuth, TMS CSV import) and
  Settings. Google sends the browser back to `/settings?tab=integrations&gmail=connected` (or `=error`).
- **Wording**: statuses read New, Acknowledged, In Progress, Waiting External, Resolution pending
  approval, Resolved, Closed (not an issue); open issues with `reopen_count > 0` show "Reopened".

Simple mode is built for dispatchers, ELD staff and accountants on phones:

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

The mode is remembered per user (`localStorage` key `smart-truck.mode.<userId>`). `/tasks/{id}` works in
both modes. The simple task page keeps everything else (properties, deadline bar, timeline, merge, all
status changes) under "More details". Agents also see a card with unanswered messages in their
department, linking to the inbox.

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
- **Shell** (CRM): collapsible dark sidebar with count badges (`GET /api/dashboard/badges`, polled every
  15 s and refreshed on every local change) and an expandable department list; top bar with the product
  name, company switcher, time range, search (Ctrl/⌘+K), theme, language, bell and profile menu.
- Review queue keyboard shortcuts: A approve & assign, E edit, N not a task, D duplicate, J/K next/previous.

## Adding or changing text

Add the key to `lib/i18n/en.ts` first, then to `ru.ts` and `uz.ts`; the compiler rejects a dictionary
that misses a key. Plural keys end in `_one` / `_other` (Russian also `_few` / `_many`).

## Layout

```
app/
  login/page.tsx            sign-in (with language switch)
  (app)/layout.tsx          signed-in shell (simple or advanced; waits for /auth/me, redirects anonymous users)
  (app)/page.tsx            home: role home (simple) or the CRM dashboard (components/crm/Dashboard.tsx)
  (app)/inbox/page.tsx      unified inbox: filters, conversations with live timers, thread
  (app)/escalations/page.tsx  escalation steps with level badges
  (app)/companies/page.tsx  owner: per-company breakdown, new company
  (app)/shifts/page.tsx     my shift, incoming handovers, coverage by department
  (app)/reports/page.tsx    reply speed and issue trend charts
  (app)/team/page.tsx       users and the Telegram staff roster
  (app)/integrations/page.tsx Telegram, Gmail, TMS
  (app)/list/page.tsx       simple lists behind the home tiles and menu (?kind=new|doing|check|late|done|my_done)
  (app)/settings/page.tsx   settings hub (CRM) or simple settings; ?tab=integrations shows Integrations
  (app)/tasks/page.tsx      task table, filters kept in the URL query string, "New task" dialog
  (app)/tasks/[id]/page.tsx task page: simple (components/simple/SimpleTaskPage.tsx) or full detail
                            (components/AdvancedTaskDetail.tsx)
  (app)/review/page.tsx     review queue for detected / needs_review tasks
  (app)/groups/page.tsx     Telegram group allow-list
  (app)/trucks/page.tsx     fleet list with open and overdue counts
components/                 shell, language switch, badges, charts, pickers, attachments, dialogs
components/crm/             CRM: inbox, issues pane and panel, dashboard, integrations, shared pills
components/simple/          simple mode: shell, role homes, task cards, big buttons, onboarding and help
lib/company.ts, lib/crm.ts  company scope + time range stores; department names, clocks, issue helpers
lib/stage.ts, lib/mode.ts   status -> stage mapping, plain deadlines, simple actions; simple/advanced switch
lib/types.ts                API contract types (mirror backend/app/api/schemas.py)
lib/api.ts                  typed fetch wrapper, endpoint functions, translated error messages
lib/i18n.ts, lib/i18n/      language store, t(), dictionaries
lib/format.ts               useFmt(): labels, company-time-zone dates, relative times, task text
lib/hooks.ts                useApi (tiny data hook with refetch-in-place), useNow, useDebounced
lib/auth.tsx                session context (token, /auth/me, permissions, language)
```
