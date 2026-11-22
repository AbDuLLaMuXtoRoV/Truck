"""Load and trailer identifiers for cross-channel case linking (blueprint sec. 2): the same load or
trailer mentioned in a Telegram group and in an email should end up on one case."""

import re

_LOAD = [
    re.compile(r"(?:load|loads|ld|po|pro|bol|order|груз\w*|заказ\w*|yuk\w*)\s*(?:#|№|no\.?|number)?\s*:?\s*(\d{4,10})\b", re.IGNORECASE),
    re.compile(r"(?<![\w$])#\s?(\d{5,10})\b"),
]
_TRAILER = [
    re.compile(r"\b(?:trailer|trl|treyler|tirkama|прицеп\w*|трейлер\w*)\s*(?:#|№|no\.?)?\s*:?\s*([A-Z]{0,2}-?\d{3,6})\b", re.IGNORECASE),
    re.compile(r"\b(T-\d{3,6})\b"),
]


def extract_load_refs(text: str | None) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    for pattern in _LOAD:
        for m in pattern.finditer(text):
            if m.group(1) not in out:
                out.append(m.group(1))
    return out


def normalize_trailer(ref: str | None) -> str | None:
    if not ref:
        return None
    ref = ref.strip().upper().replace(" ", "")
    digits = re.sub(r"\D", "", ref)
    return f"T-{digits}" if digits else ref


def extract_trailer_refs(text: str | None) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    for pattern in _TRAILER:
        for m in pattern.finditer(text):
            ref = normalize_trailer(m.group(1))
            if ref and ref not in out:
                out.append(ref)
    return out
