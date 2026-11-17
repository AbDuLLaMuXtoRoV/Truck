# How to test Smart Truck: a step-by-step guide

This guide checks that the whole system works: the Telegram bot, the AI, the dashboard, permissions and notifications. Plan on about 45 minutes for everything, or 10 minutes for Parts 0–2 only.

You need:
- this PC with the project in `C:\Users\abdul\Truck`;
- Telegram (phone or desktop) with your two groups, **Dispatch Team** and **Department Group**, where **@truckdipatchbot** is an admin;
- ideally a second person or a second Telegram account, so that test messages come from a "driver".

---

## Part 0 — Start the system (2 min)

1. In File Explorer, open `C:\Users\abdul\Truck` and double-click **`START.bat`**.
2. Wait until the window says **"Smart Truck demo is running"**. The browser opens **http://localhost:3000** by itself. Leave the black window open.
3. Log in:
   - Email: `owner@demo-trucking.com`
   - Password: the one in `deploy\DEMO_LOGINS.txt`. All demo accounts use the same password.

**Accounts for the role tests (Part 4):**

| Email | Role | Department |
|---|---|---|
| owner@demo-trucking.com | Owner (everything) | — |
| manager@demo-trucking.com | Manager | all |
| eld.lead@demo-trucking.com | Department lead | ELD |
| eld.agent@demo-trucking.com | Agent | ELD |
| acct.lead@demo-trucking.com | Department lead | Accounting |
| fleet.lead@demo-trucking.com | Department lead | Fleet |
| dispatch.lead@demo-trucking.com | Department lead | Dispatch |
| viewer@demo-trucking.com | Viewer (read only) | — |

