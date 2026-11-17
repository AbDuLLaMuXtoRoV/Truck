# Access control (RBAC) — initial design

Source of truth in code: [backend/app/core/rbac.py](../backend/app/core/rbac.py) (permissions) and [backend/app/domain/task_state.py](../backend/app/domain/task_state.py) (who may change task status). Tests: `tests/test_state_machine.py`, `tests/test_api.py`.

## Principles

1. **Tenant isolation first.** Every query filters by the caller's `company_id`. Tasks from another company are reported as 404, not 403.
2. **Least privilege by role, then scope by department.** A permission like `tasks.review` applies only to tasks the user *manages*: all tasks for managers, own-department tasks for department leads.
3. **The AI and system jobs are actors too.** They go through the same checks, with a narrower allow-list: the AI can never complete or cancel a task.
4. **Every change is attributable.** Task changes go to `task_events`; everything else (logins, group allow-list, users, departments, trucks, Telegram links) goes to the append-only `audit_logs`.

## Roles

| Role | Who | Summary |
|---|---|---|
| owner | Company owner | Everything, including granting the owner role |
| admin | IT / platform admin | Everything except granting the owner role |
| manager | Operations manager | All tasks in all departments, raw messages, AI logs, trucks. Cannot enable groups or manage users. |
| dept_lead | Head of ELD / Accounting / Fleet / … | Review, assign, verify and cancel tasks **in their department** |
| agent | Department staff | See their department's tasks; work their own assigned tasks; create tasks |
| viewer | Read-only stakeholder | Dashboards and task lists, no changes |

Drivers are **not** portal users in Phase 1. They work in Telegram, and their identity is a `telegram_users` row.

## Permission matrix

| Permission | owner | admin | manager | dept_lead | agent | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| dashboard.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tasks.read_all | ✓ | ✓ | ✓ | | | ✓ |
| tasks.read_department | ✓ | ✓ | | ✓ | ✓ | |
| tasks.create | ✓ | ✓ | ✓ | ✓ | ✓ | |
| tasks.update_all | ✓ | ✓ | ✓ | | | |
| tasks.update_department | ✓ | ✓ | | ✓ | | |
| tasks.review | ✓ | ✓ | ✓ | ✓ (dept) | | |
| tasks.verify | ✓ | ✓ | ✓ | ✓ (dept) | | |
| tasks.cancel | ✓ | ✓ | ✓ | ✓ (dept) | | |
| messages.read (raw chat + AI logs) | ✓ | ✓ | ✓ | | | |
| groups.read | ✓ | ✓ | ✓ | ✓ | | ✓ |
| groups.manage (allow-list) | ✓ | ✓ | | | | |
| fleet.manage (trucks) | ✓ | ✓ | ✓ | | | |
| users.manage (users, departments) | ✓ | ✓ | | | | |
| audit.read | ✓ | ✓ | | | | |

Everyone can always see tasks they are assigned to or created, whatever their department.

## Task status changes

| Change | Who |
|---|---|
| Review a candidate (`detected`/`needs_review` → `assigned`/`cancelled`) | `tasks.review` + manages the task. Unrouted tasks (no department) → managers only |
| Work transitions (`assigned` → `in_progress` / `blocked` / `pending_verification`, `blocked` → `in_progress`) | the **assignee**, or anyone who manages the task |
| Verify (`pending_verification` → `completed`), reject, reopen | `tasks.verify` + manages the task. **Four-eyes:** not the assignee (company setting `four_eyes`, default on) |
| Cancel / restore | `tasks.cancel` + manages the task |
| Edit fields, reassign | manages the task |
| Comment | anyone who can read the task |
| AI | only to `needs_review`, `assigned` (auto-assign, off in the pilot), `blocked`, `pending_verification` |
| System (SLA jobs) | reminders and escalations only; no status changes |

A reason is required for `blocked`, `cancelled`, reopening and rejecting a verification.

## Telegram-side identity

- Anyone in an **enabled** group can use `/task`. The task lands in *Needs review*, so it can't skip human triage.
- A portal user is linked to their Telegram account through a one-time deep link (30-minute token, single use). The link only enables DMs and attribution; it grants **no** extra permissions.

## Before rollout (not built yet)

- 2FA for owner and admin.
- Postgres row-level security keyed on `company_id`, as defence in depth before SaaS (Phase 3).
- A DB role for the app with `INSERT, SELECT` only on `audit_logs`:
  `REVOKE UPDATE, DELETE ON audit_logs FROM smart_app;`
- Refresh tokens, session revocation, and a password policy and reset flow.
