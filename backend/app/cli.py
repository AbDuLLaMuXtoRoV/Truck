"""Developer / ops CLI.

    python -m app.cli init-db                 # create tables (dev; production uses `alembic upgrade head`)
    python -m app.cli reset-demo              # drop + create + seed demo data (refuses when ENV=prod)
    python -m app.cli create-admin --email a@b.com --password ... --company "Acme Trucking"
    python -m app.cli check-bot               # privacy mode + webhook status [A1]
    python -m app.cli set-webhook --url https://api.example.com/api/telegram/webhook
    python -m app.cli simulate --chat-id -1001 --text "Aka 125 ELD ishlamayapti" [--analyze]
    python -m app.cli analyze --group-id <uuid>   # run AI analysis now (ignores debounce)
"""

import argparse
import asyncio
import itertools
import secrets
import sys
import uuid
from datetime import timedelta

from sqlalchemy import select

from app.config import get_settings
from app.core.rbac import Actor
from app.core.security import hash_password
from app.db import get_engine, session_factory
from app.domain.enums import (
    AnalysisStatus,
    GroupKind,
    Priority,
    Role,
    TaskCategory,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
)
from app.models import (
    Base,
    Company,
    Department,
    Message,
    TelegramGroup,
    Truck,
    User,
    utcnow,
)

DEPARTMENTS = [
    ("ELD", "ELD Team"),
    ("DISPATCH", "Dispatch"),
    ("FLEET", "Fleet & Maintenance"),
    ("ACCOUNTING", "Accounting"),
    ("SAFETY", "Safety & Compliance"),
    ("TRAILER", "Trailers"),
    ("HR", "HR"),
]


async def init_db() -> None:
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables created.")


async def reset_demo(password: str = "demo12345") -> None:
    if get_settings().env == "prod":
        sys.exit("Refusing to reset data with ENV=prod")
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await seed_demo(password)


async def create_admin(email: str, password: str, company_name: str, timezone: str) -> None:
    async with session_factory()() as session:
        company = await session.scalar(select(Company).order_by(Company.created_at).limit(1))
        if company is None:
            company = Company(id=uuid.uuid4(), name=company_name, timezone=timezone, settings={"four_eyes": True})
            session.add(company)
            await session.flush()
            for code, name in DEPARTMENTS:
                session.add(Department(company_id=company.id, code=code, name=name))
        session.add(
            User(
                company_id=company.id,
                email=email.lower(),
                full_name="Administrator",
                password_hash=hash_password(password),
                role=Role.OWNER,
            )
        )
        await session.commit()
    print(f"Owner {email} created in company '{company.name}'.")


# --------------------------------------------------------------------------- demo seed

_msg_ids = itertools.count(1000)


async def _tg_message(session, group: TelegramGroup, tg_user, text: str, minutes_ago: int) -> Message:
    m = Message(
        id=uuid.uuid4(),
        company_id=group.company_id,
        group_id=group.id,
        tg_chat_id=group.tg_chat_id,
        tg_message_id=next(_msg_ids),
        sender_id=tg_user.id,
        sent_at=utcnow() - timedelta(minutes=minutes_ago),
        text=text,
        analysis_status=AnalysisStatus.DONE,
        analyzed_at=utcnow(),
        raw={},
    )
    session.add(m)
    await session.flush()
    return m


