"""Demo data for the CRM blueprint features (labelled demo; never used in production).

Adds to the existing demo company: a demo mailbox with email threads, response clocks (waiting,
overdue, answered) with escalations and 7 days of response history, the issues from the mockup,
TMS loads, shifts and a pending handover. Adds 4 more demo companies the owner can switch to.
"""

import itertools
import random
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import (
    AnalysisStatus,
    BotMembership,
    GroupKind,
    Priority,
    Role,
    TaskCategory,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
)
from app.models import (
    Company,
    Department,
    Handover,
    Load,
    Mailbox,
    Message,
    ResponseClock,
    ResponseEscalation,
    Shift,
    Task,
    TaskEvent,
    TaskMessage,
    TelegramGroup,
    TelegramUser,
    Truck,
    User,
    UserCompanyAccess,
    utcnow,
)

OTHER_COMPANIES = ["Silk Road Freight (demo)", "Samarkand Express (demo)", "Tashkent Logistics (demo)", "Fergana Carriers (demo)"]
DEPARTMENTS = [("DISPATCH", "Dispatch"), ("ACCOUNTING", "Accounting"), ("ELD", "ELD / Compliance"),
               ("FLEET", "Fleet / Maintenance"), ("TRAILER", "Trailers"), ("SAFETY", "Safety"), ("HR", "HR")]

_ids = itertools.count(int(utcnow().timestamp()) % 100_000 * 10 + 900_000)


async def _next_number(session, company: Company) -> int:
    company.task_seq += 1
    return company.task_seq


def _msg(company_id, *, now, minutes_ago, text, group=None, mailbox=None, thread=None, sender=None, from_address=None,
         subject=None, staff=False, automated=False) -> Message:
    m = Message(
        id=uuid.uuid4(), company_id=company_id,
        channel="email" if mailbox else "telegram",
        group_id=group.id if group else None, mailbox_id=mailbox.id if mailbox else None,
        thread_key=f"mail:{mailbox.id}:{thread}" if mailbox else f"tg:{group.id}",
        tg_chat_id=group.tg_chat_id if group else None, tg_message_id=next(_ids) if group else None,
        external_id=f"demo-{next(_ids)}" if mailbox else None, thread_id=thread,
        subject=subject, from_address=from_address, sender_id=sender.id if sender else None,
        direction="outbound" if staff else "inbound",
        sender_kind="automated" if automated else ("staff" if staff else "external"),
        classification="automated" if automated else None,
        sent_at=now - timedelta(minutes=minutes_ago), text=text, raw={},
        analysis_status=AnalysisStatus.DONE, analyzed_at=now - timedelta(minutes=max(0, minutes_ago - 2)),
        created_at=now - timedelta(minutes=minutes_ago),
    )
    return m


def _clock(m: Message, *, sender_name, department_id, status="pending", answer_after=None, answered_by=None,
           level=0, critical=False, task=None) -> ResponseClock:
    c = ResponseClock(
        id=uuid.uuid4(), company_id=m.company_id, message_id=m.id, thread_key=m.thread_key, channel=m.channel,
        group_id=m.group_id, mailbox_id=m.mailbox_id, department_id=department_id, sender_key=sender_name,
        sender_name=sender_name, preview=((m.subject + " — ") if m.subject else "") + (m.text or "")[:120],
        started_at=m.sent_at, received_at=m.sent_at, due_at=m.sent_at + timedelta(minutes=5), status=status,
        level=level, critical=critical, task_id=task.id if task else None, created_at=m.sent_at,
    )
    if status == "answered":
        c.answered_at = m.sent_at + timedelta(seconds=answer_after)
        c.response_seconds = answer_after
        c.answered_by_name = answered_by
    return c


