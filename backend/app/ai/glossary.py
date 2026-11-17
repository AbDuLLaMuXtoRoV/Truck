"""Trucking + Uzbek/Russian slang glossary. Versioned with the prompt; ops staff extend it [B6].
Changing this file changes PROMPT_VERSION semantics — bump it in prompts.py."""

GLOSSARY: list[tuple[str, str]] = [
    # Trucking / US compliance
    ("ELD", "electronic logging device; 'ELD ishlamayapti / не работает' = ELD not working"),
    ("HOS", "hours of service (driving-time limits)"),
    ("PTI / pre-trip", "pre-trip inspection"),
    ("BOL", "bill of lading (pickup document)"),
    ("POD", "proof of delivery (signed BOL at delivery)"),
    ("rate con / RC", "rate confirmation from the broker"),
    ("lumper", "paid unloading service; driver often needs reimbursement / receipt"),
    ("detention", "waiting time charge at shipper/receiver"),
    ("layover", "extra day charge when load is delayed"),
    ("TONU", "truck ordered not used (cancellation fee)"),
    ("deadhead", "driving empty"),
    ("bobtail", "tractor without a trailer"),
    ("reefer", "refrigerated trailer; 'reefer temp' issues are urgent"),
    ("OOS", "out of service (DOT) — P1"),
    ("DOT inspection / level 1", "roadside inspection — P1 if ongoing or violations"),
    ("IFTA", "fuel tax reporting"),
    ("settlement", "driver pay statement"),
    ("chargeback / deduction", "money deducted from driver pay"),
    ("fuel card / EFS / Comdata", "fuel payment card"),
    ("check call", "status update to dispatch (usually not a task)"),
    ("PM", "preventive maintenance"),
    ("tow / towing", "truck must be towed — P1"),
    ("blowout", "tire burst — P1"),
    ("DEF / regen / check engine", "engine/emissions problems"),
    # Uzbek (Latin / Cyrillic)
    ("aka / ака", "'brother', polite address — not a name"),
    ("ishlamayapti / ишламаяпти", "is not working"),
    ("buzildi / бузилди, siniq", "broke / is broken"),
    ("tuzatdim, to'g'riladim, qildim / туздим", "I fixed / I did it → completion claim"),
    ("bo'ldi / булди", "done / OK (context dependent)"),
    ("kerak / керак", "is needed"),
    ("tezroq / тезроқ, srochno / срочно", "urgent"),
    ("hozir / ҳозир", "now"),
    ("ertaga / эртага", "tomorrow"),
    ("bugun / бугун", "today"),
    ("pul / пул", "money"),
    ("chek / чек", "receipt"),
    ("yuk / юк", "load / cargo"),
    ("mashina / машина / moshina", "truck"),
    ("balon / shina", "tire"),
    ("moy / мой", "oil"),
    ("remont / ремонт", "repair"),
    ("tashlab bering / ташлаб беринг", "please send it (e.g. a document)"),
    ("rahmat / раҳмат, spasibo", "thanks — not a task"),
    # Russian
    ("не работает", "is not working"),
    ("сломался", "broke down"),
    ("сделал / готово", "done → completion claim"),
    ("скиньте / отправьте", "please send"),
    ("оплатите", "please pay"),
]


def render_glossary() -> str:
    return "\n".join(f"- {term}: {meaning}" for term, meaning in GLOSSARY)
