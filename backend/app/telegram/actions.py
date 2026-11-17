"""Work on tasks straight from Telegram: inline buttons under the bot's private messages
(▶ Start · ✓ I'm done · ⏸ I'm stuck · ✓ Confirm · ↩ Send back) and the /mytasks command.

Every tap goes through the same state machine and permission checks as the dashboard; the
Telegram account must be linked to a portal user (profile → Connect Telegram)."""

import logging
import re
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.rbac import Actor, Perm, can_manage_task
from app.domain.enums import OPEN_STATUSES, TaskStatus
from app.domain.task_state import TransitionError
from app.i18n import STUCK_REASONS, button_label, norm_lang, stage_label, t, task_title
from app.models import Company, Task, TelegramUser, Truck, User
from app.services.tasks import allowed_transitions, company_four_eyes, transition_task

log = logging.getLogger(__name__)

S = TaskStatus
STATUS_LINE = "▸ "  # prefix of the status line we append to a message after a tap
_CALLBACK = re.compile(r"^t:(\d+):([a-z]+)(\d?)$")


# --------------------------------------------------------------------------- keyboards


def _btn(text: str, data: str) -> dict:
    return {"text": text, "callback_data": data}


def keyboard_for(task: Task, actor: Actor, lang: str | None, *, four_eyes: bool = True) -> dict | None:
    """Buttons this user may press for this task right now (None when there is nothing to do)."""
    allowed = set(allowed_transitions(task, actor, four_eyes))
    status = S(task.status)
    n = task.number
    row: list[dict] = []
    if status == S.ASSIGNED and "in_progress" in allowed:
        row.append(_btn(button_label("start", lang), f"t:{n}:start"))
    if status in (S.ASSIGNED, S.IN_PROGRESS) and "pending_verification" in allowed:
        row.append(_btn(button_label("done", lang), f"t:{n}:done"))
    if status == S.BLOCKED and "in_progress" in allowed:
        row.append(_btn(button_label("resume", lang), f"t:{n}:resume"))
    if status == S.PENDING_VERIFICATION:
        if "completed" in allowed:
            row.append(_btn(button_label("confirm", lang), f"t:{n}:confirm"))
        if "in_progress" in allowed:
            row.append(_btn(button_label("back", lang), f"t:{n}:back"))
    rows = [row] if row else []
    if status in (S.ASSIGNED, S.IN_PROGRESS) and "blocked" in allowed:
        rows.append([_btn(button_label("stuck", lang), f"t:{n}:stuck")])
    url = get_settings().dashboard_url.rstrip("/")
    if url.startswith("https://"):  # Telegram rejects non-public URLs in buttons
        rows.append([{"text": button_label("open", lang), "url": f"{url}/tasks/{task.id}"}])
    return {"inline_keyboard": rows} if rows else None


def _reason_keyboard(task: Task, lang: str | None) -> dict:
    lg = norm_lang(lang)
    rows = [[_btn(r[lg], f"t:{task.number}:stuck{key}")] for key, r in STUCK_REASONS.items()]
    rows.append([_btn(button_label("cancel", lang), f"t:{task.number}:keep")])
    return {"inline_keyboard": rows}


# --------------------------------------------------------------------------- lookups


async def linked_user(session: AsyncSession, tg_user_id: int) -> User | None:
    tg_ids = list(
        (await session.scalars(select(TelegramUser.id).where(TelegramUser.tg_user_id == tg_user_id))).all()
    )
    if not tg_ids:
        return None
    return await session.scalar(
        select(User).where(User.telegram_user_id.in_(tg_ids), User.is_active.is_(True)).limit(1)
    )


async def describe_task(session: AsyncSession, task: Task, lang: str | None) -> str:
    company = await session.get(Company, task.company_id)
    truck = await session.get(Truck, task.truck_id) if task.truck_id else None
    due = "—"
    if task.due_at is not None:
        tz = ZoneInfo(company.timezone if company else "UTC")
        due = task.due_at.astimezone(tz).strftime("%d.%m %H:%M")
    return t(
        "bot.task_line",
        lang,
        code=task.code,
        stage=stage_label(task.status, lang),
        title=task_title(task, lang),
        truck=truck.unit_number if truck else (task.truck_unit_raw or "—"),
        due=due,
    )


# --------------------------------------------------------------------------- callback handling


@dataclass
class TelegramCalls:
    """Bot API calls to make after the DB commit: (method, params)."""

    calls: list[tuple[str, dict]] = field(default_factory=list)

    def add(self, method: str, **params) -> None:
        self.calls.append((method, params))


def _with_status_line(text: str, line: str) -> str:
    kept = [ln for ln in (text or "").splitlines() if not ln.startswith(STATUS_LINE)]
    while kept and not kept[-1].strip():
        kept.pop()
    return "\n".join(kept) + f"\n\n{STATUS_LINE}{line}"


