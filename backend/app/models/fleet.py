import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin, IdMixin, TenantMixin


class Truck(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "trucks"
    __table_args__ = (UniqueConstraint("company_id", "unit_number"),)

    unit_number: Mapped[str] = mapped_column(String(32))
    vin: Mapped[str | None] = mapped_column(String(32))
    plate: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(default=True)


class Driver(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "drivers"

    full_name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(default=True)


class TruckDriverAssignment(IdMixin, TenantMixin, CreatedMixin, Base):
    """Drivers change trucks; history matters for "who was driving 125 on the 3rd" [C7]."""

    __tablename__ = "truck_driver_assignments"

    truck_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trucks.id", ondelete="CASCADE"), index=True)
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id", ondelete="CASCADE"), index=True)
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime | None]
