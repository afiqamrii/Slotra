export const roles = ["OWNER", "ADMIN", "MANAGER", "STAFF", "VIEWER"] as const;
export type Role = (typeof roles)[number];
export const permissions = [
  "organization:view", "organization:update", "member:view", "member:invite",
  "member:update", "member:remove", "branch:view", "branch:manage",
  "resource:view", "resource:manage", "customer:view", "customer:manage",
  "booking:view", "booking:create", "booking:update", "booking:cancel", "booking:check_in",
  "payment:view", "payment:record_manual", "payment:refund", "payment:manage_settings",
  "report:view", "report:export", "report:manage_schedule",
] as const;
export type Permission = (typeof permissions)[number];

const access: Record<Role, readonly Permission[]> = {
  OWNER: permissions,
  ADMIN: permissions,
  MANAGER: ["organization:view", "member:view", "branch:view", "branch:manage", "resource:view", "resource:manage", "customer:view", "customer:manage", "booking:view", "booking:create", "booking:update", "booking:cancel", "booking:check_in", "payment:view", "payment:record_manual", "payment:refund", "report:view", "report:export"],
  STAFF: ["organization:view", "branch:view", "resource:view", "customer:view", "booking:view", "booking:create", "booking:update", "booking:cancel", "booking:check_in", "payment:view", "payment:record_manual"],
  VIEWER: ["organization:view", "branch:view", "resource:view", "booking:view", "payment:view"],
};

export function isRole(value: string): value is Role {
  return roles.some((role) => role === value);
}

export function hasPermission(role: string, permission: Permission) {
  return isRole(role) && access[role].includes(permission);
}