async def _task(session, company, *, title, i18n, category, priority, status, dept, assignee=None, truck=None,
                load_ref=None, trailer=None, driver=None, issue_type=None, amount=None, minutes_ago=30,
                group=None, mailbox=None, source_msgs=(), resolved_minutes_ago=None) -> Task:
    now = utcnow()
    created = now - timedelta(minutes=minutes_ago)
    t = Task(
        id=uuid.uuid4(), company_id=company.id, number=await _next_number(session, company), title=title, i18n=i18n,
        category=category, priority=priority, status=status, department_id=dept.id if dept else None,
        assignee_id=assignee.id if assignee else None, truck_id=truck.id if truck else None, load_ref=load_ref,
        trailer_ref=trailer, driver_name=driver, issue_type=issue_type, amount=amount,
        source=TaskSource.AI, confidence=0.9, group_id=group.id if group else None, mailbox_id=mailbox.id if mailbox else None,
        source_message_id=source_msgs[0].id if source_msgs else None,
        source_text="\n".join(m.text or "" for m in source_msgs) or None,
        due_at=created + timedelta(hours={"P1": 1, "P2": 4, "P3": 24, "P4": 72}[priority]),
        created_at=created, updated_at=created,
        started_at=created + timedelta(minutes=5) if status in (TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED) else None,
        completed_at=now - timedelta(minutes=resolved_minutes_ago) if resolved_minutes_ago is not None else None,
    )
    session.add(t)
    await session.flush()
    session.add(TaskEvent(company_id=company.id, task_id=t.id, type="created", to_status="detected", actor_kind="ai",
                          data={"why": "Demo issue.", "channel": "email" if mailbox else "telegram"}, created_at=created))
    for m in source_msgs:
        session.add(TaskMessage(task_id=t.id, message_id=m.id, relation=TaskMessageRelation.SOURCE, created_at=created))
    return t


async def _departments(session, company: Company) -> dict[str, Department]:
    existing = {d.code: d for d in (await session.scalars(select(Department).where(Department.company_id == company.id))).all()}
    for code, name in DEPARTMENTS:
        if code not in existing:
            d = Department(id=uuid.uuid4(), company_id=company.id, code=code, name=name)
            session.add(d)
            existing[code] = d
    await session.flush()
    return existing


