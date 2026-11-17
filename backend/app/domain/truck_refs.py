"""Deterministic truck-number extraction. Used as a hint for the AI and to validate its output.

Only keyword-anchored numbers count ("truck 125", "#125", "125-mashina", "трак 125") — a bare
"250" is far more often a dollar amount or a mile count than a unit number.
"""

import re

_KEYWORDS = (
    r"truck|trk|unit|tractor|trak|mashina|moshina|mashinasi|"
    r"трак|трака|траке|грузовик|машина|машины|юнит"
)
_NUM = r"(\d{2,5})"

_PATTERNS = [
    re.compile(rf"(?:{_KEYWORDS})\s*(?:#|№|no\.?|n\.)?\s*-?\s*{_NUM}\b", re.IGNORECASE),
    re.compile(rf"(?<![\w$])[#№]\s?{_NUM}\b"),
    re.compile(rf"\b{_NUM}\s*-?\s*(?:{_KEYWORDS})", re.IGNORECASE),
]


def normalize_unit(unit: str | None) -> str | None:
    if unit is None:
        return None
    digits = re.sub(r"\D", "", unit)
    if digits:
        return digits.lstrip("0") or "0"
    cleaned = unit.strip().upper()
    return cleaned or None


def extract_truck_refs(text: str | None) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    for pattern in _PATTERNS:
        for match in pattern.finditer(text):
            unit = normalize_unit(match.group(1))
            if unit and unit not in found:
                found.append(unit)
    return found


def resolve_unit(raw: str | None, known_units: dict[str, object]) -> object | None:
    """Map an extracted unit to a known truck. `known_units` is keyed by normalize_unit(unit_number)."""
    key = normalize_unit(raw)
    if key is None:
        return None
    return known_units.get(key)
