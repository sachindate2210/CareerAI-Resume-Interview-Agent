"""Permission catalog for the admin panel.

A role stores `{module: [action, ...]}`. Super admins (`User.is_admin`) implicitly hold every
permission and are the only ones who can manage roles or grant roles/super-admin, so a role
holder can never escalate their own access. `manage` on a module implies every action on it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User

ACTIONS: tuple[str, ...] = ("view", "create", "edit", "delete", "manage")

# module -> (label, actions that are meaningful for it)
MODULES: dict[str, tuple[str, tuple[str, ...]]] = {
    "dashboard": ("Dashboard", ("view",)),
    "resumes": ("Resumes", ("view", "delete", "manage")),
    "users": ("Users", ("view", "create", "edit", "delete", "manage")),
}


def normalize_permissions(raw: dict | None) -> dict[str, list[str]]:
    """Drop unknown modules/actions and order actions consistently."""
    clean: dict[str, list[str]] = {}
    for module, actions in (raw or {}).items():
        if module not in MODULES or not isinstance(actions, list):
            continue
        allowed = MODULES[module][1]
        kept = [a for a in ACTIONS if a in actions and a in allowed]
        if kept:
            clean[module] = kept
    return clean


def all_permissions() -> dict[str, list[str]]:
    return {module: list(actions) for module, (_, actions) in MODULES.items()}


def effective_permissions(user: "User") -> dict[str, list[str]]:
    if user.is_admin:
        return all_permissions()
    if user.role is None or not user.role.is_active:
        return {}
    perms = normalize_permissions(user.role.permissions)
    # `manage` expands to every action the module supports.
    return {m: list(MODULES[m][1]) if "manage" in a else a for m, a in perms.items()}


def has_permission(user: "User", module: str, action: str) -> bool:
    if user.is_admin:
        return True
    return action in effective_permissions(user).get(module, [])
