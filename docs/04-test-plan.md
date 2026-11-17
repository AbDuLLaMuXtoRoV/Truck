# Test plan

The plan has three layers: automated tests in CI on every change, an AI quality evaluation on a labelled dataset, and pilot acceptance on live traffic (spec v1.1 §11).

## 1. Automated tests (done for weeks 1–2)

Run: `cd backend && .venv/Scripts/python -m pytest -q` (Windows) or `.venv/bin/pytest -q`.

| Suite | Covers |
|---|---|
| `test_state_machine.py` | Every transition rule; required reasons; the AI can't complete or cancel; four-eyes; department scoping; viewer read-only; cross-company denial |
| `test_domain.py` | Truck-number extraction (Uzbek, Russian, English, `$` amounts are not trucks); dedupe similarity; SLA math; prompt escaping (injection) |
| `test_ingest.py` | Allow-list (unknown and disabled groups store nothing); idempotent redelivery; edits → revisions + re-analysis; voice attachment; > 20 MB → `too_large`; `/task` command + acknowledgement; supergroup migration; `/start` account linking and token expiry |
| `test_analysis.py` | Debounce and max-wait windows; routing to department/truck; low-confidence drop; context messages can't spawn tasks; unknown truck kept raw; dedupe backstop; open tasks in the prompt; auto-assign flag; completion → pending verification only; blocker; refusal → human; retryable errors keep messages pending; analysis lease |
| `test_extractor.py` | The exact Claude request (model, effort, structured-output schema, refusal fallback, prompt caching), with the SDK running over a mocked HTTP transport; refusal, 429, 400, schema violation and truncation handling |
| `test_api.py` | Login and auth; the full lifecycle over HTTP; department visibility; filters and search; overdue as a flag; merge; dashboard counts; allow-list permission + audit; webhook secret; user admin |
| `test_sla.py` | Reminder at 75 %; escalation to the lead at 100 % and to managers at 150 %; idempotency |

Still to add in CI: a Postgres service container (the tests use SQLite today; the migrations are checked with `alembic check`), `ruff`, a frontend `npm run build`, and dependency scanning.

## 2. AI quality evaluation (from week 3)

1. **Collect.** Shadow mode in the pilot groups (bot enabled, `AUTO_ASSIGN_ENABLED=false`, no group acknowledgements). Stored windows = `ai_extractions.message_ids`.
2. **Label.** An ops expert labels ≥ 500 windows: the tasks it contains (title, category, priority, truck, department) and the updates to existing tasks. Keep 20 % as a held-out test set that is never used for prompt tuning.
3. **Score.** Task recall and precision (matched by source messages + category), routing accuracy, truck accuracy, duplicate rate, update-kind accuracy, and voice: tasks missed because of transcription.
4. **Gate.** A prompt or model change (`PROMPT_VERSION`, `AI_MODEL`, `AI_EFFORT`) ships only if it doesn't regress the held-out scores. Record tokens and latency per window, so cost per window is measured instead of guessed.
5. **Feedback.** Reviewer actions (approve, edit category/priority, cancel as "not a task", merge as duplicate) become new labelled examples every week.

## 3. Manual / exploratory checklist for the pilot

- [ ] Bot privacy mode is OFF (`python -m app.cli check-bot`); the bot was re-added to every group after the change.
- [ ] A new group appears as *pending*, and nothing is stored until it's enabled.
- [ ] A voice note with no STT configured → "[voice message, not transcribed]" → the window still reaches review.
- [ ] A 25 MB PDF → attachment `too_large` and visible in the task.
- [ ] Editing a message updates it and triggers re-analysis; deleting it in Telegram leaves the task's `source_text` intact.
- [ ] "Open in Telegram" links work for supergroups.
- [ ] DMs arrive only for linked users; blocking the bot turns DMs off without errors.
- [ ] 50 groups posting at once: no lost updates (check the counts against the Telegram exports), and every task is visible within 2 minutes.
- [ ] Each role sees exactly the menus and actions in [03-rbac.md](03-rbac.md).

## 4. Pilot acceptance

The metrics and targets are in spec v1.1 §11, measured on the held-out labelled set **and** on two weeks of live pilot traffic. Full rollout needs all targets met and sign-off from operations.
