"""Server-side texts in Uzbek (Latin), Russian and English: notifications and bot messages.
The dashboard has its own dictionaries (frontend/lib/i18n)."""

from typing import Any

LANGS = ("uz", "ru", "en")
DEFAULT_LANG = "uz"

STATUS = {
    "detected": {"uz": "aniqlandi", "ru": "обнаружена", "en": "detected"},
    "needs_review": {"uz": "ko‘rib chiqish kerak", "ru": "на проверке", "en": "needs review"},
    "assigned": {"uz": "biriktirilgan", "ru": "назначена", "en": "assigned"},
    "in_progress": {"uz": "bajarilmoqda", "ru": "в работе", "en": "in progress"},
    "blocked": {"uz": "to‘xtab qolgan", "ru": "заблокирована", "en": "blocked"},
    "pending_verification": {"uz": "tasdiqlash kutilmoqda", "ru": "ждёт подтверждения", "en": "pending verification"},
    "completed": {"uz": "bajarildi", "ru": "выполнена", "en": "completed"},
    "cancelled": {"uz": "bekor qilindi", "ru": "отменена", "en": "cancelled"},
}

# Plain 4-stage vocabulary for non-technical staff (simple mode + Telegram buttons).
STAGE = {
    "new": {"uz": "🆕 Yangi", "ru": "🆕 Новая", "en": "🆕 New"},
    "doing": {"uz": "🔧 Ishda", "ru": "🔧 В работе", "en": "🔧 In work"},
    "waiting": {"uz": "⏸ To‘xtab qoldi", "ru": "⏸ Ждёт", "en": "⏸ Waiting"},
    "check": {"uz": "🔍 Tekshiruvda", "ru": "🔍 На проверке", "en": "🔍 Checking"},
    "done": {"uz": "✅ Bajarildi", "ru": "✅ Готово", "en": "✅ Done"},
    "cancelled": {"uz": "✖ Bekor qilindi", "ru": "✖ Отменена", "en": "✖ Cancelled"},
}

BUTTON = {
    "start": {"uz": "▶ Boshlash", "ru": "▶ Начать", "en": "▶ Start"},
    "done": {"uz": "✓ Bajardim", "ru": "✓ Сделал", "en": "✓ I'm done"},
    "stuck": {"uz": "⏸ Muammo bor", "ru": "⏸ Есть проблема", "en": "⏸ I'm stuck"},
    "resume": {"uz": "▶ Davom ettirish", "ru": "▶ Продолжить", "en": "▶ Continue"},
    "confirm": {"uz": "✓ Tasdiqlash", "ru": "✓ Подтвердить", "en": "✓ Confirm"},
    "back": {"uz": "↩ Qaytarish", "ru": "↩ Вернуть", "en": "↩ Send back"},
    "cancel": {"uz": "✖ Bekor", "ru": "✖ Отмена", "en": "✖ Cancel"},
    "open": {"uz": "🔗 Ochish", "ru": "🔗 Открыть", "en": "🔗 Open"},
}

# Preset reasons for "I'm stuck" — one tap instead of typing.
STUCK_REASONS = {
    "1": {"uz": "Ehtiyot qism kutilmoqda", "ru": "Жду запчасть", "en": "Waiting for a part"},
    "2": {"uz": "Haydovchidan javob kutilmoqda", "ru": "Жду ответа водителя", "en": "Waiting for the driver"},
    "3": {"uz": "Pul yoki ruxsat kutilmoqda", "ru": "Жду оплату или разрешение", "en": "Waiting for payment or approval"},
}