async def seed_demo(password: str = "demo12345") -> None:
    from app.services.ingest import upsert_telegram_user
    from app.services.tasks import add_comment, create_task, transition_task

    async with session_factory()() as session:
        company = Company(id=uuid.uuid4(), name="Demo Trucking LLC", timezone="America/Chicago", settings={"four_eyes": True})
        session.add(company)
        await session.flush()
        depts = {}
        for code, name in DEPARTMENTS:
            d = Department(id=uuid.uuid4(), company_id=company.id, code=code, name=name)
            session.add(d)
            depts[code] = d
        await session.flush()

        def user(email, name, role, dept=None):
            u = User(
                id=uuid.uuid4(),
                company_id=company.id,
                email=email,
                full_name=name,
                password_hash=hash_password(password),
                role=role,
                department_id=depts[dept].id if dept else None,
            )
            session.add(u)
            return u

        user("owner@demo-trucking.com", "Owner Demo", Role.OWNER)
        manager = user("manager@demo-trucking.com", "Malika Manager", Role.MANAGER)
        eld_lead = user("eld.lead@demo-trucking.com", "Eldor ELD Lead", Role.DEPT_LEAD, "ELD")
        eld_agent = user("eld.agent@demo-trucking.com", "Javlon ELD Agent", Role.AGENT, "ELD")
        acct_lead = user("acct.lead@demo-trucking.com", "Aziza Accounting Lead", Role.DEPT_LEAD, "ACCOUNTING")
        fleet_lead = user("fleet.lead@demo-trucking.com", "Farhod Fleet Lead", Role.DEPT_LEAD, "FLEET")
        dispatch_lead = user("dispatch.lead@demo-trucking.com", "Dilshod Dispatch Lead", Role.DEPT_LEAD, "DISPATCH")
        user("viewer@demo-trucking.com", "Viktor Viewer", Role.VIEWER)
        await session.flush()
        depts["ELD"].lead_user_id = eld_lead.id
        depts["ELD"].default_assignee_user_id = eld_agent.id
        depts["ACCOUNTING"].lead_user_id = acct_lead.id
        depts["FLEET"].lead_user_id = fleet_lead.id
        depts["DISPATCH"].lead_user_id = dispatch_lead.id

        trucks = {}
        for unit in range(101, 131):
            t = Truck(id=uuid.uuid4(), company_id=company.id, unit_number=str(unit))
            session.add(t)
            trucks[str(unit)] = t
        await session.flush()

        def group(chat_id, title, kind, truck=None, dept=None, enabled=True):
            g = TelegramGroup(
                id=uuid.uuid4(),
                company_id=company.id,
                tg_chat_id=chat_id,
                title=title,
                chat_type="supergroup",
                kind=kind,
                truck_id=trucks[truck].id if truck else None,
                department_id=depts[dept].id if dept else None,
                is_enabled=enabled,
                enabled_at=utcnow() if enabled else None,
                last_message_at=utcnow() - timedelta(minutes=5),
            )
            session.add(g)
            return g

        g125 = group(-1001000000125, "Truck 125 – Aziz (demo)", GroupKind.TRUCK, truck="125")
        g126 = group(-1001000000126, "Truck 126 – Bekzod (demo)", GroupKind.TRUCK, truck="126")
        g127 = group(-1001000000127, "Truck 127 – Sardor (demo)", GroupKind.TRUCK, truck="127")
        g_dispatch = group(-1001000000900, "Dispatch Team (demo)", GroupKind.DISPATCH, dept="DISPATCH")
        group(-1001000000901, "Accounting (demo)", GroupKind.DEPARTMENT, dept="ACCOUNTING")
        group(-1001000000999, "Truck 131 – new driver (demo)", GroupKind.OTHER, enabled=False)
        await session.flush()

        aziz = await upsert_telegram_user(session, company.id, {"id": 5001, "first_name": "Aziz", "username": "aziz_125"})
        bekzod = await upsert_telegram_user(session, company.id, {"id": 5002, "first_name": "Bekzod"})
        sardor = await upsert_telegram_user(session, company.id, {"id": 5003, "first_name": "Sardor"})
        disp = await upsert_telegram_user(session, company.id, {"id": 5004, "first_name": "Dilshod", "username": "dispatch_dilshod"})
        await session.flush()

        ai = Actor.ai(company.id)
        mgr = Actor.for_user(manager)

        # 1. Truck 125 — ELD not connecting (assigned, overdue) — the spec's own example.
        m1 = await _tg_message(session, g125, aziz, "Aka, ELD ishlamayapti. Ulanmayapti umuman", 190)
        t1 = await create_task(
            session, actor=ai, title="Fix ELD not connecting on truck 125",
            i18n={'uz': {'title': '125-mashinada ELD ulanmayotganini tuzatish', 'summary': 'Haydovchi ELD ishlamayotgani va umuman ulanmayotganini aytmoqda.'}, 'ru': {'title': 'Починить ELD на траке 125 — не подключается', 'summary': 'Водитель сообщает, что ELD не работает и не подключается.'}},
            description="Driver reports the ELD is not working and will not connect.",
            category=TaskCategory.ELD, priority=Priority.P2, department_id=depts["ELD"].id,
            truck_id=trucks["125"].id, source=TaskSource.AI, confidence=0.93, group_id=g125.id,
            source_message=m1, source_text=f"Aziz (@aziz_125): {m1.text}", status=TaskStatus.DETECTED,
            linked_messages=[(m1, TaskMessageRelation.SOURCE)],
            event_data={"why": "Driver reports equipment failure that blocks compliant driving."},
        )
        await transition_task(session, t1, TaskStatus.NEEDS_REVIEW, ai, data={"routing": "review"})
        await transition_task(session, t1, TaskStatus.ASSIGNED, Actor.for_user(eld_lead), assignee_id=eld_agent.id)
        t1.due_at = utcnow() - timedelta(minutes=40)
        t1.created_at = utcnow() - timedelta(minutes=190)

        # 2. Truck 126 — review $250 charge (in progress)
        m2 = await _tg_message(session, g126, bekzod, "Settlementda 250$ ushlab qolishibdi, nimaga? Tekshirib bering", 300)
        t2 = await create_task(
            session, actor=ai, title="Review $250 deduction on truck 126 settlement",
            i18n={'uz': {'title': '126-mashina settlementidagi $250 ushlanmani tekshirish', 'summary': 'Haydovchi settlementdan nega $250 ushlab qolinganini so‘ramoqda.'}, 'ru': {'title': 'Проверить удержание $250 в settlement трака 126', 'summary': 'Водитель спрашивает, почему из settlement удержали $250.'}},
            description="Driver asks why $250 was deducted from the settlement.",
            category=TaskCategory.ACCOUNTING, priority=Priority.P3, department_id=depts["ACCOUNTING"].id,
            truck_id=trucks["126"].id, source=TaskSource.AI, confidence=0.88, group_id=g126.id,
            source_message=m2, source_text=f"Bekzod: {m2.text}", status=TaskStatus.DETECTED,
            linked_messages=[(m2, TaskMessageRelation.SOURCE)],
            event_data={"why": "Driver disputes a pay deduction; accounting must check it."},
        )
        await transition_task(session, t2, TaskStatus.NEEDS_REVIEW, ai)
        await transition_task(session, t2, TaskStatus.ASSIGNED, Actor.for_user(acct_lead), assignee_id=acct_lead.id)
        await transition_task(session, t2, TaskStatus.IN_PROGRESS, Actor.for_user(acct_lead))

        # 3. Truck 127 — repair invoice (needs review)
        m3 = await _tg_message(session, g127, sardor, "Remont invoice tashlab beraman, 1840$ chiqdi, tormoz almashtirildi", 25)
        t3 = await create_task(
            session, actor=ai, title="Review repair invoice ($1,840 brakes) for truck 127",
            i18n={'uz': {'title': '127-mashina remont invoysini tekshirish ($1,840, tormoz)', 'summary': 'Haydovchi tormoz almashtirish uchun $1,840 lik remont invoysini yuboradi.'}, 'ru': {'title': 'Проверить счёт за ремонт трака 127 ($1,840, тормоза)', 'summary': 'Водитель пришлёт счёт за ремонт тормозов на $1,840.'}},
            description="Driver will send a $1,840 repair invoice for a brake replacement.",
            category=TaskCategory.FLEET_MAINTENANCE, priority=Priority.P3, department_id=depts["FLEET"].id,
            truck_id=trucks["127"].id, source=TaskSource.AI, confidence=0.71, group_id=g127.id,
            source_message=m3, source_text=f"Sardor: {m3.text}", status=TaskStatus.DETECTED,
            linked_messages=[(m3, TaskMessageRelation.SOURCE)],
            event_data={"why": "Repair cost must be approved and the invoice filed."},
        )
        await transition_task(session, t3, TaskStatus.NEEDS_REVIEW, ai)

        # 4. Dispatch — P1 breakdown, assigned to fleet lead
        m4 = await _tg_message(session, g_dispatch, disp, "112 trak I-40 da turib qoldi, balon portladi. Tow kerak srochno", 15)
        t4 = await create_task(
            session, actor=ai, title="Arrange tow / tire service for truck 112 on I-40",
            i18n={'uz': {'title': 'I-40 da 112-mashinaga evakuator / shina xizmati topish', 'summary': '112-mashina I-40 da balon portlab to‘xtab qoldi; shoshilinch evakuator yoki yo‘l xizmati kerak.'}, 'ru': {'title': 'Организовать эвакуатор / шиномонтаж для трака 112 на I-40', 'summary': 'Трак 112 стоит на I-40 после разрыва шины; срочно нужен эвакуатор или дорожная помощь.'}},
            description="Truck 112 stopped on I-40 after a tire blowout; urgent tow or road service needed.",
            category=TaskCategory.FLEET_MAINTENANCE, priority=Priority.P1, department_id=depts["FLEET"].id,
            truck_id=trucks["112"].id, source=TaskSource.AI, confidence=0.97, group_id=g_dispatch.id,
            source_message=m4, source_text=f"Dilshod (@dispatch_dilshod): {m4.text}", status=TaskStatus.DETECTED,
            linked_messages=[(m4, TaskMessageRelation.SOURCE)],
            event_data={"why": "Truck cannot move; safety and load at risk."},
        )
        await transition_task(session, t4, TaskStatus.NEEDS_REVIEW, ai)
        await transition_task(session, t4, TaskStatus.ASSIGNED, mgr, assignee_id=fleet_lead.id)

        # 5. Completed today — POD uploaded
        m5 = await _tg_message(session, g126, bekzod, "POD ni yubordim, imzolangan", 240)
        t5 = await create_task(
            session, actor=mgr, title="Upload signed POD for load 88231 (truck 126)",
            i18n={'uz': {'title': '88231 yuk uchun imzolangan POD ni yuklash (126-mashina)', 'summary': None}, 'ru': {'title': 'Загрузить подписанный POD по грузу 88231 (трак 126)', 'summary': None}},
            category=TaskCategory.DOCUMENTS, priority=Priority.P3, department_id=depts["ACCOUNTING"].id,
            truck_id=trucks["126"].id, load_ref="88231", assignee_id=acct_lead.id, group_id=g126.id,
            source_message=m5, source_text=f"Bekzod: {m5.text}", linked_messages=[(m5, TaskMessageRelation.SOURCE)],
        )
        await transition_task(session, t5, TaskStatus.PENDING_VERIFICATION, Actor.for_user(acct_lead), reason="POD received")
        await transition_task(session, t5, TaskStatus.COMPLETED, mgr)

        # 6. Pending verification — HOS log edit
        t6 = await create_task(
            session, actor=Actor.for_user(eld_lead), title="Correct HOS log edit request for truck 118",
            i18n={'uz': {'title': '118-mashina uchun HOS log tahririni to‘g‘rilash', 'summary': None}, 'ru': {'title': 'Исправить запрос на правку HOS-лога для трака 118', 'summary': None}},
            category=TaskCategory.ELD, priority=Priority.P3, department_id=depts["ELD"].id,
            truck_id=trucks["118"].id, assignee_id=eld_agent.id,
        )
        await transition_task(session, t6, TaskStatus.IN_PROGRESS, Actor.for_user(eld_agent))
        await add_comment(session, t6, Actor.for_user(eld_agent), "Edit submitted in the ELD portal, waiting for driver to accept.")
        await transition_task(session, t6, TaskStatus.PENDING_VERIFICATION, Actor.for_user(eld_agent))

        history = await _seed_history(
            session,
            company,
            depts,
            {"manager": manager, "eld_lead": eld_lead, "eld_agent": eld_agent, "acct_lead": acct_lead,
             "fleet_lead": fleet_lead, "dispatch_lead": dispatch_lead},
            trucks,
            g_dispatch,
            [aziz, bekzod, sardor, disp],
        )
        from app.demo_crm import seed_crm_demo

        crm = await seed_crm_demo(session)
        await session.commit()
    print(f"Added {history} sample tasks of history over the last 13 days; CRM demo: {crm}.")

    print(f"Demo data created. Login with any of these (password: {password}):")
    for email in (
        "owner@demo-trucking.com", "manager@demo-trucking.com", "eld.lead@demo-trucking.com",
        "eld.agent@demo-trucking.com", "acct.lead@demo-trucking.com", "fleet.lead@demo-trucking.com",
        "dispatch.lead@demo-trucking.com", "viewer@demo-trucking.com",
    ):
        print("  ", email)