async def seed_crm_demo(session: AsyncSession) -> dict:
    rng = random.Random(7)
    now = utcnow()
    company = await session.scalar(select(Company).order_by(Company.created_at).limit(1))
    users = {u.email.split("@")[0]: u for u in (await session.scalars(select(User).where(User.company_id == company.id))).unique().all()}
    owner, manager = users.get("owner"), users.get("manager")
    eld_agent, eld_lead, acct, fleet, dispatch = (users.get(k) for k in ("eld.agent", "eld.lead", "acct.lead", "fleet.lead", "dispatch.lead"))
    depts = await _departments(session, company)
    trucks = {t.unit_number: t for t in (await session.scalars(select(Truck).where(Truck.company_id == company.id))).all()}
    groups = {g.tg_chat_id: g for g in (await session.scalars(select(TelegramGroup).where(TelegramGroup.company_id == company.id))).all()}
    g_dispatch = groups.get(-1001000000900)
    g125 = groups.get(-1001000000125)
    drivers = list((await session.scalars(select(TelegramUser).where(TelegramUser.company_id == company.id,
                                                                     TelegramUser.tg_user_id.in_([5001, 5002, 5003, 5004])))).all())
    driver = drivers[0] if drivers else None

    # --- groups for the mockup departments -----------------------------------------------------------
    def demo_group(chat_id, title, kind, dept):
        g = groups.get(chat_id) or TelegramGroup(id=uuid.uuid4(), company_id=company.id, tg_chat_id=chat_id, title=title,
                                                 chat_type="supergroup", kind=kind, department_id=depts[dept].id,
                                                 is_enabled=True, enabled_at=now, bot_status=BotMembership.ADMINISTRATOR,
                                                 last_message_at=now)
        session.add(g)
        groups[chat_id] = g
        return g

    g_eld = demo_group(-1001000000902, "ELD Support (demo)", GroupKind.DEPARTMENT, "ELD")
    g_fleet = demo_group(-1001000000903, "Fleet Group (demo)", GroupKind.DEPARTMENT, "FLEET")
    g_trailer = demo_group(-1001000000904, "Trailer Group (demo)", GroupKind.DEPARTMENT, "TRAILER")
    await session.flush()

    # --- demo mailbox (provider "demo": the Gmail sync never touches it) -------------------------------
    mailbox = await session.scalar(select(Mailbox).where(Mailbox.company_id == company.id, Mailbox.email_address == "dispatch@demo-trucking.com"))
    if mailbox is None:
        mailbox = Mailbox(id=uuid.uuid4(), company_id=company.id, email_address="dispatch@demo-trucking.com",
                          display_name="Dispatch inbox (demo)", provider="demo", department_id=depts["DISPATCH"].id,
                          status="connected", is_enabled=True, last_sync_at=now, connected_by_user_id=owner.id if owner else None)
        session.add(mailbox)
        acct_box = Mailbox(id=uuid.uuid4(), company_id=company.id, email_address="accounting@demo-trucking.com",
                           display_name="Accounting inbox (demo)", provider="demo", department_id=depts["ACCOUNTING"].id,
                           status="connected", is_enabled=True, last_sync_at=now)
        session.add(acct_box)
        await session.flush()
    else:
        acct_box = await session.scalar(select(Mailbox).where(Mailbox.company_id == company.id, Mailbox.email_address == "accounting@demo-trucking.com"))

    # --- TMS loads --------------------------------------------------------------------------------------
    for ref, unit, trailer, drv, broker, st in [
        ("78432", "112", "T-1180", "Alex K.", "CH Robinson", "At shipper"), ("78455", "118", "T-1185", "John D.", "TQL", "Booked"),
        ("88231", "126", "T-1192", "Bekzod R.", "Coyote", "In transit"), ("77123", "104", "T-1170", "Sardor M.", "Echo", "Delivered"),
        ("99120", "112", "T-1180", "Alex K.", "Uber Freight", "In transit"), ("778812", "125", "T-1201", "Aziz T.", "Arrive", "Booked"),
    ]:
        if not await session.scalar(select(Load.id).where(Load.company_id == company.id, Load.load_ref == ref)):
            tr = trucks.get(unit)
            session.add(Load(company_id=company.id, load_ref=ref, truck_id=tr.id if tr else None, truck_unit=unit,
                             trailer_ref=trailer, driver_name=drv, broker=broker, status=st, updated_at=now))

    # --- the mockup's issues with their conversations and response clocks -------------------------------
    m1 = _msg(company.id, now=now, minutes_ago=48, group=g_dispatch, sender=driver,
              text="Load 78432 da shipperda 2 soatdan beri kutyapman, detention yozib qo'ying")
    m1r = _msg(company.id, now=now, minutes_ago=46, group=g_dispatch, staff=True, text="Yozib qo'ydim, broker bilan gaplashaman")
    m2 = _msg(company.id, now=now, minutes_ago=4, mailbox=mailbox, thread="thr-78455", from_address="Mia <mia@tql-demo.com>",
              subject="Missing rate confirmation – Load #78455", text="Hi team, we still need the signed RC for load 78455 before dispatch. Thanks!")
    m3 = _msg(company.id, now=now, minutes_ago=7, group=g_eld, sender=driver, text="John D. logida xato bor, HOS violation bo'lib qolmasin, tekshirib bering")
    m4 = _msg(company.id, now=now, minutes_ago=12, group=g_fleet, sender=driver, text="Truck 112 old shinasi yorildi, almashtirish kerak")
    m5 = _msg(company.id, now=now, minutes_ago=16, group=g_trailer, sender=driver, text="Trailer T-1192 customerda bo'sh turibdi, hali qaytarilmadi")
    m6 = _msg(company.id, now=now, minutes_ago=25, mailbox=acct_box, thread="thr-inv", from_address="Billing <ap@coyote-demo.com>",
              subject="Invoice for Load #78432", text="Please confirm detention amount on invoice for load 78432 ($250).")
    m6r = _msg(company.id, now=now, minutes_ago=22, mailbox=acct_box, thread="thr-inv", staff=True,
               from_address="Aziza <accounting@demo-trucking.com>", subject="Re: Invoice for Load #78432", text="Confirmed, $250 detention approved.")
    m7 = _msg(company.id, now=now, minutes_ago=30, mailbox=mailbox, thread="thr-auto", automated=True,
              from_address="noreply@loadboard-demo.com", subject="New loads matching your lanes", text="12 new loads...")
    m8 = _msg(company.id, now=now, minutes_ago=2, group=g125, sender=driver, text="Aka POD rasmini qayerga tashlay?")
    session.add_all([m1, m1r, m2, m3, m4, m5, m6, m6r, m7, m8])
    await session.flush()

    t1 = await _task(session, company, title="Detention at shipper – Load #78432", i18n={
        "uz": {"title": "Shipperda detention – yuk #78432", "summary": None}, "ru": {"title": "Detention у грузоотправителя – груз #78432", "summary": None}},
        category=TaskCategory.DISPATCH, priority=Priority.P2, status=TaskStatus.IN_PROGRESS, dept=depts["DISPATCH"], assignee=dispatch,
        truck=trucks.get("112"), load_ref="78432", trailer="T-1180", driver="Alex K.", issue_type="detention", amount=250,
        minutes_ago=48, group=g_dispatch, source_msgs=[m1])
    t2 = await _task(session, company, title="Missing rate confirmation – Load #78455", i18n={
        "uz": {"title": "Rate confirmation yo‘q – yuk #78455", "summary": None}, "ru": {"title": "Нет rate confirmation – груз #78455", "summary": None}},
        category=TaskCategory.ACCOUNTING, priority=Priority.P2, status=TaskStatus.NEEDS_REVIEW, dept=depts["ACCOUNTING"],
        truck=trucks.get("118"), load_ref="78455", trailer="T-1185", driver="John D.", issue_type="rate_confirmation",
        minutes_ago=4, mailbox=mailbox, source_msgs=[m2])
    t3 = await _task(session, company, title="ELD log error – Driver John D. (HOS violation risk)", i18n={
        "uz": {"title": "ELD log xatosi – haydovchi John D. (HOS xavfi)", "summary": None}, "ru": {"title": "Ошибка ELD-лога – водитель John D. (риск HOS)", "summary": None}},
        category=TaskCategory.ELD, priority=Priority.P2, status=TaskStatus.IN_PROGRESS, dept=depts["ELD"], assignee=eld_agent,
        driver="John D.", issue_type="eld_error", minutes_ago=7, group=g_eld, source_msgs=[m3])
    t4 = await _task(session, company, title="Truck #112 – Tire replacement", i18n={
        "uz": {"title": "112-mashina – shina almashtirish", "summary": None}, "ru": {"title": "Трак #112 – замена шины", "summary": None}},
        category=TaskCategory.FLEET_MAINTENANCE, priority=Priority.P1, status=TaskStatus.NEEDS_REVIEW, dept=depts["FLEET"],
        truck=trucks.get("112"), issue_type="tire", minutes_ago=12, group=g_fleet, source_msgs=[m4])
    t5 = await _task(session, company, title="Trailer #T-1192 – Not returned", i18n={
        "uz": {"title": "Treyler #T-1192 – qaytarilmadi", "summary": None}, "ru": {"title": "Прицеп #T-1192 – не возвращён", "summary": None}},
        category=TaskCategory.TRAILER, priority=Priority.P3, status=TaskStatus.NEEDS_REVIEW, dept=depts["TRAILER"],
        trailer="T-1192", load_ref="88231", issue_type="trailer_return", minutes_ago=16, group=g_trailer, source_msgs=[m5])
    t6 = await _task(session, company, title="Confirm $250 detention on invoice – Load #78432", i18n={
        "uz": {"title": "Invoysdagi $250 detentionni tasdiqlash – yuk #78432", "summary": None}, "ru": {"title": "Подтвердить detention $250 в счёте – груз #78432", "summary": None}},
        category=TaskCategory.ACCOUNTING, priority=Priority.P3, status=TaskStatus.COMPLETED, dept=depts["ACCOUNTING"], assignee=acct,
        load_ref="78432", issue_type="invoice", amount=250, minutes_ago=25, mailbox=acct_box, source_msgs=[m6], resolved_minutes_ago=20)

    clocks = [
        _clock(m1, sender_name="Aziz", department_id=depts["DISPATCH"].id, status="answered", answer_after=120, answered_by="Dilshod Dispatch Lead", task=t1),
        _clock(m2, sender_name="Mia", department_id=depts["ACCOUNTING"].id, task=t2),
        _clock(m3, sender_name="Aziz", department_id=depts["ELD"].id, level=2, task=t3),
        _clock(m4, sender_name="Aziz", department_id=depts["FLEET"].id, level=3, critical=False, task=t4),
        _clock(m5, sender_name="Aziz", department_id=depts["TRAILER"].id, level=3, task=t5),
        _clock(m6, sender_name="Billing", department_id=depts["ACCOUNTING"].id, status="answered", answer_after=180, answered_by="Aziza Accounting Lead", task=t6),
        _clock(m8, sender_name="Aziz", department_id=None),
    ]
    clocks[0].answer_message_id = m1r.id
    clocks[5].answer_message_id = m6r.id
    session.add_all(clocks)
    await session.flush()
    for clock, levels in ((clocks[2], [(1, "reminder", [eld_agent]), (2, "overdue", [eld_lead])]),
                          (clocks[3], [(1, "reminder", [fleet]), (2, "overdue", [fleet]), (3, "escalated", [manager, owner])]),
                          (clocks[4], [(1, "reminder", []), (2, "overdue", [manager]), (3, "escalated", [manager, owner])])):
        for level, kind, who in levels:
            people = [u for u in who if u is not None]
            session.add(ResponseEscalation(company_id=company.id, clock_id=clock.id, task_id=clock.task_id, level=level, kind=kind,
                                           notified_user_ids=[str(u.id) for u in people], notified_names=[u.full_name for u in people],
                                           created_at=clock.started_at + timedelta(minutes={1: 3, 2: 5, 3: 10}[level])))

    # --- 7 days of response history for the SLA trend -----------------------------------------------------
    hist_group = g_dispatch or g125
    for day in range(1, 8):
        for _ in range(rng.randint(10, 18)):
            minutes_ago = day * 1440 - rng.randint(0, 900)
            m = _msg(company.id, now=now, minutes_ago=minutes_ago, group=hist_group, sender=driver, text="(demo history)")
            session.add(m)
            await session.flush()
            secs = int(rng.choice([rng.randint(20, 240)] * 4 + [rng.randint(300, 900)]))
            session.add(_clock(m, sender_name="Aziz", department_id=depts["DISPATCH"].id, status="answered",
                               answer_after=secs, answered_by="Dilshod Dispatch Lead"))

    # --- shifts and a pending handover ----------------------------------------------------------------------
    for u in (eld_agent, dispatch, acct):
        if u is not None and not await session.scalar(select(Shift.id).where(Shift.user_id == u.id, Shift.status == "active")):
            session.add(Shift(company_id=company.id, user_id=u.id, department_id=u.department_id,
                              started_at=now - timedelta(hours=rng.randint(1, 6)), status="active"))
    if fleet is not None and manager is not None:
        session.add(Handover(company_id=company.id, from_user_id=fleet.id, to_user_id=manager.id, status="pending",
                             note="Truck 112 tire — road service ordered, ETA 40 min", task_ids=[str(t4.id)],
                             created_at=now - timedelta(minutes=6)))

    # --- 4 more companies for the owner overview ---------------------------------------------------------------
    added = 0
    for idx, name in enumerate(OTHER_COMPANIES):
        if await session.scalar(select(Company.id).where(Company.name == name)):
            continue
        c = Company(id=uuid.uuid4(), name=name, timezone="America/Chicago", settings={"four_eyes": True})
        session.add(c)
        await session.flush()
        d = await _departments(session, c)
        if owner is not None:
            session.add(UserCompanyAccess(user_id=owner.id, company_id=c.id, granted_by_user_id=owner.id))
        lead = User(id=uuid.uuid4(), company_id=c.id, email=f"lead{idx + 1}@{name.split()[0].lower()}-demo.com",
                    full_name=f"{name.split()[0]} Dispatch Lead", password_hash=owner.password_hash if owner else "!",
                    role=Role.DEPT_LEAD, department_id=d["DISPATCH"].id)
        session.add(lead)
        cg = []
        for j in range(rng.randint(12, 30)):
            g = TelegramGroup(id=uuid.uuid4(), company_id=c.id, tg_chat_id=-1002000000000 - idx * 1000 - j,
                              title=f"Truck {200 + idx * 100 + j} (demo)", chat_type="supergroup", kind=GroupKind.TRUCK,
                              department_id=d["DISPATCH"].id, is_enabled=True, bot_status=BotMembership.ADMINISTRATOR)
            session.add(g)
            cg.append(g)
        for k in range(rng.randint(2, 5)):
            session.add(Mailbox(company_id=c.id, email_address=f"box{k}@{name.split()[0].lower()}-demo.com", provider="demo",
                                status="connected", is_enabled=True, department_id=d["DISPATCH"].id))
        await session.flush()
        for _ in range(rng.randint(6, 14)):
            g = rng.choice(cg)
            age = rng.randint(1, 40)
            m = _msg(c.id, now=now, minutes_ago=age, group=g, text="(demo) driver question")
            session.add(m)
            await session.flush()
            status = "answered" if rng.random() < 0.55 else "pending"
            session.add(_clock(m, sender_name="Driver", department_id=d["DISPATCH"].id, status=status,
                               answer_after=rng.randint(30, 420), answered_by=lead.full_name,
                               level=0 if status == "answered" or age < 3 else (3 if age >= 10 else (2 if age >= 5 else 1))))
        for j in range(rng.randint(15, 40)):
            st = rng.choice([TaskStatus.NEEDS_REVIEW, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED, TaskStatus.COMPLETED])
            await _task(session, c, title=f"Demo issue {j + 1}", i18n={}, category=rng.choice(list(TaskCategory)),
                        priority=rng.choice(list(Priority)), status=st, dept=d["DISPATCH"], minutes_ago=rng.randint(10, 2000),
                        resolved_minutes_ago=rng.randint(5, 1400) if st == TaskStatus.COMPLETED else None)
        added += 1
    await session.flush()
    return {"companies_added": added, "issues": 6, "mailboxes": 2}
