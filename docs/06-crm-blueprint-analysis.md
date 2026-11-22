# Unified Trucking Communications CRM — blueprint analysis and implementation

Sources: `trucking_crm_technical_blueprint.docx` (v1.0, 21 Nov 2026), the architecture screenshot ("Proposed system architecture") and the "Trucking Operations CRM" dashboard mockup.

## 1. What changed in the product

| Before (spec v1.1) | Blueprint (now) |
|---|---|
| AI turns Telegram messages into tasks; we track them to verified completion | A **communications CRM**: every inbound message from a driver, broker or customer must get a **human reply within 5 minutes, 24/7**, and issues are tracked to resolution |
| Telegram only | Telegram **and Gmail / Google Workspace** inboxes, in one **unified inbox**; TMS loads and drivers as reference data |
| One company | **Multiple companies**, with an owner overview across them and audited cross-company access |
| Deadlines on tasks (P1 1 h … P4 72 h) | Kept, **plus** a separate response SLA: reminder at 3 min, overdue at 5 min, manager/owner at 10 min |
| — | Shift coverage: on-duty roster, handover with acknowledgement, alerts when there is a coverage gap |
| Category, truck, load | Plus issue type, amount, trailer, driver; issues linked across channels by load / trailer / truck |

The core of what we built carries over (Telegram ingestion, AI analysis, the case state machine, permissions, audit, i18n, dashboard). The new parts were added on top of it.

## 2. Photos

**Architecture screenshot.** The flow is Telegram (100+ groups) + Gmail (multiple inboxes) + TMS (loads, drivers) → centralized AI processing (message classification, task creation, response monitoring) → CRM dashboard (open issues, assignments) + escalations (5-minute SLA → managers → owners). This matches blueprint §3 and is now the architecture of the system.

**Dashboard mockup.** Every element maps to an API:

| Mockup element | Implemented as |
|---|---|
| Company switcher "All Companies (5)" | `GET /api/companies`; the `X-Company-Id` header scopes each request; owner overview |
| KPIs: Total messages, Active issues, Overdue response, Unresolved, Resolved (24h) | `/api/dashboard/summary`, `/api/dashboard/response`, `/api/owner/overview` |
| Unified Inbox with Telegram / Gmail / All tabs | `GET /api/inbox?source=…` and `GET /api/inbox/thread` |
| Active Issues table with "Response SLA" countdown (04:27) | `TaskOut.response_status` plus the inbox timers (`seconds_left`) |
| Issue panel: Source, Reported, Department, Assigned to, Priority, Issue type, Load / Driver | `TaskDetailOut` (new fields `issue_type`, `amount`, `trailer_ref`, `driver_name`, `source_channel`, `mailbox`) |
| "Message answered: Yes (10:26 AM)" / "Issue resolved: No" | `TaskDetailOut.response` (`message_answered`, `answered_at`, `answered_by_name`) |
| Mark as Resolved / Update / Escalate | Existing transitions / PATCH; `POST /api/tasks/{id}/escalate` |
| Escalation history ("No response in 5 minutes — escalated to Dispatch Manager") | `TaskDetailOut.escalations`, `GET /api/escalations` |
| Owner overview: companies, Telegram groups, Gmail accounts connected, overdue, unresolved, resolved | `GET /api/owner/overview` (per-company breakdown) |
| Sidebar: Companies, Departments (incl. **Trailers**), Reports, Team & Permissions, Integrations | Companies API; new TRAILER department and `trailer` category; roster; integrations status |

## 3. Requirement-by-requirement status

| Blueprint § | Requirement | Status |
|---|---|---|
| 2 | Company & department registry; channel → company, department, manager, owner, backup | ✅ Departments incl. Trailer; per-channel `supervisor_id` / `manager_id` / `backup_id` on groups and mailboxes |
| 2 | Inbound capture (text, sender, source, time, reply / thread ids, attachment metadata, voice) | ✅ Telegram + Gmail; voice still needs an STT vendor |
| 2 | Classification: actionable / informational / automated / duplicate / spam; AI decisions audited | ✅ The AI labels every message; rules for acknowledgements and auto-mail; all calls logged in `ai_extractions` |
| 2, 7 | 24/7 response SLA 3 / 5 / 10 min; human reply only; configurable exceptions | ✅ `response_clocks`; bot, AI and out-of-office never stop the clock; "no reply needed" is audited |
| 2 | Issue states New → Acknowledged → In Progress → Waiting External → Resolved → Reopened | ✅ Mapped onto the existing state machine (UI labels); resolution needs a second person; Reopened = transition + badge |
| 2, 7 | Shift coverage, handover with acknowledgement, alert the backup on gaps | ✅ `shifts`, `handovers`; cases keep their owner until accepted; alert after 15 min; coverage-gap alerts (switch on with `COVERAGE_ALERTS_ENABLED`) |
| 2 | Cross-channel linking by load / truck / trailer / driver / invoice | ✅ Identifier extraction + AI context + dedupe across channels; manual link-message |
| 2 | Role views: agent, supervisor, company manager, owner, admin; isolation + audited cross-company access | ✅ Roles map to agent / dept_lead / manager / owner / admin; `user_company_access`; `company.cross_access` audit |
| 3 | Connectors: Telegram webhook, Gmail OAuth + watch / history, TMS adapter | ✅ Telegram; Gmail OAuth + history polling (Pub/Sub push = next step); TMS CSV adapter + protocol for a vendor API |
| 3 | Idempotent workers, retries, recovery replay | ✅ Unique keys per source; sweeper; lease locks; Gmail re-sync on expired history |
| 4 | Telegram limits (privacy, no history, roster for staff identity) | ✅ Allow-list, roster page, the bot must be admin or have privacy off |
| 5 | Least-privilege Gmail scope; per-mailbox connection; reply tracking by thread; exclude auto-replies | ✅ `gmail.readonly`; tokens encrypted (`ENCRYPTION_KEY`) |
| 6 | Data model (companies … notifications), unique source keys, UTC storage | ✅ 25 tables; migration `9105571988a5` |
| 8 | AI extracts issue type, urgency, amount, load, driver, truck, trailer; low confidence → human | ✅ |
| 8 | English + Uzbek (+ Russian) | ✅ All three (UI, bot, AI) |
| 9 | Encryption, tenant isolation, least privilege, audit | ✅ partly. Still to do before production: MFA, Postgres RLS, secrets manager, malware scanning, redaction |
| 10 | Owner dashboard, unified inbox, case detail, shift handover, admin screens | 🔄 Dashboard in progress (frontend) |
| 11 | Acceptance tests (below) | ✅ automated where possible |