# --------------------------------------------------------------------------- demo history

# (category, department, priority, en, uz, ru, chat message) — {u} truck, {l} load, {a} amount
_HISTORY_TEMPLATES = [
    ("eld", "ELD", "P2", "Fix ELD disconnect on truck {u}", "{u}-mashinada ELD uzilishini tuzatish",
     "Исправить отключение ELD на траке {u}", "Aka {u} ELD yana uzilib qoldi, ulanmayapti"),
    ("documents", "ACCOUNTING", "P3", "Send signed POD for load {l}", "{l}-yuk uchun imzolangan POD yuborish",
     "Отправить подписанный POD по грузу {l}", "{l} POD ni tashlab yuboring, broker so'rayapti"),
    ("accounting", "ACCOUNTING", "P3", "Reimburse ${a} lumper fee for truck {u}", "{u}-mashina uchun ${a} lumper pulini qaytarish",
     "Возместить lumper ${a} для трака {u}", "Lumper ${a} o'zimdan to'ladim, chek bor. {u}"),
    ("fleet_maintenance", "FLEET", "P2", "Replace worn front tire on truck {u}", "{u}-mashinaning yeyilgan old shinasini almashtirish",
     "Заменить изношенную переднюю шину на траке {u}", "{u} old balon yeyilib ketgan, almashtirish kerak"),
    ("fleet_maintenance", "FLEET", "P4", "Schedule PM service for truck {u}", "{u}-mashina uchun PM xizmatini rejalashtirish",
     "Запланировать ТО для трака {u}", "{u} ga PM vaqti keldi, qachon kiritamiz?"),
    ("safety_compliance", "SAFETY", "P1", "Review DOT inspection report for truck {u}", "{u}-mashina DOT tekshiruv hisobotini ko‘rib chiqish",
     "Проверить отчёт DOT-инспекции по траку {u}", "{u} DOT inspection bo'ldi, report rasmini tashladim"),
    ("eld", "ELD", "P3", "Correct HOS log edit for truck {u}", "{u}-mashina HOS log tahririni to‘g‘rilash",
     "Исправить правку HOS-лога по траку {u}", "{u} logda xato bor, edit qilib bering"),
    ("dispatch", "DISPATCH", "P3", "Claim detention pay for load {l}", "{l}-yuk bo‘yicha detention to‘lovini rasmiylashtirish",
     "Оформить оплату detention по грузу {l}", "{l} da 4 soat kutdik, detention yozib qo'ying"),
    ("dispatch", "DISPATCH", "P2", "Update appointment time for load {l}", "{l}-yuk uchun appointment vaqtini yangilash",
     "Обновить время appointment по грузу {l}", "Груз {l} перенесли, appointment завтра в 8:00"),
    ("accounting", "ACCOUNTING", "P3", "Explain settlement deduction for truck {u}", "{u}-mashina settlementidagi ushlanmani tushuntirish",
     "Объяснить удержание в settlement трака {u}", "Settlementda nimaga ushlab qolishdi aka? {u}"),
    ("hr", "HR", "P4", "Renew medical card for driver of truck {u}", "{u}-mashina haydovchisining tibbiy kartasini yangilash",
     "Продлить медкарту водителя трака {u}", "Medkarta muddati tugayapti, yangilash kerak ({u})"),
    ("accounting", "ACCOUNTING", "P2", "Replace blocked fuel card for truck {u}", "{u}-mashinaning bloklangan yoqilg‘i kartasini almashtirish",
     "Заменить заблокированную топливную карту трака {u}", "Топливная карта не работает, трак {u}, стою на заправке"),
]