> **Simple mode is the default.** Everyone first sees a simple home page made for their role.
> Some steps below use the full screens (Review queue, Board view, Ctrl+K); to reach them, click your avatar → **Kengaytirilgan rejim** (Advanced mode). Switch back the same way.
>
> **Simple-mode check (5 min):**
> - Log in as `eld.agent@…`: you see **"Mening vazifalarim"** (My tasks) with big **Boshlash** / **Bajardim** buttons.
> - Log in as `eld.lead@…`: you see **"Bugun"** (Today) with "Yangi — kimga berish kerak" (new, to hand out) and "Bajarildi deyilgan — tasdiqlang" (said done, please confirm).
> - Log in as `owner@…`: you see 4 big numbers (Yangi · Ishda · Kechikkan · Bugun bajarildi) and the late list.
> - The **?** (Yordam / Help) button explains every stage and button.
>
> **The timing rule.** The AI doesn't answer each message on the spot. It waits until a chat has been **quiet for 90 seconds**, then reads the whole conversation at once (at most 5 minutes later, if the chat stays busy). New tasks appear about **1.5–2 minutes** after your last message. The dashboard refreshes by itself; you can also press F5.
>
> **Messages sent before a group was approved are not stored** (that's deliberate). Only test with messages sent now.

---

## Part 1 — Quick health check (5 min)

| # | Do this | You should see | ✅ |
|---|---|---|---|
| 1.1 | Open the dashboard → **Telegram guruhlari** (Groups) | "Dispatch Team" and "Department Group" both **enabled**, bot = administrator | ☐ |
| 1.2 | In **Dispatch Team**, send `/help` | Within a few seconds the bot replies with a 3-line message (Uzbek / Russian / English). This proves the bot is receiving messages. | ☐ |
| 1.3 | Send `/task Test: 120 mashinaga moy almashtirish kerak` | The bot replies **"✅ T-… yaratildi…"** in 3 languages | ☐ |
| 1.4 | Dashboard → **Tekshiruv navbati** (Review queue) | The task from 1.3 is in the queue, and the sidebar counter went up by 1 | ☐ |

If 1.2 gets no reply, go to Part 7 (troubleshooting) before continuing.

---

## Part 2 — AI tests in Telegram (15 min)

Send each message in **Dispatch Team**, preferably from a second account. Wait about 2 minutes, then look at the **Review queue**. Open the task to see the details, the "why the AI flagged it" box and the original message.

| # | Message to send | Expected result | ✅ |
|---|---|---|---|
| 2.1 Uzbek | `Aka, 125 mashinada ELD ishlamayapti, inspection oldidaman` | New task, category **ELD**, truck **125**, priority P1 or P2, department ELD | ☐ |
| 2.2 Russian | `Трак 118: скиньте POD по грузу 88231, брокер ждёт до вечера` | Category **Documents**, department **Accounting**, truck 118, load 88231 | ☐ |
| 2.3 English | `Truck 112 blew a tire on I-40 near Amarillo, needs road service ASAP` | **P1** (urgent), category **Fleet / maintenance**, truck 112 | ☐ |
| 2.4 Not a task | `Salom hammaga 👋` then `rahmat aka` | **No new task.** Overview → AI panel: "Model calls" goes up, but no task is created | ☐ |
| 2.5 Two in one | `Aka 2 ta ish: 107 ning yoqilg'i kartasi ishlamayapti, 109 ga PM vaqti keldi` | **Two** separate tasks (fuel card → Accounting, PM → Fleet) | ☐ |
| 2.6 Photo | Send a photo of any receipt, BOL or invoice (even a handwritten note like "Lumper $150, load 77123, truck 104") with the caption `lumper puli o'zimdan to'ladim` | The task text mentions the **amount and numbers read from the photo**. Open the task: the photo shows in the message bubble. | ☐ |
| 2.7 Duplicate | After 2.1 has a task, send `125 ELD hali ham ishlamayapti` | **No second task.** The existing 125 ELD task gets the new message in its timeline ("reported again") | ☐ |
| 2.8 Languages | Switch the dashboard language (UZ / RU / EN at the top) | AI task titles change language: each AI task has Uzbek, Russian and English titles | ☐ |
| 2.9 Edit | Edit a message you sent (e.g. change the truck number) | After about 2 minutes the AI re-reads it; the message shows as edited | ☐ |
| 2.10 Voice | Send a voice message | Stored as **"[voice message, not transcribed]"**. This is a known limitation: no speech-to-text vendor has been chosen yet | ☐ |
| 2.11 Reply + /task | Reply to any message with just `/task` | A task is created from the message you replied to | ☐ |

---

## Part 3 — "Done" detection and verification (10 min)

This checks that the AI can't close tasks on its own and that a second person must confirm.

| # | Do this | Expected | ✅ |
|---|---|---|---|
| 3.1 | Dashboard → Review queue → the **125 ELD** task from 2.1 → pick **Javlon ELD Agent** → **Approve & assign** (keyboard: **A**) | Status becomes **Assigned** | ☐ |
| 3.2 | In Telegram (Dispatch Team), send `ELD ni to'g'irladim, endi ishlayapti` | About 2 minutes later the task moves to **Tasdiq kutmoqda / Pending verification**, **not** Completed | ☐ |
| 3.3 | Log out, log in as `eld.agent@…`, open the task | He **cannot** complete it (no "Complete" button): the four-eyes rule | ☐ |
| 3.4 | Log in as `eld.lead@…` → open the task → **Complete** | Status **Completed**; Overview "Completed today" +1 | ☐ |
| 3.5 | On the completed task → **Reopen** without a reason, then with a reason | Without a reason it's refused; with a reason it goes back to In progress and the timeline shows "reopened" | ☐ |

---

## Part 4 — Dashboard and permissions (10 min)

| # | Do this | Expected | ✅ |
|---|---|---|---|
| 4.1 | Review queue: try **N** (not a task) on a test task | It asks for a reason; the task disappears from the queue as Cancelled | ☐ |
| 4.2 | Review queue: **D** (duplicate) on one of two similar tasks | It merges into the other task, and the messages move over | ☐ |
| 4.3 | Log in as `eld.agent@…` | Sees **only ELD** tasks plus his own; no Groups page | ☐ |
| 4.4 | Log in as `viewer@…` | Can see everything, **no action buttons** | ☐ |
| 4.5 | Log in as `manager@…` → Groups | Can see groups but **cannot** enable or disable them (owner/admin only) | ☐ |
| 4.6 | Tasks page → switch to **Board** view | Columns by status; each card's menu shows only allowed actions | ☐ |
| 4.7 | Press **Ctrl+K**, type `T-1` or `125` | Search jumps to the task | ☐ |
| 4.8 | Top bar → theme toggle | Light / dark / system works | ☐ |
| 4.9 | A **P1** task that you leave alone for over 1 hour | It turns red (**overdue**); the bell shows an escalation for the department lead / manager | ☐ |
| 4.10 Phone (optional) | On a phone on the **same Wi-Fi**, open `http://<this PC's IP>:3000`. The "Network" line in `deploy\logs\web.log` shows it, e.g. `http://192.168.1.4:3000`. Windows may ask to allow Node.js through the firewall. | The mobile layout with a slide-out menu | ☐ |

---

## Part 5 — Work on tasks from Telegram (10 min)

Staff don't need the website: the bot sends them their tasks with buttons. Test it with two people, e.g. you as the **ELD agent** and a colleague as the **ELD lead**, each linking their own Telegram.

1. Log in as `eld.agent@…` → avatar (top right) → **Connect Telegram** → click the link → in Telegram press **Start**. The bot answers **"✅ … hisobiga ulandi"** (linked). ☐
2. Do the same for `eld.lead@…` with the second Telegram account. ☐
3. As the lead, assign a new ELD task to **Javlon ELD Agent**. Within about 15 seconds the agent gets a private message from the bot with buttons **▶ Boshlash · ✓ Bajardim · ⏸ Muammo bor**. ☐
4. Agent taps **▶ Boshlash**. The message updates to "🔧 Ishda", and the dashboard shows the task *in work*. ☐
5. Agent taps **⏸ Muammo bor**, then one of the reasons (e.g. "Ehtiyot qism kutilmoqda"). The task shows "⏸ To'xtab qoldi" with that reason. Tap **▶ Davom ettirish** to continue. ☐
6. Agent taps **✓ Bajardim**. The task goes to "🔍 Tekshiruvda", and the **lead** gets a message with **✓ Tasdiqlash · ↩ Qaytarish**. ☐
7. Lead taps **✓ Tasdiqlash** → "✅ Bajarildi". (Or **↩ Qaytarish**, which sends it back to the agent.) ☐
8. In the private chat with the bot, send **/mytasks**: each open task arrives as a separate message with its buttons. ☐

Rules to check:
- The agent never gets a "Confirm" button for their own work.
- An old button pressed again shows "Bu amalni bajara olmaysiz" and changes nothing.
- Someone whose Telegram isn't linked is told to link it first.

Without the public link (Part 8), the text link in the message points to `localhost`, so it opens only on this PC. Once the public link is on, an **🔗 Ochish** button appears instead.

---

## Part 6 — Automated tests (for developers, 2 min)

```powershell
cd C:\Users\abdul\Truck\backend
.venv\Scripts\python -m pytest -q          # expected: 105 passed
.venv\Scripts\python -m app.cli check-bot   # bot name, privacy mode, webhook status
cd ..\frontend
npm run build                               # expected: no errors
```

---

## Part 7 — Troubleshooting

**Where to look:** `C:\Users\abdul\Truck\deploy\logs\api.err.log`. After each AI run it has a line such as:

```
analysis group=… status=ok created=['T-61']
```

| status | Meaning |
|---|---|
| `ok` | The AI ran; `created=[…]` lists new tasks (an empty list means "nothing actionable") |
| `waiting` | The chat isn't quiet for 90 s yet; it runs again automatically |
| `ai_off` | AI disabled: `AI_ENABLED=true` must be set in `backend\.env` |
| `error` / `refusal` | See the warning line just above it, e.g. API key or rate-limit problems |

| Problem | Likely cause → fix |
|---|---|
| localhost:3000 doesn't open | START.bat isn't running, or port 3000 or 8010 is in use → run STOP.bat, then START.bat; check the START window for a red message |
| Bot doesn't answer `/help` | The system is stopped, or the group isn't enabled (Groups page). Check `api.err.log` for `Polling as @truckdipatchbot`. |
| Bot answers commands but the AI never sees normal messages | The bot isn't an **admin** in that group (privacy mode is on). Make it admin, or BotFather → `/setprivacy` → Disable, then remove and re-add the bot |
| No task after 2–3 minutes | Is the group enabled? Was the message sent **after** enabling? Look for the `analysis …` line. A chat that keeps getting messages waits up to 5 minutes. |
| A new group doesn't appear | Write any message in it. Telegram only reports a group to the bot when something happens there |
| Photo not read | The photo is still downloading (the AI waits up to 2 minutes), or the file is over 20 MB (Telegram's limit for bots) |
| Wrong truck or department | Map the group in **Groups** (kind = truck / dispatch / department, default truck or department) and use truck numbers 101–130 (the demo fleet) |

---

## Part 8 — Make it reachable from outside (optional)

```powershell
winget install --id Cloudflare.cloudflared
```

Then run STOP.bat and START.bat. The window prints a public `https://….trycloudflare.com` address, also saved in `deploy\PUBLIC_URL.txt`. This PC must stay on, and the address changes on every restart.

---

## Results sheet

| Part | Passed | Notes |
|---|---|---|
| 1 Health check | ☐ | |
| 2 AI tests (2.1–2.11) | ☐ | |
| 3 Done detection & verification | ☐ | |
| 4 Dashboard & permissions | ☐ | |
| 5 Telegram notifications | ☐ | |
| 6 Automated tests | ☐ | |

If anything fails, note the test number, the exact message you sent and the time. With that I can find it in the logs.
