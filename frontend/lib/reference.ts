"use client";

import { useMemo } from "react";
import { paths } from "./api";
import { useApi } from "./hooks";
import type { DepartmentOut, TruckOut, UserOut } from "./types";

function byUnit(a: TruckOut, b: TruckOut): number {
  return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
}

/** Departments, trucks and users for selects and id -> name lookups (cached across screens). */
export function useReference() {
  const departments = useApi<DepartmentOut[]>(paths.departments());
  const trucks = useApi<TruckOut[]>(paths.trucks());
  // active=false returns inactive users too, so historic assignees still resolve to names
  const users = useApi<UserOut[]>(paths.users({ active: false }));

  return useMemo(() => {
    const deptList = departments.data ?? [];
    const truckList = [...(trucks.data ?? [])].sort(byUnit);
    const userList = users.data ?? [];
    return {
      departments: deptList,
      trucks: truckList,
      users: userList,
      activeUsers: userList.filter((u) => u.is_active),
      departmentById: new Map(deptList.map((d) => [d.id, d])),
      truckById: new Map(truckList.map((t) => [t.id, t])),
      userById: new Map(userList.map((u) => [u.id, u])),
      departmentByCode: new Map(deptList.map((d) => [d.code, d])),
      reloadTrucks: trucks.reload,
    };
  }, [departments.data, trucks.data, users.data, trucks.reload]);
}

export type Reference = ReturnType<typeof useReference>;