async def _seed_history(session, company, depts, users, trucks, group, tg_users) -> int:
    """Two weeks of finished and in-flight sample work so charts and the activity feed have shape."""
    import random

    from app.domain.enums import ActorKind, TaskEventType
    from app.models import AIExtraction, Task, TaskEvent, TaskMessage
    from app.services.tasks import next_task_number

    rng = random.Random(42)
    now = utcnow()
    staff = {
        "ELD": [users["eld_agent"], users["eld_lead"]],
        "ACCOUNTING": [users["acct_lead"]],
        "FLEET": [users["fleet_lead"]],
        "DISPATCH": [users["dispatch_lead"]],
        "SAFETY": [users["manager"]],
        "HR": [users["manager"]],
    }
    leads = {"ELD": users["eld_lead"], "ACCOUNTING": users["acct_lead"], "FLEET": users["fleet_lead"],
             "DISPATCH": users["dispatch_lead"]}
    units = [str(u) for u in range(101, 131)]
    count = 0

    def ev(task, at, type_, actor_kind, actor=None, frm=None, to=None, reason=None, data=None):
        session.add(TaskEvent(company_id=company.id, task_id=task.id, type=type_, from_status=frm, to_status=to,
                              actor_kind=actor_kind, actor_user_id=actor.id if actor else None,
                              reason=reason, data=data or {}, created_at=at))

    for days_ago in range(13, 0, -1):
        for _ in range(rng.randint(2, 5)):
            cat, dept, prio, en, uz, ru, chat = rng.choice(_HISTORY_TEMPLATES)
            fill = {"u": rng.choice(units), "l": str(rng.randint(80000, 99999)), "a": rng.choice([75, 120, 150, 185, 220])}
            created = now - timedelta(days=days_ago, hours=rng.randint(0, 10), minutes=rng.randint(0, 59))
            is_ai = rng.random() < 0.8
            sender = rng.choice(tg_users)
            msg = Message(id=uuid.uuid4(), company_id=company.id, group_id=group.id, tg_chat_id=group.tg_chat_id,
                          tg_message_id=next(_msg_ids), sender_id=sender.id, sent_at=created - timedelta(minutes=2),
                          text=chat.format(**fill), analysis_status=AnalysisStatus.DONE, analyzed_at=created, raw={},
                          created_at=created - timedelta(minutes=2))
            session.add(msg)
            assignee = rng.choice(staff[dept])
            lead = leads.get(dept, users["manager"])
            sla_hours = {"P1": 1, "P2": 4, "P3": 24, "P4": 72}[prio]
            task = Task(
                id=uuid.uuid4(), company_id=company.id, number=await next_task_number(session, company.id),
                title=en.format(**fill), description=None,
                i18n={"uz": {"title": uz.format(**fill), "summary": None}, "ru": {"title": ru.format(**fill), "summary": None}},
                category=cat, priority=prio, status=TaskStatus.COMPLETED, department_id=depts[dept].id,
                truck_id=trucks[fill["u"]].id if "{u}" in en else None, load_ref=fill["l"] if "{l}" in en else None,
                source=TaskSource.AI if is_ai else TaskSource.TELEGRAM_COMMAND, confidence=round(rng.uniform(0.62, 0.98), 2) if is_ai else None,
                group_id=group.id, source_message_id=msg.id, source_text=f"{sender.display_name}: {msg.text}",
                due_at=created + timedelta(hours=sla_hours), created_at=created, updated_at=created,
            )
            session.add(task)
            await session.flush()
            session.add(TaskMessage(task_id=task.id, message_id=msg.id, relation=TaskMessageRelation.SOURCE, created_at=created))
            if is_ai:
                session.add(AIExtraction(company_id=company.id, group_id=group.id, message_ids=[str(msg.id)], model="claude-opus-5-5",
                                         prompt_version="demo", status="ok", input_tokens=rng.randint(350, 900),
                                         output_tokens=rng.randint(250, 600), latency_ms=rng.randint(3000, 9000),
                                         tasks_created=1, created_at=created))
            ev(task, created, TaskEventType.CREATED, ActorKind.AI if is_ai else ActorKind.SYSTEM, to=TaskStatus.DETECTED if is_ai else TaskStatus.NEEDS_REVIEW,
               data={"why": "Sample task (demo history)."} if is_ai else {})
            if is_ai:
                ev(task, created, TaskEventType.STATUS_CHANGED, ActorKind.AI, frm=TaskStatus.DETECTED, to=TaskStatus.NEEDS_REVIEW)
            t = created + timedelta(minutes=rng.randint(5, 50))
            roll = rng.random()
            if roll < 0.08:  # reviewer rejected it
                task.status, task.cancelled_at, task.cancel_reason = TaskStatus.CANCELLED, t, "Not a task"
                ev(task, t, TaskEventType.STATUS_CHANGED, ActorKind.USER, lead, TaskStatus.NEEDS_REVIEW, TaskStatus.CANCELLED, "Not a task")
                task.updated_at = t
                count += 1
                continue
            task.assignee_id = assignee.id
            ev(task, t, TaskEventType.STATUS_CHANGED, ActorKind.USER, lead, TaskStatus.NEEDS_REVIEW, TaskStatus.ASSIGNED)
            ev(task, t, TaskEventType.ASSIGNED, ActorKind.USER, lead, data={"assignee_id": str(assignee.id)})
            t += timedelta(minutes=rng.randint(10, 120))
            task.started_at = t
            ev(task, t, TaskEventType.STATUS_CHANGED, ActorKind.USER, assignee, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS)
            still_open = days_ago <= 2 and roll > 0.55
            if still_open:
                task.status = TaskStatus.IN_PROGRESS
                if roll > 0.85:
                    task.status, task.blocked_reason = TaskStatus.BLOCKED, "Waiting for the driver's documents"
                    ev(task, t + timedelta(minutes=30), TaskEventType.STATUS_CHANGED, ActorKind.USER, assignee,
                       TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, task.blocked_reason)
                task.updated_at = t
                count += 1
                continue
            done = min(t + timedelta(hours=rng.uniform(0.3, sla_hours * 1.3)), now - timedelta(minutes=30))
            ev(task, done, TaskEventType.STATUS_CHANGED, ActorKind.USER, assignee, TaskStatus.IN_PROGRESS, TaskStatus.PENDING_VERIFICATION)
            verifier = lead if lead.id != assignee.id else users["manager"]
            closed = done + timedelta(minutes=rng.randint(5, 90))
            closed = min(closed, now - timedelta(minutes=5))
            ev(task, closed, TaskEventType.STATUS_CHANGED, ActorKind.USER, verifier, TaskStatus.PENDING_VERIFICATION, TaskStatus.COMPLETED)
            task.completed_at, task.verified_by_id, task.updated_at = closed, verifier.id, closed
            count += 1
    return count


