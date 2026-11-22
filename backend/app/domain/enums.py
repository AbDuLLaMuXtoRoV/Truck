from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MANAGER = "manager"
    DEPT_LEAD = "dept_lead"
    AGENT = "agent"
    VIEWER = "viewer"


class TaskStatus(StrEnum):
    DETECTED = "detected"
    NEEDS_REVIEW = "needs_review"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    PENDING_VERIFICATION = "pending_verification"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


OPEN_STATUSES: frozenset[TaskStatus] = frozenset(
    {
        TaskStatus.DETECTED,
        TaskStatus.NEEDS_REVIEW,
        TaskStatus.ASSIGNED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.BLOCKED,
        TaskStatus.PENDING_VERIFICATION,
    }
)


class TaskCategory(StrEnum):
    ELD = "eld"
    DISPATCH = "dispatch"
    FLEET_MAINTENANCE = "fleet_maintenance"
    ACCOUNTING = "accounting"
    DOCUMENTS = "documents"
    SAFETY_COMPLIANCE = "safety_compliance"
    HR = "hr"
    TRAILER = "trailer"
    OTHER = "other"


# Default category -> department code routing (spec v1.1 §3)
CATEGORY_DEPARTMENT: dict[TaskCategory, str | None] = {
    TaskCategory.ELD: "ELD",
    TaskCategory.DISPATCH: "DISPATCH",
    TaskCategory.FLEET_MAINTENANCE: "FLEET",
    TaskCategory.ACCOUNTING: "ACCOUNTING",
    TaskCategory.DOCUMENTS: "ACCOUNTING",
    TaskCategory.SAFETY_COMPLIANCE: "SAFETY",
    TaskCategory.HR: "HR",
    TaskCategory.TRAILER: "TRAILER",
    TaskCategory.OTHER: None,
}


class Priority(StrEnum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"


class TaskSource(StrEnum):
    AI = "ai"
    MANUAL = "manual"
    TELEGRAM_COMMAND = "telegram_command"


class ActorKind(StrEnum):
    USER = "user"
    AI = "ai"
    SYSTEM = "system"


class TaskEventType(StrEnum):
    CREATED = "created"
    STATUS_CHANGED = "status_changed"
    REOPENED = "reopened"
    ASSIGNED = "assigned"
    UPDATED = "updated"
    COMMENT = "comment"
    MESSAGE_LINKED = "message_linked"
    AI_UPDATE = "ai_update"
    MERGED = "merged"
    REMINDER = "reminder"
    ESCALATED = "escalated"


class TaskMessageRelation(StrEnum):
    SOURCE = "source"
    CONTEXT = "context"
    UPDATE = "update"
    DUPLICATE = "duplicate"
    EVIDENCE = "evidence"


class GroupKind(StrEnum):
    TRUCK = "truck"
    DEPARTMENT = "department"
    DISPATCH = "dispatch"
    OTHER = "other"


class BotMembership(StrEnum):
    MEMBER = "member"
    ADMINISTRATOR = "administrator"
    LEFT = "left"
    KICKED = "kicked"


class MessageKind(StrEnum):
    TEXT = "text"
    VOICE = "voice"
    AUDIO = "audio"
    PHOTO = "photo"
    DOCUMENT = "document"
    VIDEO = "video"
    STICKER = "sticker"
    OTHER = "other"


class AnalysisStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


class AttachmentStatus(StrEnum):
    PENDING = "pending"
    DOWNLOADED = "downloaded"
    TOO_LARGE = "too_large"
    FAILED = "failed"


class TranscriptStatus(StrEnum):
    NOT_NEEDED = "not_needed"
    PENDING = "pending"
    DONE = "done"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


class NotificationChannel(StrEnum):
    DASHBOARD = "dashboard"
    TELEGRAM_DM = "telegram_dm"


class NotificationKind(StrEnum):
    ASSIGNED = "assigned"
    REVIEW_NEEDED = "review_needed"
    REMINDER = "reminder"
    ESCALATION = "escalation"
    VERIFICATION_NEEDED = "verification_needed"
    RESPONSE_REMINDER = "response_reminder"  # 3 min: team
    RESPONSE_OVERDUE = "response_overdue"  # 5 min: supervisor
    RESPONSE_ESCALATED = "response_escalated"  # 10 min: manager / owner
    CRITICAL = "critical"  # safety-critical: immediately
    HANDOVER = "handover"
    COVERAGE_GAP = "coverage_gap"


class NotificationStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    READ = "read"


class TaskUpdateKind(StrEnum):
    PROGRESS = "progress"
    COMPLETION_CLAIM = "completion_claim"
    BLOCKER = "blocker"
    DUPLICATE_REPORT = "duplicate_report"