async def handle_callback(session: AsyncSession, cq: dict) -> TelegramCalls:
    out = TelegramCalls()
    frm = cq.get("from") or {}
    lang = norm_lang(frm.get("language_code"))
    msg = cq.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    message_id = msg.get("message_id")

    def answer(text: str, alert: bool = False) -> None:
        out.add("answerCallbackQuery", callback_query_id=cq["id"], text=text[:200], show_alert=alert)

    match = _CALLBACK.match(cq.get("data") or "")
    if not match:
        answer("?")
        return out
    number, action, variant = int(match.group(1)), match.group(2), match.group(3)

    user = await linked_user(session, frm.get("id", 0))
    if user is None:
        answer(t("bot.not_linked", lang), alert=True)
        return out
    lang = user.language or lang
    actor = Actor.for_user(user)
    task = await session.scalar(select(Task).where(Task.company_id == user.company_id, Task.number == number))
    if task is None:
        answer(t("bot.action_denied", lang), alert=True)
        return out
    four_eyes = await company_four_eyes(session, task.company_id)

    # Two-step "I'm stuck": first show the reasons, then apply the chosen one.
    if action == "stuck" and not variant:
        if "blocked" not in allowed_transitions(task, actor, four_eyes):
            answer(t("bot.action_denied", lang), alert=True)
            return out
        answer(t("bot.pick_reason", lang))
        out.add("editMessageReplyMarkup", chat_id=chat_id, message_id=message_id, reply_markup=_reason_keyboard(task, lang))
        return out
    if action == "keep":
        answer("👌")
        out.add("editMessageReplyMarkup", chat_id=chat_id, message_id=message_id,
                reply_markup=keyboard_for(task, actor, lang, four_eyes=four_eyes) or {"inline_keyboard": []})
        return out

    targets = {
        "start": (S.IN_PROGRESS, None),
        "done": (S.PENDING_VERIFICATION, None),
        "resume": (S.IN_PROGRESS, None),
        "confirm": (S.COMPLETED, None),
        "back": (S.IN_PROGRESS, t("bot.sent_back_reason", lang)),
        "stuck": (S.BLOCKED, (STUCK_REASONS.get(variant) or {}).get(norm_lang(lang))),
    }
    if action not in targets or (action == "stuck" and variant not in STUCK_REASONS):
        answer("?")
        return out
    target, reason = targets[action]
    # The same target can be reached from different states; only act from the state the button was for.
    expected_from = {
        "start": {S.ASSIGNED},
        "done": {S.ASSIGNED, S.IN_PROGRESS},
        "resume": {S.BLOCKED},
        "confirm": {S.PENDING_VERIFICATION},
        "back": {S.PENDING_VERIFICATION},
        "stuck": {S.ASSIGNED, S.IN_PROGRESS},
    }[action]
    try:
        if S(task.status) not in expected_from:
            raise TransitionError("stale", "task changed")
        await transition_task(session, task, target, actor, reason=reason, data={"via": "telegram"})
    except TransitionError:
        answer(t("bot.action_denied", lang), alert=True)
        markup = keyboard_for(task, actor, lang, four_eyes=four_eyes) or {"inline_keyboard": []}
        if msg.get("text"):
            out.add("editMessageText", chat_id=chat_id, message_id=message_id,
                    text=_with_status_line(msg["text"], stage_label(task.status, lang)), reply_markup=markup)
        return out

    stage = stage_label(task.status, lang)
    answer(t("bot.action_ok", lang, code=task.code, stage=stage))
    markup = keyboard_for(task, actor, lang, four_eyes=four_eyes) or {"inline_keyboard": []}
    line = stage + (f" — {reason}" if reason and action == "stuck" else "") + f" · {user.full_name}"
    if msg.get("text"):
        out.add("editMessageText", chat_id=chat_id, message_id=message_id,
                text=_with_status_line(msg["text"], line), reply_markup=markup)
    return out


# --------------------------------------------------------------------------- /mytasks

MAX_LISTED = 8


async def my_tasks(session: AsyncSession, frm: dict, chat_id: int) -> TelegramCalls:
    """Open tasks assigned to me, plus (for leads) finished work waiting for my confirmation."""
    out = TelegramCalls()
    lang = norm_lang(frm.get("language_code"))
    user = await linked_user(session, frm.get("id", 0))
    if user is None:
        out.add("sendMessage", chat_id=chat_id, text=t("bot.not_linked", lang))
        return out
    lang = user.language or lang
    actor = Actor.for_user(user)
    four_eyes = await company_four_eyes(session, user.company_id)

    mine = Task.assignee_id == user.id
    conds = [mine]
    if actor.has(Perm.TASKS_VERIFY):
        conds.append(Task.status == S.PENDING_VERIFICATION)
    rows = (
        await session.scalars(
            select(Task)
            .where(Task.company_id == user.company_id, Task.status.in_(list(OPEN_STATUSES)), or_(*conds))
            .order_by(Task.priority, Task.due_at.asc().nulls_last())
        )
    ).all()
    tasks = [
        tk for tk in rows
        if tk.assignee_id == user.id or (S(tk.status) == S.PENDING_VERIFICATION and can_manage_task(actor, tk))
    ]
    tasks = [tk for tk in tasks if S(tk.status) not in (S.DETECTED, S.NEEDS_REVIEW) or tk.assignee_id == user.id]
    if not tasks:
        out.add("sendMessage", chat_id=chat_id, text=t("bot.no_tasks", lang))
        return out
    out.add("sendMessage", chat_id=chat_id, text=t("bot.my_tasks_header", lang, n=len(tasks)))
    for task in tasks[:MAX_LISTED]:
        params = {"chat_id": chat_id, "text": await describe_task(session, task, lang)}
        markup = keyboard_for(task, actor, lang, four_eyes=four_eyes)
        if markup:
            params["reply_markup"] = markup
        out.add("sendMessage", **params)
    if len(tasks) > MAX_LISTED:
        out.add("sendMessage", chat_id=chat_id, text=t("bot.more_tasks", lang, n=len(tasks) - MAX_LISTED))
    return out
