# How to test Smart Truck: a step-by-step guide

This guide checks that the whole system works: the Telegram bot, the AI, the website, permissions and notifications. Plan on about 45 minutes for everything, or 10 minutes for Parts 0–2 only.

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

> **The website has three pages** (top bar):
> - **Muammolar** (Issues): four tabs **Yangi** (new) · **Ishda** (in work) · **Tekshiruvda** (checking) · **Bajarildi** (done). Click an issue to open it; big buttons show what you can do now.
> - **Xabarlar** (Messages): messages nobody has answered yet. The red number in the top bar is how many.
> - **Sozlamalar** (Settings, owner and admin only): Telegram groups on/off, and which Telegram people are staff.
>
> Advanced screens (review queue, charts, board, search, shifts, Gmail / TMS setup) were removed from the website for now. The backend still has them.
>
> **The timing rule.** The AI doesn't answer each message on the spot. It waits until a chat has been **quiet for 90 seconds**, then reads the whole conversation at once (at most 5 minutes later, if the chat stays busy). New issues appear about **1.5–2 minutes** after your last message. The site refreshes by itself; you can also press F5.
>
> **Messages sent before a group was approved are not stored** (that's deliberate). Only test with messages sent now.

---

## Part 1 — Quick health check (5 min)

| # | Do this | You should see | ✅ |
|---|---|---|---|
| 1.1 | Open the site → **Sozlamalar** (Settings) | "Dispatch Team" and "Department Group" are both **Yoqilgan** (On) | ☐ |
| 1.2 | In **Dispatch Team**, send `/help` | Within a few seconds the bot replies with a 3-line message (Uzbek / Russian / English). This proves the bot is receiving messages. | ☐ |
| 1.3 | Send `/task Test: 120 mashinaga moy almashtirish kerak` | The bot replies **"✅ T-… yaratildi…"** in 3 languages | ☐ |
| 1.4 | **Muammolar** → **Yangi** tab | The task from 1.3 is in the list, and the Yangi count went up by 1 | ☐ |

If 1.2 gets no reply, go to Part 7 (troubleshooting) before continuing.

---

## Part 2 — AI tests in Telegram (15 min)

Send each message in **Dispatch Team**, preferably from a second account. Wait about 2 minutes, then look at **Muammolar → Yangi**. Open the issue to see the details and the original message.

| # | Message to send | Expected result | ✅ |
|---|---|---|---|
| 2.1 Uzbek | `Aka, 125 mashinada ELD ishlamayapti, inspection oldidaman` | New issue, truck **#125**, department **ELD**; may carry the red **Shoshilinch** (urgent) tag | ☐ |
| 2.2 Russian | `Трак 118: скиньте POD по грузу 88231, брокер ждёт до вечера` | Department **Accounting**, truck **#118**, load **88231** | ☐ |
| 2.3 English | `Truck 112 blew a tire on I-40 near Amarillo, needs road service ASAP` | Red **Shoshilinch** (urgent) tag, department **Fleet**, truck **#112** | ☐ |
| 2.4 Not a task | `Salom hammaga 👋` then `rahmat aka` | **No new issue** | ☐ |
| 2.5 Two in one | `Aka 2 ta ish: 107 ning yoqilg'i kartasi ishlamayapti, 109 ga PM vaqti keldi` | **Two** separate tasks (fuel card → Accounting, PM → Fleet) | ☐ |
| 2.6 Photo | Send a photo of any receipt, BOL or invoice (even a handwritten note like "Lumper $150, load 77123, truck 104") with the caption `lumper puli o'zimdan to'ladim` | The issue text mentions the **amount and numbers read from the photo**. | ☐ |
| 2.7 Duplicate | After 2.1 has a task, send `125 ELD hali ham ishlamayapti` | **No second issue.** The AI adds the message to the existing 125 ELD issue | ☐ |
| 2.8 Languages | Switch the language at the top (Oʻzbekcha / Русский / English) | All words change, and AI issue titles change language too | ☐ |
| 2.9 Edit | Edit a message you sent (e.g. change the truck number) | After about 2 minutes the AI re-reads it | ☐ |
| 2.10 Voice | Send a voice message | No issue is made from the voice itself. Known limitation: voice is not transcribed yet (no speech-to-text vendor chosen) | ☐ |
| 2.11 Reply + /task | Reply to any message with just `/task` | A task is created from the message you replied to | ☐ |

---

## Part 3 — "Done" detection and verification (10 min)

This checks that the AI can't close tasks on its own and that a second person must confirm.

| # | Do this | Expected | ✅ |
|---|---|---|---|
| 3.1 | **Muammolar → Yangi** → open the **125 ELD** issue from 2.1 → choose **Javlon ELD Agent** → **Topshirish** (Give the task) | It moves to the **Ishda** (in work) tab | ☐ |
| 3.2 | In Telegram (Dispatch Team), send `ELD ni to'g'irladim, endi ishlayapti` | About 2 minutes later the issue moves to **Tekshiruvda** (checking), **not** to Bajarildi (done) | ☐ |
| 3.3 | Log out, log in as `eld.agent@…`, open the issue | There is **no** "Bajarildi deb tasdiqlash" (Confirm done) button: someone else must confirm your own work | ☐ |
| 3.4 | Log in as `eld.lead@…` → open the issue → **Bajarildi deb tasdiqlash** | It moves to the **Bajarildi** (done) tab | ☐ |
| 3.5 | Repeat 3.1–3.2 with another issue, then as `eld.lead@…` press **Qaytarish** (Send back) | It goes back to **Ishda** (in work) | ☐ |

---

## Part 4 — Website and permissions (10 min)

| # | Do this | Expected | ✅ |
|---|---|---|---|
| 4.1 | Open a test issue in **Yangi** → **Muammo emas** (Not an issue) | It disappears from the list | ☐ |
| 4.2 | **Muammolar → Ishda** → tick **Faqat meniki** (Only mine) | Only issues given to you are listed | ☐ |
| 4.3 | Log in as `eld.agent@…` | Sees **only ELD** issues plus their own; no **Sozlamalar** (Settings) link | ☐ |
| 4.4 | Log in as `viewer@…` | Can see everything, **no action buttons** | ☐ |
| 4.5 | Log in as `manager@…` | No **Sozlamalar** link: only the owner and admins turn groups on or off | ☐ |
| 4.6 | A **P1** issue that you leave alone for over 1 hour | It gets the red **Kechikdi** (Late) tag; the department lead / manager is told in Telegram (if their Telegram is connected) | ☐ |
| 4.7 Phone (optional) | On a phone on the **same Wi-Fi**, open `http://<this PC's IP>:3000`. The "Network" line in `deploy\logs\web.log` shows it, e.g. `http://192.168.1.4:3000`. Windows may ask to allow Node.js through the firewall. | The phone layout: the three links sit in a row under the top bar | ☐ |

---

## Part 5 — Work on tasks from Telegram (10 min)

Staff don't need the website: the bot sends them their tasks with buttons. Test it with two people, e.g. you as the **ELD agent** and a colleague as the **ELD lead**, each linking their own Telegram.

1. Log in as `eld.agent@…` → on **Muammolar**, in the blue box, press **Telegramni ulash** (Connect Telegram) → **Botni oching** (Open the bot) → in Telegram press **Start**. The bot answers **"✅ … hisobiga ulandi"** (linked). ☐
2. Do the same for `eld.lead@…` with the second Telegram account. ☐
3. As the lead, assign a new ELD task to **Javlon ELD Agent**. Within about 15 seconds the agent gets a private message from the bot with buttons **▶ Boshlash · ✓ Bajardim · ⏸ Muammo bor**. ☐
4. Agent taps **▶ Boshlash**. The message updates to "🔧 Ishda", and the site shows the issue under **Ishda**. ☐
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
.venv\Scripts\python -m pytest -q          # expected: 142 passed
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
| Bot doesn't answer `/help` | The system is stopped, or the group isn't turned on (**Sozlamalar** page). Check `api.err.log` for `Polling as @truckdipatchbot`. |
| Bot answers commands but the AI never sees normal messages | The bot isn't an **admin** in that group (privacy mode is on). Make it admin, or BotFather → `/setprivacy` → Disable, then remove and re-add the bot |
| No task after 2–3 minutes | Is the group enabled? Was the message sent **after** enabling? Look for the `analysis …` line. A chat that keeps getting messages waits up to 5 minutes. |
| A new group doesn't appear | Write any message in it. Telegram only reports a group to the bot when something happens there |
| Photo not read | The photo is still downloading (the AI waits up to 2 minutes), or the file is over 20 MB (Telegram's limit for bots) |
| Wrong truck or department | Write the truck number in the message and use truck numbers 101–130 (the demo fleet). New groups are mapped from their title (e.g. "Truck 125", "ELD") when the bot first sees them; the screen to change that mapping is not on the simple site for now |

---

## Part 8 — Make it reachable from outside (optional)

```powershell
winget install --id Cloudflare.cloudflared
```

Then run STOP.bat and START.bat. The window prints a public `https://….trycloudflare.com` address, also saved in `deploy\PUBLIC_URL.txt`. This PC must stay on, and the address changes on every restart.

---

## Part 9 — 5-minute reply timer and Messages (10 min)

Log in as `owner@…`. Use two Telegram accounts: a "driver" and a "staff" account. Mark the staff account first: **Sozlamalar → Telegramdagi xodimlar** → tick it (it appears there after it has written once).

| # | Do this | Expected | ✅ |
|---|---|---|---|
| 9.1 | As the driver, write in **Dispatch Team**: `Load 78432 da 2 soatdan beri kutyapman` | Within seconds, **Xabarlar** (Messages) shows it as "1 daqiqa kutyapti" (waiting 1 minute), and the red number in the top bar goes up | ☐ |
| 9.2 | Wait 3 minutes | The on-duty / department staff get a reminder in Telegram (if connected) | ☐ |
| 9.3 | Wait until past 5 minutes | The card turns **red**; the supervisor is told in Telegram (if connected) | ☐ |
| 9.4 | Reply from the **staff** account (reply to the driver's message) | It disappears from **Xabarlar** within about 15 seconds | ☐ |
| 9.5 | As the driver, write `rahmat aka 👍` | Nothing new in **Xabarlar**: thanks and acknowledgements need no reply | ☐ |
| 9.6 | As the driver, write `Avariya bo'ldi, politsiya keldi` | **Immediate** alert to the supervisor and managers; the card in **Xabarlar** is red at once | ☐ |
| 9.7 | **Xabarlar** → a waiting message → **Javob kerak emas** (No reply needed) | It disappears; the audit log records who did it | ☐ |
| 9.8 | Top bar → company picker → another company | Issues and messages switch to that company | ☐ |

Shifts and handovers, TMS load import and connecting Gmail are not on the simple website for now. The backend still supports them, and their screens can come back when needed.

## Results sheet

| Part | Passed | Notes |
|---|---|---|
| 1 Health check | ☐ | |
| 2 AI tests (2.1–2.11) | ☐ | |
| 3 Done detection & verification | ☐ | |
| 4 Website & permissions | ☐ | |
| 5 Telegram notifications | ☐ | |
| 6 Automated tests | ☐ | |
| 9 Reply timer & Messages | ☐ | |

If anything fails, note the test number, the exact message you sent and the time. With that I can find it in the logs.
