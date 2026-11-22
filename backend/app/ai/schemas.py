"""Structured-output schema the model must return. Every field is required (nullable where
optional) so the schema is valid for strict structured outputs."""

from typing import Literal

from pydantic import BaseModel, Field

CategoryLit = Literal[
    "eld", "dispatch", "fleet_maintenance", "accounting", "documents", "safety_compliance", "hr", "trailer", "other"
]
PriorityLit = Literal["P1", "P2", "P3", "P4"]
UpdateKindLit = Literal["progress", "completion_claim", "blocker", "duplicate_report"]
IssueTypeLit = Literal[
    "detention", "lumper", "breakdown", "tire", "eld_error", "hos_violation", "pod_missing", "bol_missing",
    "rate_confirmation", "invoice", "payment", "settlement", "fuel_card", "accident", "inspection",
    "trailer_return", "trailer_damage", "load_change", "appointment", "reefer", "documents", "other",
]
MessageLabelLit = Literal["actionable", "informational", "automated", "duplicate", "spam"]


class MessageLabel(BaseModel):
    ref: str = Field(description="Ref of a NEW message, e.g. 'm4'.")
    label: MessageLabelLit
    requires_response: bool = Field(description="True if a human at the company should reply to this message.")


class NewTask(BaseModel):
    source_refs: list[str] = Field(description="Refs (e.g. 'm4') of the NEW messages this task comes from.")
    title: str = Field(description="Short imperative English title, max 80 chars, e.g. 'Fix ELD connection on truck 125'.")
    summary: str = Field(description="1-3 sentence English summary with the key facts (who, what, amounts, places).")
    title_uz: str = Field(description="The same title in natural Uzbek, Latin script.")
    summary_uz: str = Field(description="The same summary in natural Uzbek, Latin script.")
    title_ru: str = Field(description="The same title in natural Russian.")
    summary_ru: str = Field(description="The same summary in natural Russian.")
    category: CategoryLit
    issue_type: IssueTypeLit
    priority: PriorityLit
    truck_unit: str | None = Field(description="Truck/unit number if known, digits only, else null.")
    trailer_ref: str | None = Field(description="Trailer number as written (e.g. 'T-1192'), else null.")
    load_reference: str | None = Field(description="Load / PO / BOL number if mentioned, else null.")
    driver_name: str | None = Field(description="Driver's name if known, else null.")
    amount: float | None = Field(description="Money amount in USD involved (charge, fee, invoice), else null.")
    deadline_iso: str | None = Field(description="Explicit deadline stated in the chat as ISO-8601 with offset, else null.")
    assignee_hint: str | None = Field(description="Name/@username of the person asked to act, if explicit, else null.")
    why_task: str = Field(description="One short sentence: why this is an actionable task.")
    confidence: float = Field(description="0.0-1.0 confidence that this is a real, new, actionable task.")


class TaskUpdate(BaseModel):
    task_code: str = Field(description="Code of an existing open task from <open_tasks>, e.g. 'T-12'.")
    source_refs: list[str] = Field(description="Refs of the NEW messages that carry this update.")
    kind: UpdateKindLit
    note: str = Field(description="Short English note describing the update.")
    confidence: float = Field(description="0.0-1.0 confidence that the messages refer to this task.")


class ExtractionResult(BaseModel):
    message_labels: list[MessageLabel]
    new_tasks: list[NewTask]
    task_updates: list[TaskUpdate]