# --------------------------------------------------------------------------- telegram ops


async def check_bot() -> None:
    from app.telegram.client import TelegramClient

    client = TelegramClient()
    try:
        me = await client.get_me()
        info = await client.get_webhook_info()
    finally:
        await client.close()
    ok = me.get("can_read_all_group_messages")
    print(f"Bot: @{me.get('username')} (id {me.get('id')})")
    print(f"Privacy mode: {'OFF (good)' if ok else 'ON — bot cannot see group messages! BotFather → /setprivacy → Disable'}")
    print(f"Webhook: {info.get('url') or '(none — polling)'}; pending updates: {info.get('pending_update_count')}")
    if info.get("last_error_message"):
        print(f"Last webhook error: {info['last_error_message']}")


async def set_webhook(url: str) -> None:
    from app.telegram.client import TelegramClient

    secret = get_settings().telegram_webhook_secret
    if not secret:
        sys.exit("Set TELEGRAM_WEBHOOK_SECRET first (e.g. " + secrets.token_urlsafe(32) + ")")
    client = TelegramClient()
    try:
        await client.set_webhook(url, secret)
    finally:
        await client.close()
    print(f"Webhook set to {url}")


async def simulate(chat_id: int, text: str, user_id: int, name: str, reply_to: int | None, analyze: bool) -> None:
    """Feed a fake Telegram update through the real ingestion (and optionally AI) pipeline."""
    from app.services.analysis import run_group_analysis
    from app.telegram.handler import handle_update

    async with session_factory()() as session:
        existing = await session.scalar(select(TelegramGroup).where(TelegramGroup.tg_chat_id == chat_id))
    title = existing.title if existing else f"Simulated {chat_id}"  # ingestion syncs titles; keep the real one
    message_id = int(utcnow().timestamp() * 1000) % 2_000_000_000
    update = {
        "update_id": message_id,
        "message": {
            "message_id": message_id,
            "date": int(utcnow().timestamp()),
            "chat": {"id": chat_id, "type": "supergroup", "title": title},
            "from": {"id": user_id, "is_bot": False, "first_name": name},
            "text": text,
            **({"reply_to_message": {"message_id": reply_to}} if reply_to else {}),
        },
    }
    result = await handle_update(update, side_effects=False)
    print(f"ingest: {result.action} (message tg id {message_id})")
    if result.action == "group_pending":
        print("Group is new and disabled — enable it in the dashboard (Groups) and simulate again.")
    if analyze and result.analyze_group_id:
        outcome = await run_group_analysis(session_factory(), result.analyze_group_id, force=True)
        print(f"analysis: {outcome.status}; created {outcome.tasks_created}; updates {outcome.updates_applied}; "
              f"duplicates linked {outcome.duplicates_linked}")


