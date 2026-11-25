import type { UserRead } from "@/types/api";

export type Module = "dashboard" | "resumes" | "users";
export type Action = "view" | "create" | "edit" | "delete" | "manage";

// UI-only checks that mirror app/core/permissions.py. The backend enforces every action.
export function can(user: UserRead | null | undefined, module: Module, action: Action): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  return !!user.permissions?.[module]?.includes(action);
}

export function isSuperAdmin(user: UserRead | null | undefined): boolean {
  return !!user?.is_admin;
}

export function hasAdminAccess(user: UserRead | null | undefined): boolean {
  if (!user) return false;
  return !!user.is_admin || Object.values(user.permissions ?? {}).some((actions) => actions.length > 0);
}

/** Where to send a user after login: first admin page they can see, else the optimizer. */
export function homeFor(user: UserRead | null | undefined): string {
  if (can(user, "dashboard", "view")) return "/admin";
  if (can(user, "resumes", "view")) return "/admin/resumes";
  if (can(user, "users", "view")) return "/admin/users";
  return "/optimizer";
}