MESSAGES: dict[str, dict[str, str]] = {
    # --- notifications (title / body) ---------------------------------------------
    "n.assigned.title": {
        "uz": "{code} sizga biriktirildi: {title}",
        "ru": "{code} назначена вам: {title}",
        "en": "{code} assigned to you: {title}",
    },
    "n.assigned.body": {
        "uz": "Muhimlik {priority}, muddat {due}",
        "ru": "Приоритет {priority}, срок {due}",
        "en": "Priority {priority}, due {due}",
    },
    "n.p1.title": {"uz": "Shoshilinch {code}: {title}", "ru": "Срочно {code}: {title}", "en": "P1 {code}: {title}"},
    "n.verification.title": {
        "uz": "{code} tasdiqlashga tayyor: {title}",
        "ru": "{code} готова к проверке: {title}",
        "en": "{code} ready for verification: {title}",
    },
    "n.reminder.title": {
        "uz": "Eslatma: {code} muddati {due}",
        "ru": "Напоминание: срок {code} — {due}",
        "en": "Reminder: {code} is due {due}",
    },
    "n.overdue.title": {
        "uz": "Muddati o‘tdi: {code} {title}",
        "ru": "Просрочено: {code} {title}",
        "en": "Overdue: {code} {title}",
    },
    "n.overdue.body": {
        "uz": "Muhimlik {priority}, holati: {status}",
        "ru": "Приоритет {priority}, статус: {status}",
        "en": "Priority {priority}, status: {status}",
    },
    "n.escalated.title": {
        "uz": "Eskalatsiya: {code} muddatidan ancha o‘tib ketdi",
        "ru": "Эскалация: {code} сильно просрочена",
        "en": "Escalated: {code} is far past due",
    },
    "n.open_link": {"uz": "Ochish", "ru": "Открыть", "en": "Open"},
    # --- 5-minute response SLA (blueprint sec. 7) ---------------------------------------
    "n.resp.reminder": {
        "uz": "⏰ 3 daqiqadan beri javob yo‘q — {channel}: {sender} «{preview}»",
        "ru": "⏰ 3 минуты без ответа — {channel}: {sender} «{preview}»",
        "en": "⏰ No reply for 3 min — {channel}: {sender} “{preview}”",
    },
    "n.resp.overdue": {
        "uz": "🔴 5 daqiqadan beri javob yo‘q — {channel}: {sender} «{preview}»",
        "ru": "🔴 5 минут без ответа — {channel}: {sender} «{preview}»",
        "en": "🔴 No reply for 5 min — {channel}: {sender} “{preview}”",
    },
    "n.resp.escalated": {
        "uz": "🚨 10 daqiqadan beri javob yo‘q — {channel}: {sender} «{preview}»",
        "ru": "🚨 10 минут без ответа — {channel}: {sender} «{preview}»",
        "en": "🚨 No reply for 10 min — {channel}: {sender} “{preview}”",
    },
    "n.resp.critical": {
        "uz": "🚨 Xavfsizlik bo‘yicha shoshilinch xabar — {channel}: {sender} «{preview}»",
        "ru": "🚨 Срочное сообщение по безопасности — {channel}: {sender} «{preview}»",
        "en": "🚨 Safety-critical message — {channel}: {sender} “{preview}”",
    },
    "n.task.escalated": {
        "uz": "⬆ {code} eskalatsiya qilindi: {title}",
        "ru": "⬆ {code} эскалирована: {title}",
        "en": "⬆ {code} escalated: {title}",
    },
    "n.handover": {
        "uz": "{name} sizga smenani topshirmoqda: {n} ta murojaat. Qabul qiling.",
        "ru": "{name} передаёт вам смену: заявок — {n}. Примите передачу.",
        "en": "{name} is handing over their shift to you: {n} issues. Please accept.",
    },
    "n.handover_unanswered": {
        "uz": "⚠ Smena topshiruvi 15 daqiqadan beri qabul qilinmadi: {from_name} → {to_name}",
        "ru": "⚠ Передача смены не принята 15 минут: {from_name} → {to_name}",
        "en": "⚠ Shift handover not accepted for 15 min: {from_name} → {to_name}",
    },
    "n.coverage_gap": {
        "uz": "⚠ {dept}: hozir hech kim navbatchilikda emas",
        "ru": "⚠ {dept}: сейчас никто не на смене",
        "en": "⚠ {dept}: nobody is on duty right now",
    },
    # --- bot: private chat ------------------------------------------------------------
    "bot.linked": {
        "uz": "✅ {name} hisobiga ulandi. Vazifa xabarnomalari shu yerga keladi.",
        "ru": "✅ Привязано к аккаунту {name}. Уведомления о задачах будут приходить сюда.",
        "en": "✅ Linked to {name}. Task notifications will arrive here.",
    },
    "bot.hello": {
        "uz": "Salom! Xabarnomalarni olish uchun boshqaruv panelida: profil → «Telegramni ulash».",
        "ru": "Здравствуйте! Чтобы получать уведомления, откройте панель: профиль → «Подключить Telegram».",
        "en": "Hi! To receive task notifications, open the dashboard → profile → Connect Telegram.",
    },
    "bot.help_private": {
        "uz": "Men vazifalaringizni shu yerga yuboraman. Tugmalar bilan ishlang:\n"
              "▶ Boshlash → ✓ Bajardim → rahbar tasdiqlaydi.\n/mytasks — mening vazifalarim",
        "ru": "Я присылаю сюда ваши задачи. Работайте кнопками:\n"
              "▶ Начать → ✓ Сделал → руководитель подтверждает.\n/mytasks — мои задачи",
        "en": "I send your tasks here. Use the buttons:\n"
              "▶ Start → ✓ I'm done → your lead confirms.\n/mytasks — my tasks",
    },
    "bot.not_linked": {
        "uz": "Avval hisobingizni ulang: boshqaruv paneli → profil → «Telegramni ulash».",
        "ru": "Сначала привяжите аккаунт: панель → профиль → «Подключить Telegram».",
        "en": "Link your account first: dashboard → profile → Connect Telegram.",
    },
    "bot.no_tasks": {
        "uz": "Sizda ochiq vazifa yo‘q. 👍",
        "ru": "У вас нет открытых задач. 👍",
        "en": "You have no open tasks. 👍",
    },
    "bot.my_tasks_header": {
        "uz": "Sizning vazifalaringiz ({n}):",
        "ru": "Ваши задачи ({n}):",
        "en": "Your tasks ({n}):",
    },
    "bot.more_tasks": {
        "uz": "…va yana {n} ta. Hammasini boshqaruv panelida ko‘ring.",
        "ru": "…и ещё {n}. Все — в панели управления.",
        "en": "…and {n} more. See them all in the dashboard.",
    },
    "bot.action_ok": {"uz": "{code}: {stage}", "ru": "{code}: {stage}", "en": "{code}: {stage}"},
    "bot.action_denied": {
        "uz": "Bu amalni bajara olmaysiz (vazifa o‘zgargan bo‘lishi mumkin).",
        "ru": "Это действие недоступно (задача могла измениться).",
        "en": "You can't do this (the task may have changed).",
    },
    "bot.pick_reason": {"uz": "Sababini tanlang:", "ru": "Выберите причину:", "en": "Pick a reason:"},
    "bot.sent_back_reason": {
        "uz": "Telegram orqali qaytarildi",
        "ru": "Возвращено через Telegram",
        "en": "Sent back from Telegram",
    },
    "bot.task_line": {
        "uz": "{code} · {stage}\n{title}\n🚚 {truck} · ⏰ {due}",
        "ru": "{code} · {stage}\n{title}\n🚚 {truck} · ⏰ {due}",
        "en": "{code} · {stage}\n{title}\n🚚 {truck} · ⏰ {due}",
    },
}