async def add_demo_history() -> None:
    """Append two weeks of sample history to an existing demo database (real groups are untouched)."""
    from app.models import TelegramUser

    async with session_factory()() as session:
        company = await session.scalar(select(Company).order_by(Company.created_at).limit(1))
        if company is None:
            sys.exit("No company found; run reset-demo first.")
        depts = {d.code: d for d in (await session.scalars(select(Department).where(Department.company_id == company.id))).all()}
        by_email = {u.email: u for u in (await session.scalars(select(User).where(User.company_id == company.id))).unique().all()}
        keys = {"manager": "manager", "eld_lead": "eld.lead", "eld_agent": "eld.agent", "acct_lead": "acct.lead",
                "fleet_lead": "fleet.lead", "dispatch_lead": "dispatch.lead"}
        users = {k: by_email.get(f"{v}@demo-trucking.com") for k, v in keys.items()}
        if any(u is None for u in users.values()):
            sys.exit("Demo users not found; this command only works on the demo company.")
        trucks = {t.unit_number: t for t in (await session.scalars(select(Truck).where(Truck.company_id == company.id))).all()}
        group = await session.scalar(select(TelegramGroup).where(TelegramGroup.tg_chat_id == -1001000000900))
        tg_users = list((await session.scalars(select(TelegramUser).where(TelegramUser.tg_user_id.in_([5001, 5002, 5003, 5004])))).all())
        if group is None or not tg_users:
            sys.exit("Demo dispatch group / demo senders not found.")
        global _msg_ids
        _msg_ids = itertools.count(500_000 + int(utcnow().timestamp()) % 100_000 * 10)  # avoid earlier demo ids
        n = await _seed_history(session, company, depts, users, trucks, group, tg_users)
        await session.commit()
    print(f"Added {n} sample tasks of history.")


