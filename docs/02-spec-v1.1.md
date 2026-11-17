# Smart Truck AI Management Platform — Specification v1.1

Supersedes v1.0 (13 Nov 2026). The reasons for each change are in [01-spec-review.md](01-spec-review.md); review item IDs are given in brackets, e.g. [B3].

## 1. Goal

Detect every work task in 150+ allowed Telegram groups, route it, track it to verified completion, and show the state of operations to management in one place. Telegram stays the place where the work happens in Phase 1. The platform listens, organises and reminds people.

```
Telegram groups (allow-listed)
   │  webhook (secret token) · idempotent ingest
   ▼
Ingestion ── messages, revisions, attachments, Telegram identities
   │  debounced per chat (90 s, max 5 min)
   ▼
AI analysis ── conversation window + open tasks → structured proposals
   │  (new task | update existing task) · logged in ai_extractions
   ▼
Task engine ── dedupe → route → SLA → state machine → events/audit
   ▼
Control center ── dashboard · review queue · notifications · search
```

## 2. Sources and content

| Item | Requirement |
|---|---|
| Groups | Only groups an admin has **enabled**. Messages from groups that aren't enabled are never stored [A9]. Bot privacy mode must be off [A1]. |
| History | Starts when the bot joins. An optional one-time import from a Telegram Desktop JSON export is for context only [A2]. |
| Message types | Text, captions, voice, audio, photos/screenshots, documents (PDF: BOL, POD, invoice, DOT report, rate confirmation), video. Edits are tracked; deletions cannot be seen [A3]. |
| Languages | Uzbek (Latin + Cyrillic), Russian, English, mixed, with trucking slang [B6]. |
| File limits | 20 MB through the Bot API. Larger files are marked `too_large` and sent to review [A4]. |

## 3. What counts as a task [B1]

A **task** is a message (or several) that

1. asks someone *other than the sender* to do something ("ELD ishlamayapti", "send me the rate con", "чек оплатите"), **or**
2. reports a problem that someone must act on (breakdown, ELD disconnected, missing POD, a disputed charge), **or**
3. contains a commitment ("I'll send the invoice tomorrow").

**Not tasks:** greetings, acknowledgements ("ok", "+", "rahmat"), status-only check calls with nothing to do, jokes, messages already fully resolved inside the same window.

### Categories → departments

| Category | Default department | Examples |
|---|---|---|
| `eld` | ELD | ELD not connecting, HOS edits, logs, unidentified driving |
| `dispatch` | DISPATCH | Load assignment, appointment, detention, lumper, check-call issue |
| `fleet_maintenance` | FLEET | Breakdown, tires, PM, repair invoice, towing |
| `accounting` | ACCOUNTING | Charges, settlements, fuel card, reimbursements, invoices |
| `documents` | ACCOUNTING | BOL / POD / invoice upload or a missing document |
| `safety_compliance` | SAFETY | DOT inspection, out-of-service, accident, citations, IFTA |
| `hr` | HR | Onboarding, driver documents, payroll questions, time off |
| `other` | — (review) | Anything that doesn't fit |

### Priority [C1]

| Priority | Meaning | Default resolution SLA [C2] |
|---|---|---|
| P1 | Safety, a truck stopped, legal or compliance risk (breakdown, accident, OOS, DOT inspection, HOS violation) | 1 h |
| P2 | Revenue at risk today (load at risk, appointment, ELD down while driving) | 4 h |
| P3 | Normal operational task | 24 h |
| P4 | Administrative, no time pressure | 72 h |

A reminder goes to the assignee at 75 % of the window. Escalation goes to the department lead at 100 % and to managers at 150 %. Policies are stored per company in `sla_policies` and can be overridden per category.

## 4. AI analysis

- **Windowing [B4].** A job is scheduled 90 s after each new message in a chat. If newer messages arrive, it waits again, up to 5 min after the oldest pending message. Context sent to the model: the pending messages, up to 15 earlier messages, every reply target, and the open tasks for the chat/truck (up to 25).
- **Output (strict schema).** `new_tasks[]` (title in English, summary, category, priority, truck unit, load reference, explicit deadline, assignee hint, source message refs, confidence) and `task_updates[]` (existing task number, kind ∈ progress / completion_claim / blocker / duplicate_report, note, confidence).
- **Routing [B5].** Confidence < 0.5: dropped and logged. 0.5–0.85: *Needs review*. ≥ 0.85 and the department has an on-duty default assignee: auto-assigned, **only if `AUTO_ASSIGN_ENABLED`** (off during the pilot).
- **Updates [B3].** progress → comment event. blocker → *Blocked*, with the reason. completion_claim → *Pending verification*. duplicate_report → link the message. The AI never moves a task to *Completed* or *Cancelled* [B9].
- **Dedupe [B12].** The model sees open tasks. A deterministic backstop links a new proposal to an existing open task with the same truck and category, less than 72 h old and with text similarity ≥ 0.5.
- **Safety [B9].** Chat content is labelled as untrusted data. The output is schema-constrained. Every change goes through the same state machine humans use.
- **Traceability [B10].** Every call is logged: model, prompt version, message IDs, raw output, tokens, latency, status (ok / refusal / error).
- **Media [B7, B8].** Voice goes through a pluggable STT provider, chosen by the bake-off in weeks 2–3. Images and PDFs go directly to the multimodal LLM; OCR is a fallback only.
- **Model.** Claude (`claude-opus-5-5`, set with `AI_MODEL`), structured outputs, explicit effort level, server-side refusal fallback. Model and effort are tuned against the golden dataset, not by guesswork.

## 5. Task statuses and transitions [C3–C6]

