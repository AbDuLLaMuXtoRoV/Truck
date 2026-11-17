"""Speech-to-text seam [B7].

The vendor is decided by the weeks 2-3 bake-off (100 real voice notes, Uzbek/Russian/English
code-switching, measured by WER and by how many tasks are missed). Until then the Null provider
marks voice messages as untranscribed; the AI still sees "[voice message, not transcribed]" and
can route the window to human review.
"""

from typing import Protocol


class TranscriptionUnavailable(Exception):
    pass


class Transcriber(Protocol):
    name: str

    async def transcribe(self, audio: bytes, mime_type: str | None) -> str: ...


class NullTranscriber:
    name = "none"

    async def transcribe(self, audio: bytes, mime_type: str | None) -> str:
        raise TranscriptionUnavailable("No speech-to-text provider configured")


_transcriber: Transcriber = NullTranscriber()


def get_transcriber() -> Transcriber:
    return _transcriber


def set_transcriber(transcriber: Transcriber) -> None:
    global _transcriber
    _transcriber = transcriber