async def set_password(email: str, password: str) -> None:
    """Give one account its own password (e.g. a read-only login to share with guests)."""
    from sqlalchemy import func

    async with session_factory()() as session:
        user = await session.scalar(select(User).where(func.lower(User.email) == email.lower()))
        if user is None:
            sys.exit(f"No user with email {email}")
        user.password_hash = hash_password(password)
        await session.commit()
    print(f"Password updated for {user.email} ({user.role}).")


async def add_crm_demo() -> None:
    """Add the CRM blueprint demo data (mailboxes, response clocks, companies, shifts, loads) to an existing demo DB."""
    from app.demo_crm import seed_crm_demo

    async with session_factory()() as session:
        result = await seed_crm_demo(session)
        await session.commit()
    print(f"CRM demo data added: {result}")


async def analyze(group_id: str) -> None:
    from app.services.analysis import run_group_analysis

    outcome = await run_group_analysis(session_factory(), uuid.UUID(group_id), force=True)
    print(outcome)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    p = sub.add_parser("reset-demo")
    p.add_argument("--password", default="demo12345", help="password for all demo users")
    sub.add_parser("add-demo-history")
    sub.add_parser("add-crm-demo")
    p = sub.add_parser("set-password")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p = sub.add_parser("create-admin")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--company", default="My Trucking Company")
    p.add_argument("--timezone", default="America/Chicago")
    sub.add_parser("check-bot")
    p = sub.add_parser("set-webhook")
    p.add_argument("--url", required=True)
    p = sub.add_parser("simulate")
    p.add_argument("--chat-id", type=int, required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--user-id", type=int, default=777)
    p.add_argument("--name", default="Test Driver")
    p.add_argument("--reply-to", type=int)
    p.add_argument("--analyze", action="store_true", help="run AI analysis immediately (needs AI_ENABLED)")
    p = sub.add_parser("analyze")
    p.add_argument("--group-id", required=True)
    args = parser.parse_args()

    commands = {
        "init-db": lambda: init_db(),
        "reset-demo": lambda: reset_demo(args.password),
        "add-demo-history": lambda: add_demo_history(),
        "add-crm-demo": lambda: add_crm_demo(),
        "set-password": lambda: set_password(args.email, args.password),
        "create-admin": lambda: create_admin(args.email, args.password, args.company, args.timezone),
        "check-bot": lambda: check_bot(),
        "set-webhook": lambda: set_webhook(args.url),
        "simulate": lambda: simulate(args.chat_id, args.text, args.user_id, args.name, args.reply_to, args.analyze),
        "analyze": lambda: analyze(args.group_id),
    }
    asyncio.run(commands[args.cmd]())


if __name__ == "__main__":
    main()
