"""Cheap text similarity used as the deterministic duplicate backstop [B12].

The AI normalises task titles/summaries to English, so a token-set comparison works well enough;
the primary dedupe signal is the model itself seeing the open tasks.
"""

import re
from difflib import SequenceMatcher

_STOP = frozenset(
    "a an the to of for in on at is are be with and or from by it this that please pls need needs "
    "truck unit driver check fix issue problem".split()
)
_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1}


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    ta, tb = _tokens(a), _tokens(b)
    jaccard = len(ta & tb) / len(ta | tb) if ta and tb else 0.0
    seq = SequenceMatcher(None, a.lower(), b.lower()).ratio()
    return max(jaccard, seq * 0.9)
