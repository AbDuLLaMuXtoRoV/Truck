"""TMS adapter (blueprint sec. 3). Today: CSV export import; a vendor API adapter implements the same
protocol once the TMS vendor and its API access are known (blueprint sec. 12 open decision)."""

import csv
import io
import uuid
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.identifiers import normalize_trailer
from app.domain.truck_refs import normalize_unit
from app.models import Load, Truck, utcnow

_COLUMNS = {
    "load_ref": ("load_ref", "load", "load #", "load#", "load number", "load no", "order", "pro", "po"),
    "truck": ("truck", "unit", "truck #", "unit #", "tractor"),
    "trailer": ("trailer", "trailer #", "trl"),
    "driver_name": ("driver", "driver_name", "driver name"),
    "driver_phone": ("driver_phone", "phone", "driver phone"),
    "broker": ("broker", "customer", "shipper"),
    "status": ("status", "load status"),
    "pickup": ("pickup", "origin", "pick up", "from"),
    "delivery": ("delivery", "destination", "drop", "to"),
}


@dataclass
class LoadRecord:
    load_ref: str
    truck: str | None = None
    trailer: str | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    broker: str | None = None
    status: str | None = None
    pickup: str | None = None
    delivery: str | None = None


class TmsAdapter(Protocol):
    name: str

    async def fetch_loads(self) -> list[LoadRecord]: ...


def parse_csv(text: str) -> tuple[list[LoadRecord], list[str]]:
    errors: list[str] = []
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    header_map: dict[str, str] = {}
    for h in reader.fieldnames or []:
        key = h.strip().lower()
        for field, names in _COLUMNS.items():
            if key in names and field not in header_map.values():
                header_map[h] = field
    if "load_ref" not in header_map.values():
        return [], ["CSV needs a load number column (e.g. 'load', 'load #' or 'load_ref')"]
    records: list[LoadRecord] = []
    for i, row in enumerate(reader, start=2):
        values = {header_map[k]: (v or "").strip() for k, v in row.items() if k in header_map}
        if not values.get("load_ref"):
            errors.append(f"line {i}: empty load number")
            continue
        records.append(LoadRecord(**{k: (v or None) for k, v in values.items()}))
    return records, errors


async def upsert_loads(session: AsyncSession, company_id: uuid.UUID, records: list[LoadRecord], source: str = "csv") -> tuple[int, int]:
    trucks = {normalize_unit(t.unit_number): t for t in (await session.scalars(select(Truck).where(Truck.company_id == company_id))).all()}
    existing = {ld.load_ref: ld for ld in (await session.scalars(
        select(Load).where(Load.company_id == company_id, Load.load_ref.in_([r.load_ref for r in records])))).all()}
    created = updated = 0
    for r in records:
        load = existing.get(r.load_ref)
        if load is None:
            load = Load(id=uuid.uuid4(), company_id=company_id, load_ref=r.load_ref, source=source)
            session.add(load)
            existing[r.load_ref] = load
            created += 1
        else:
            updated += 1
        truck = trucks.get(normalize_unit(r.truck)) if r.truck else None
        load.truck_unit = r.truck or load.truck_unit
        load.truck_id = truck.id if truck else load.truck_id
        load.trailer_ref = normalize_trailer(r.trailer) or load.trailer_ref
        for attr in ("driver_name", "driver_phone", "broker", "status", "pickup", "delivery"):
            value = getattr(r, attr)
            if value:
                setattr(load, attr, value)
        load.updated_at = utcnow()
    await session.flush()
    return created, updated