def stage_of(status: str) -> str:
    return {
        "detected": "new",
        "needs_review": "new",
        "assigned": "doing",
        "in_progress": "doing",
        "blocked": "waiting",
        "pending_verification": "check",
        "completed": "done",
        "cancelled": "cancelled",
    }.get(status, "new")


def stage_label(status: str, lang: str | None) -> str:
    return STAGE[stage_of(status)][norm_lang(lang)]


def button_label(key: str, lang: str | None) -> str:
    return BUTTON[key][norm_lang(lang)]

# Group posts are read by drivers and staff with different languages: one line per language.
GROUP_TEXTS: dict[str, list[str]] = {
    "task_ack": [
        "✅ {code} yaratildi va ko‘rib chiqishga yuborildi.",
        "✅ {code} создана и отправлена на проверку.",
        "✅ {code} created and sent for review.",
    ],
    "task_usage": [
        "Foydalanish: /task <nima qilish kerak> — yoki xabarga /task deb javob bering.",
        "Использование: /task <что нужно сделать> — или ответьте на сообщение командой /task.",
        "Usage: /task <what needs to be done> — or reply to a message with /task.",
    ],
    "group_pending": [
        "👋 Smart Truck bot guruhga qo‘shildi. Administrator guruhni boshqaruv panelida tasdiqlagach, ish xabarlari vazifalarga aylantiriladi.",
        "👋 Бот Smart Truck добавлен в группу. Когда администратор подтвердит группу в панели, рабочие сообщения начнут превращаться в задачи.",
        "👋 Smart Truck bot was added. Once an admin approves this group in the dashboard, work messages will be turned into tasks.",
    ],
    "group_enabled": [
        "✅ Guruh ulandi. Bu guruhdagi ish xabarlari (matn, ovoz, hujjat) AI yordamida vazifalarga aylantiriladi va boshqaruv panelida kuzatiladi. Qo‘lda vazifa: /task <matn>",
        "✅ Группа подключена. Рабочие сообщения (текст, голос, документы) с помощью AI превращаются в задачи и отслеживаются в панели. Вручную: /task <текст>",
        "✅ Group connected. Work messages here (text, voice, documents) are turned into tasks by AI and tracked in the dashboard. Manual task: /task <text>",
    ],
}

BOT_COMMANDS: dict[str, list[tuple[str, str]]] = {
    "en": [("task", "Create a task (or reply to a message)"), ("help", "How this bot works")],
    "uz": [("task", "Vazifa yaratish (yoki xabarga javob)"), ("help", "Bot qanday ishlaydi")],
    "ru": [("task", "Создать задачу (или ответом на сообщение)"), ("help", "Как работает бот")],
}

# Private chat with the bot: personal commands.
BOT_PRIVATE_COMMANDS: dict[str, list[tuple[str, str]]] = {
    "en": [("mytasks", "My tasks"), ("help", "How it works")],
    "uz": [("mytasks", "Mening vazifalarim"), ("help", "Qanday ishlaydi")],
    "ru": [("mytasks", "Мои задачи"), ("help", "Как это работает")],
}


def norm_lang(code: str | None) -> str:
    code = (code or "").lower()
    if code.startswith("uz"):
        return "uz"
    if code.startswith("ru"):
        return "ru"
    if code.startswith("en"):
        return "en"
    return DEFAULT_LANG


def t(key: str, lang: str | None, **params: Any) -> str:
    entry = MESSAGES[key]
    template = entry.get(norm_lang(lang)) or entry["en"]
    return template.format(**params)


def group_text(key: str, **params: Any) -> str:
    return "\n".join(line.format(**params) for line in GROUP_TEXTS[key])


def status_label(status: str, lang: str | None) -> str:
    return STATUS.get(status, {}).get(norm_lang(lang), status)


def task_title(task, lang: str | None) -> str:
    localized = ((task.i18n or {}).get(norm_lang(lang)) or {}).get("title")
    return localized or task.title
