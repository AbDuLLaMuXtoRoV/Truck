# Smart Truck AI Management Platform

Finds work tasks in the company's Telegram groups (text, voice, documents; Uzbek, Russian and English), routes them to departments, tracks them to verified completion, and shows management one dashboard.

**Docs:** [Spec review: problems found and fixes](docs/01-spec-review.md) · [Spec v1.1](docs/02-spec-v1.1.md) · [Access control](docs/03-rbac.md) · [Test plan](docs/04-test-plan.md) · [How to test it (step by step)](docs/05-testing-guide.md)

```
backend/    FastAPI API, Telegram ingestion, AI task engine, Celery jobs, Alembic migrations, tests
frontend/   Next.js dashboard (overview, tasks, review queue, groups allow-list, trucks)
docs/       Specification and design documents
docker-compose.yml   Postgres + Redis + API + workers + dashboard
```

## Quick start (local, no Docker)

Requires Python 3.12+ and Node 20+.

```bash
# Backend: SQLite + in-process jobs, no Redis needed
cd backend
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"        # macOS/Linux: .venv/bin/pip
cp .env.example .env
.venv/Scripts/python -m app.cli reset-demo   # demo company, users, trucks, groups, tasks
.venv/Scripts/uvicorn app.main:app --reload --port 8000
# API docs: http://localhost:8000/docs

# Dashboard (second terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                                  # http://localhost:3000
```

Port 8000 already in use? Start the API with `--port 8010` and set `NEXT_PUBLIC_API_URL=http://localhost:8010` in `frontend/.env.local`.

Demo logins (password `demo12345`): `owner@`, `manager@`, `eld.lead@`, `eld.agent@`, `acct.lead@`, `fleet.lead@`, `dispatch.lead@`, `viewer@demo-trucking.com`. The demo numbers are sample data, not real operational statistics.

Tests: `cd backend && .venv/Scripts/python -m pytest -q`

## Connecting Telegram

1. Create the bot with @BotFather. **Then `/setprivacy` → Disable.** With privacy mode on, the bot only sees commands and mentions. A bot that was added to a group *before* the change must be removed and re-added.
2. In `backend/.env`, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`, then run `python -m app.cli check-bot`. It must report `Privacy mode: OFF`.
3. Local development: `TELEGRAM_MODE=polling` and restart the API. Production: `TELEGRAM_MODE=webhook`, set `TELEGRAM_WEBHOOK_SECRET`, then `python -m app.cli set-webhook --url https://<api-host>/api/telegram/webhook`.
4. Add the bot to a group. The group appears in **Dashboard → Groups** as *pending*, and **nothing from it is stored until you enable it**. While enabling, set its kind (truck / department / dispatch) and its default truck or department.
5. Staff link their Telegram account for DM notifications via profile → *Connect Telegram* (the bot can't message people who haven't pressed Start).
6. In any enabled group, `/task <text>` (or a reply to a message with `/task`) creates a task for review.

There's no Telegram yet? `python -m app.cli simulate --chat-id -1001000000125 --text "Aka, 125 ELD ishlamayapti" --analyze` pushes a fake message through the real pipeline.

## AI

Set `AI_ENABLED=true` and `ANTHROPIC_API_KEY`. The default model is `claude-opus-5-5` at `AI_EFFORT=medium`, with strict structured output and the server-side refusal fallback turned on. Both model and effort are configuration, so tune them against the labelled dataset (test plan §2) rather than by guesswork. With AI off, messages are still stored and wait as `pending`, so nothing is lost. Every model call is logged in `ai_extractions` (visible at `GET /api/ai/extractions`): tokens, latency, raw output. Keep `AUTO_ASSIGN_ENABLED=false` during the pilot.

Speech-to-text is a provider interface ([app/ai/transcribe.py](backend/app/ai/transcribe.py)). The vendor is chosen in the weeks 2–3 bake-off. Until then, voice notes show as "[voice message, not transcribed]" and go to review.

## Online demo on this PC

```powershell
winget install --id Cloudflare.cloudflared             # once: free public HTTPS URL, no account
powershell -ExecutionPolicy Bypass -File deploy\start-demo.ps1
powershell -ExecutionPolicy Bypass -File deploy\stop-demo.ps1
```

`start-demo.ps1` runs the API + Telegram bot + AI (port 8010), the dashboard (port 3000, which also serves `/api`) and a Cloudflare quick tunnel. It prints the public URL and saves it to `deploy\PUBLIC_URL.txt`. Without cloudflared it runs locally only; the bot still works because it connects out to Telegram. Logins are in `deploy\DEMO_LOGINS.txt`. The PC must stay on and awake, and the quick-tunnel URL changes on every restart. For a permanent address, use a VPS with Docker (below).

The interface, notifications and bot messages are available in Uzbek (Latin), Russian and English. Each user picks a language, and AI tasks get Uzbek and Russian titles.

## Docker / production

```bash
cp backend/.env.example backend/.env    # set JWT_SECRET, Telegram, AI keys
docker compose up --build
docker compose exec api python -m app.cli create-admin --email you@company.com --password '<strong password>' --company "Your Company"
```

Migrations run on API start (`alembic upgrade head`). Keep the `worker-telegram` service at one process so the Telegram rate limiter holds. Before the pilot: TLS in front of the API, an S3-compatible encrypted bucket instead of local storage, Postgres backups with PITR, and `REVOKE UPDATE, DELETE ON audit_logs` for the app DB role.

## Status: weeks 1–2 deliverables (spec §12)

| Deliverable | State |
|---|---|
| Working Telegram bot integration | ✅ webhook + polling, allow-list, edits, media, migration, `/task`, `/start` linking |
| Receives messages from test groups | ✅ (simulated in tests and CLI; needs a real bot token to try live) |
| PostgreSQL schema | ✅ 18 tables, Alembic migration (checked with `alembic check`; Postgres DDL rendered offline) |
| Task create / status update API | ✅ state machine, RBAC, events, merge, SLA |
| Clickable dashboard prototype | ✅ connected to the real API (frontend/) |
| Access permissions design | ✅ [docs/03-rbac.md](docs/03-rbac.md), enforced and tested |
| Test plan | ✅ [docs/04-test-plan.md](docs/04-test-plan.md) |
| Ahead of plan | AI detection pipeline (conversation windows, dedupe, updates to existing tasks, SLA escalation) running on Claude and verified on real Uzbek/Russian messages |
| Ahead of plan | AI reads photos and PDFs (BOL, POD, receipts, invoices, ELD screenshots) directly; attachments can be opened from the dashboard |
| Ahead of plan | Uzbek, Russian and English: dashboard, notifications, bot messages and command menu; AI tasks get Uzbek and Russian titles |
| Ahead of plan | New groups are auto-mapped from their title (truck number / department) but stay pending until approved; the bot announces itself |
| Ahead of plan | Staff work entirely from Telegram: task messages carry buttons (Start · I'm done · I'm stuck · Confirm · Send back), plus `/mytasks`; same permission rules as the dashboard |
| Ahead of plan | Simple mode (default): role-based home pages, 4 plain stages (New → In work → Checking → Done), big buttons, built-in help; the full UI remains as "Advanced mode" |

Next: speech-to-text vendor comparison (voice notes are not transcribed yet), shadow mode in the pilot groups, labelling tool + eval harness, S3 storage, CI with Postgres, a permanent server.