`detected → needs_review → assigned → in_progress → pending_verification → completed`, plus `blocked` and `cancelled`.
*Overdue* is a derived flag. *Reopen* is a transition (completed → in_progress) recorded as a `reopened` event.

| From | Allowed to | Who |
|---|---|---|
| detected | needs_review, assigned, cancelled | system, reviewer |
| needs_review | assigned, cancelled | reviewer (`tasks.review`) |
| assigned | in_progress, blocked, pending_verification, needs_review, cancelled | assignee or lead; cancel needs `tasks.cancel` |
| in_progress | blocked, pending_verification, assigned, cancelled | assignee or lead |
| blocked | in_progress, assigned, cancelled | assignee or lead |
| pending_verification | completed, in_progress (rejected) | verifier (`tasks.verify`), not the assignee if `four_eyes` is on |
| completed | in_progress (reopen) | `tasks.verify` |
| cancelled | needs_review (restore) | `tasks.cancel` |

`blocked`, `cancelled` and a rejected verification require a reason. `assigned` requires an assignee. Every change writes a `task_events` row (who, when, from → to, why). The AI may only move a task into `needs_review`, `assigned`, `blocked` or `pending_verification`.

## 6. Notifications [A5, A6]

The channels are the dashboard (always) and a Telegram DM (when the user has linked their account through the `/start` deep link). Posts in groups are limited to a short acknowledgement when a task is created from `/task`. Every outbound Telegram call goes through a per-chat rate limiter.

## 7. Data model [C7, D2]

Every tenant table has `company_id`. Tables:
`companies, departments, users, telegram_users, trucks, drivers, truck_driver_assignments, telegram_groups, messages, message_revisions, attachments, tasks, task_messages, task_events, sla_policies, notifications, audit_logs, ai_extractions`.
Key constraints: unique `(tg_chat_id, tg_message_id)`; unique `(company_id, task number)`; tasks keep a copy of their source text; `audit_logs` is append-only.
Phase 2 adds `loads` (until then, `tasks.load_ref` is free text).

## 8. Access control [D3]

Roles: owner, admin, manager, dept_lead, agent, viewer. The full matrix is in [03-rbac.md](03-rbac.md).

## 9. Security and data [D1, D4]

TLS everywhere. bcrypt passwords and short-lived JWTs (2FA for admins before rollout). Encrypted object storage with signed URLs. Retention: raw voice and media 90 days by default, messages 2 years, audit log 7 years (configurable). The AI vendor's data-retention terms are reviewed before the pilot. Group members are told the bot is present. The app's DB role has no UPDATE/DELETE on `audit_logs`.

## 10. Non-functional requirements [E4]

| Item | Target |
|---|---|
| Message → task visible | p95 ≤ 2 min (window delay included) |
| API latency | p95 ≤ 300 ms for dashboard reads |
| Availability | 99.5 % in the pilot, 99.9 % at rollout |
| Backups | Daily full backup + point-in-time recovery, restore tested monthly |
| Observability | Structured logs, request IDs, error alerts, queue depth, AI error/refusal rate |

## 11. Pilot acceptance criteria [B2]

Measured on the labelled golden set (≥ 500 windows) **and** on two weeks of live pilot traffic:

| Metric | Target |
|---|---|
| Task recall (actionable tasks found) | ≥ 90 % |
| Task precision | ≥ 80 % |
| Department routing accuracy | ≥ 90 % |
| Truck number accuracy | ≥ 95 % |
| Duplicate tasks created | ≤ 5 % |
| Voice: tasks missed because of transcription | ≤ 10 % of voice tasks |
| Every task links back to its source Telegram message | 100 % |
| Unauthorised access in the permission test suite | 0 |

Full rollout starts only after these are met.

## 12. Revised 16-week plan [E1, E2, B7]

| Weeks | Outcome |
|---|---|
| 1–2 | Spec v1.1, DB schema, Telegram ingestion, task API + state machine, RBAC, clickable dashboard, test plan **(this repository)** |
| 2–3 | **STT bake-off** on 100 real voice notes. **Shadow mode** in pilot groups. Volume measurement. Labelling tool. |
| 3–4 | Message ingestion hardening, truck/driver mapping, attachment download, AI detection v1 (text) |
| 5–6 | Reply chains and windows, update proposals, dedupe, **review queue UI**, first golden-set eval |
| 7–8 | Voice transcription in production, Uzbek/Russian/English slang tuning, weekly eval |
| 9–10 | Images, screenshots, PDF, BOL/POD/invoice, DOT parsing through the multimodal model |
| 11–12 | Notifications (DM), SLA reminders and escalation, reports, search |
| 13–14 | Pilot on live traffic and measurement against §11 |
| 15–16 | Fixes, security review, load test, rollout readiness |

Estimate: 14–18 weeks. Risks: STT quality for code-switched Uzbek, labelling time from ops staff [E5], and Telegram permissions in every group.

## 13. Team [E5]

| Role | Owns |
|---|---|
| Backend | Telegram connector, task engine, API, SLA jobs |
| AI engineer | Prompts, eval harness, STT bake-off, slang glossary |
| Frontend | Dashboard, review queue, task screens, search |
| Full-stack | Auth/RBAC, notifications, document pipeline plumbing, integrations |
| QA / DevOps | Golden-set tooling, permission tests, CI/CD, monitoring, backups |
| **Ops expert (part-time)** | 2–4 h/week labelling and slang review: a required resource |

## 14. Roadmap

Phase 1: AI oversight + web dashboard on top of Telegram. Phase 2: a full portal (login, internal chat, truck workspace, documents, mobile, `loads`). Phase 3: a gradual move off Telegram and SaaS (billing, Postgres RLS on top of the existing `company_id` isolation).
