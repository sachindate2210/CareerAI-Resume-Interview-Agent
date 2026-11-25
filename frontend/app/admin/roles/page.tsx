"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleSlash, Loader2, Lock, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { type DataTableColumn, type SortOrder, DataTable, StatusTabs, downloadExport } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { useAppSettings } from "@/lib/app-settings";
import { cn, formatDate } from "@/lib/utils";
import type { AdminRole, PermissionCatalog } from "@/types/optimizer";

const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  manage: "Manage",
};

function apiError(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.detail : fallback;
}

function PermissionSummary({ role, catalog }: { role: AdminRole; catalog: PermissionCatalog | null }) {
  const entries = Object.entries(role.permissions);
  if (entries.length === 0) return <span className="text-sm text-muted-foreground">No admin access</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([module, actions]) => {
        const label = catalog?.modules.find((m) => m.key === module)?.label ?? module;
        const text = actions.includes("manage") ? "Full" : actions.map((a) => ACTION_LABELS[a] ?? a).join(", ");
        return (
          <Badge key={module} variant="outline" className="font-normal">
            <span className="font-medium">{label}</span>: {text}
          </Badge>
        );
      })}
    </div>
  );
}

function RoleDialog({
  open,
  onOpenChange,
  editing,
  catalog,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AdminRole | null;
  catalog: PermissionCatalog;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Record<string, string[]>>({});
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setPerms(editing?.permissions ?? {});
    setActive(editing?.is_active ?? true);
    setError(null);
  }, [open, editing]);

  function toggle(module: string, action: string, supported: string[]) {
    setPerms((prev) => {
      const current = new Set(prev[module] ?? []);
      if (action === "manage") {
        // Manage = everything on the module.
        if (current.has("manage")) current.clear();
        else supported.forEach((a) => current.add(a));
      } else {
        if (current.has(action)) {
          current.delete(action);
          current.delete("manage");
          // Without view, the other actions are unreachable in the UI.
          if (action === "view") current.clear();
        } else {
          current.add(action);
          current.add("view");
          if (supported.filter((a) => a !== "manage").every((a) => current.has(a)) && supported.includes("manage"))
            current.add("manage");
        }
      }
      return { ...prev, [module]: Array.from(current) };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Role name must be at least 2 characters.");
    setSaving(true);
    setError(null);
    const body = { name: name.trim(), description: description.trim() || null, permissions: perms, is_active: active };
    try {
      if (editing) await api.put(`/api/admin/roles/${editing.id}`, body);
      else await api.post("/api/admin/roles", body);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(apiError(err, "Could not save the role."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit role" : "Create role"}</DialogTitle>
          <DialogDescription>Choose which admin modules this role can use and what it can do in each.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="r-name">Role name</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Support" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-desc">Description</Label>
            <Textarea
              id="r-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className="min-h-[60px]"
              placeholder="Optional — what is this role for?"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Active</span>
                <span className="block text-xs text-muted-foreground">
                  Inactive roles grant no access. Users keep the role and get access back when it is re-activated.
                </span>
              </span>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            </label>
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-3 py-2 text-left font-medium">Module</th>
                    {catalog.actions.map((a) => (
                      <th key={a} className="px-3 py-2 text-center font-medium">
                        {ACTION_LABELS[a] ?? a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catalog.modules.map((m) => (
                    <tr key={m.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{m.label}</td>
                      {catalog.actions.map((a) => {
                        const supported = m.actions.includes(a);
                        return (
                          <td key={a} className="px-3 py-2 text-center">
                            {supported ? (
                              <input
                                type="checkbox"
                                aria-label={`${m.label}: ${ACTION_LABELS[a] ?? a}`}
                                className="h-4 w-4 accent-[hsl(var(--primary))]"
                                checked={perms[m.key]?.includes(a) ?? false}
                                onChange={() => toggle(m.key, a, m.actions)}
                              />
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage grants every action on a module, including impersonation for Users. Roles & Permissions itself is
              reserved for super admins.
            </p>
          </div>

          {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save role" : "Create role"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type RoleTab = "active" | "inactive";
const ROLE_TABS: { key: RoleTab; label: string; icon: typeof ShieldCheck; tone: string }[] = [
  { key: "active", label: "Active", icon: CheckCircle2, tone: "bg-success/10 text-success" },
  { key: "inactive", label: "Inactive", icon: CircleSlash, tone: "bg-destructive/10 text-destructive" },
];

// The built-in Super Admin role is per-user (User.is_admin), not a row in `roles`; shown as a locked row.
const SUPER_ADMIN_ID = "__super_admin__";
type RoleRow = AdminRole & { builtin?: boolean };

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<AdminRole[] | null>(null);
  const [superAdminCount, setSuperAdminCount] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [deleting, setDeleting] = useState<AdminRole | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const defaultPageSize = useAppSettings((st) => st.settings.default_page_size);
  const [tab, setTab] = useState<RoleTab>("active");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ name: "" });
  const [sort, setSort] = useState<{ key: string; order: SortOrder }>({ key: "name", order: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);

  const allRows = useMemo<RoleRow[]>(() => {
    if (!roles) return [];
    const superRow: RoleRow = {
      id: SUPER_ADMIN_ID,
      name: "Super Admin",
      description: "Built-in · full access to everything, including Roles & Permissions",
      permissions: {},
      user_count: superAdminCount ?? 0,
      created_at: "",
      is_active: true,
      builtin: true,
    };
    return [superRow, ...roles];
  }, [roles, superAdminCount]);

  const roleCounts = useMemo(
    () => ({ active: allRows.filter((r) => r.is_active).length, inactive: allRows.filter((r) => !r.is_active).length }),
    [allRows]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const nameTerm = filters.name.trim().toLowerCase();
    const list = allRows.filter(
      (r) =>
        r.is_active === (tab === "active") &&
        (!term || r.name.toLowerCase().includes(term) || (r.description ?? "").toLowerCase().includes(term)) &&
        (!nameTerm || r.name.toLowerCase().includes(nameTerm))
    );
    const dir = sort.order === "asc" ? 1 : -1;
    const value = (r: RoleRow): string | number =>
      sort.key === "users" ? r.user_count : sort.key === "created_at" ? r.created_at : sort.key === "permissions" ? Object.keys(r.permissions).length : r.name.toLowerCase();
    const sorted = [...list.filter((r) => !r.builtin)].sort((a, b) => (value(a) > value(b) ? dir : value(a) < value(b) ? -dir : 0));
    // Keep the built-in role pinned to the top.
    return [...list.filter((r) => r.builtin), ...sorted];
  }, [allRows, tab, search, filters, sort]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns: DataTableColumn<RoleRow>[] = [
    {
      key: "name",
      header: "Role",
      sortKey: "name",
      filterable: true,
      filterPlaceholder: "Filter by role name",
      className: "min-w-[200px]",
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          {r.builtin && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
              <ShieldCheck className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              {r.name}
              {r.builtin && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Built-in</span>}
            </div>
            {r.description && <div className="max-w-xs truncate text-xs text-muted-foreground">{r.description}</div>}
          </div>
        </div>
      ),
    },
    {
      key: "permissions",
      header: "Permissions",
      sortKey: "permissions",
      cell: (r) =>
        r.builtin ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
            All modules · Full access
          </span>
        ) : (
          <PermissionSummary role={r} catalog={catalog} />
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.is_active ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Inactive
          </span>
        ),
    },
    { key: "users", header: "Users", sortKey: "users", align: "right", cell: (r) => <span className="tabular-nums">{r.user_count}</span> },
    {
      key: "created_at",
      header: "Created",
      sortKey: "created_at",
      className: "whitespace-nowrap",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.builtin ? "System" : formatDate(r.created_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (r) =>
        r.builtin ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Built-in role can't be edited or deleted. Grant it from Users.">
            <Lock className="h-3.5 w-3.5" /> Locked
          </span>
        ) : (
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Edit"
            aria-label={`Edit ${r.name}`}
            disabled={!catalog}
            onClick={() => {
              setEditing(r);
              setDialogOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="Delete"
            aria-label={`Delete ${r.name}`}
            onClick={() => {
              setDeleteError(null);
              setDeleting(r);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        ),
    },
  ];

  const load = useCallback(() => {
    api
      .get<AdminRole[]>("/api/admin/roles")
      .then(setRoles)
      .catch((err) => setError(apiError(err, "Failed to load roles.")));
    api
      .get<{ counts: { super_admin: number } }>("/api/admin/users", { page_size: 1 })
      .then((res) => setSuperAdminCount(res.counts.super_admin))
      .catch(() => setSuperAdminCount(null));
  }, []);

  useEffect(() => {
    load();
    api.get<PermissionCatalog>("/api/admin/roles/catalog").then(setCatalog).catch(() => setCatalog(null));
  }, [load]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.del(`/api/admin/roles/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (err) {
      setDeleteError(apiError(err, "Could not delete the role."));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell requireSuperAdmin>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Roles & Permissions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Define what each role can see and do in the admin panel, then assign roles from Users.
            </p>
          </div>
          <Button
            disabled={!catalog}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Create role
          </Button>
        </div>

        <StatusTabs
          tabs={ROLE_TABS}
          active={tab}
          counts={roleCounts}
          onChange={(k) => {
            setTab(k);
            setPage(1);
          }}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          loading={roles === null}
          sort={sort}
          filters={filters}
          search={search}
          searchPlaceholder="Search roles…"
          emptyText={roles && roles.length === 0 ? "No custom roles yet. Create one to give someone limited admin access." : "No roles match your search."}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          onSortChange={setSort}
          onFilterChange={(key, value) => {
            setFilters((f) => ({ ...f, [key]: value }));
            setPage(1);
          }}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          onExport={async (format) => {
            try {
              await downloadExport("/api/admin/roles/export", { format, q: search || filters.name || undefined, tab }, `roles.${format}`);
            } catch (err) {
              setError(apiError(err, "Export failed."));
            }
          }}
        />
      </div>

      {catalog && (
        <RoleDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} catalog={catalog} onSaved={load} />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete role?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.user_count > 0
                ? `“${deleting.name}” is assigned to ${deleting.user_count} user${deleting.user_count === 1 ? "" : "s"}. Reassign them before deleting it.`
                : `“${deleting?.name}” will be permanently deleted.`}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{deleteError}</div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy || (deleting?.user_count ?? 0) > 0}>
              {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete role
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