### Blueprint acceptance tests → automated tests

| Acceptance test | Covered by |
|---|---|
| Duplicate webhook delivery → one message | `test_ingest.py::test_redelivered_update_is_idempotent`, `test_gmail.py::test_sync_starts_and_stops_clocks_by_thread` |
| 5-minute alert triggered accurately | `test_response.py::test_escalation_ladder_3_5_10`, `test_late_check_jumps_to_highest_level_once` |
| Bot reply does not count | `test_response.py::test_bot_and_unlinked_people_do_not_stop_the_clock`, Gmail auto-reply test |
| Shift handover retains open case | `test_crm_api.py::test_shift_handover_keeps_owner_until_accepted` |
| Company access isolation | `test_crm_api.py::test_company_switching_is_scoped_and_audited` |
| Gmail watch recovery | `test_gmail.py::test_expired_history_triggers_controlled_resync` |
| Case resolution audited | `test_api.py::test_task_lifecycle_over_http` (events), `test_state_machine.py` (four-eyes) |
| 100+ groups onboarded | Manual / load test (see test plan); auto-mapping from group titles helps |

## 4. Weak points in the blueprint itself, and how we handled them

1. **Alert fatigue.** A 3-minute reminder to a whole team in 100+ groups is noisy. → Reminders go to **on-duty** staff first (roster), then the department, and each step fires once per message.
2. **"Human reply" needs identity.** Telegram has no "employee" flag. → Staff = linked portal users plus identities marked as staff on the roster page. Until the roster is filled in, every message counts as external.
3. **Unthreaded replies are ambiguous.** "OK, checking" in a busy group might answer any of several drivers. → A reply to a message answers that sender only; a plain message answers everything waiting in that chat. This is configurable (`RESPONSE_UNTHREADED_ANSWERS_ALL=false` to require explicit replies).
4. **Clock start time.** Telegram and Gmail timestamps can be late or wrong. → The clock starts at source time; when that is implausible it starts at receipt time, and the delay is recorded. Matching a reply to a message always uses the original send times.
5. **Gmail scopes and verification.** `gmail.readonly` is a *restricted* scope. For an *external* OAuth app Google requires verification and a security assessment. → Use Google Workspace with an **Internal** OAuth app (no verification), or budget for verification. Pub/Sub push needs a public HTTPS endpoint and a GCP project; polling every 60 s works without either.
6. **Two SLAs.** The blueprint's response SLA (minutes) and resolution deadlines (hours) are different things. → Both are kept: response clocks per message, `due_at` per issue.
7. **States.** "Acknowledged" vs "Assigned", and where verification fits, were not defined. → Labels map onto the existing machine: Acknowledged = assigned; "Resolution pending approval" = a second person confirms the resolution (matches "only authorized resolution can mark Resolved").
8. **Not specified:** priority definitions, what counts as evidence of resolution, agent performance metrics, data volume, AI cost per message, retention periods. → Defaults from spec v1.1 are kept; they're listed below as decisions.

## 5. Decisions needed from you (blueprint §12)

- **Gmail:** Google Workspace or consumer Gmail? Who creates the Google Cloud project and OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)? Which mailboxes?
- **TMS:** vendor and whether it has an API. Until then, loads come in by CSV import.
- The real company list, managers and owners, and who is the **backup** per channel.
- Which issue types are **safety-critical** (immediate alert). Today: accident, injury, fire, police, theft (EN/UZ/RU keywords) plus every P1 issue.
- Whether **coverage-gap alerts** should be on (they need everyone to check in and out).
- Hosting region, retention policy, expected daily message volume.

## 6. Configuration added

| Setting | Default | Meaning |
|---|---|---|
| `RESPONSE_REMINDER_SECONDS` / `RESPONSE_OVERDUE_SECONDS` / `RESPONSE_ESCALATE_SECONDS` | 180 / 300 / 600 | The response ladder |
| `RESPONSE_UNTHREADED_ANSWERS_ALL` | true | A plain staff message answers everything waiting in the chat |
| `COVERAGE_ALERTS_ENABLED` | false | "Nobody on duty" alerts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Gmail OAuth client |
| `PUBLIC_URL` | http://localhost:3000 | Used for the OAuth redirect `…/api/integrations/gmail/callback` |
| `ENCRYPTION_KEY` | derived from `JWT_SECRET` | Fernet key for OAuth tokens. **Set a real one in production** |
| `GMAIL_SYNC_SECONDS` | 60 | Gmail polling interval |
