"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, UserCheck, UserCog, UserX, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { type DataTableColumn, type ExportFormat, type SortOrder, DataTable, StatusTabs, downloadExport } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useAppSettings } from "@/lib/app-settings";
import { startImpersonation } from "@/lib/auth";
import { can, homeFor, isSuperAdmin } from "@/lib/permissions";
import { useAuthStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import type { UserRead } from "@/types/api";
import type { AdminRole, AdminUser, Page } from "@/types/optimizer";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function apiError(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.detail : fallback;
}

type FormState = {
  full_name: string;
  email: string;
  password: string;
  is_active: boolean;
  is_admin: boolean;
  role_id: string;
};

function UserFormDialog({
  open,
  onOpenChange,
  editing,
  roles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AdminUser | null;
  roles: AdminRole[];
  onSaved: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const superAdmin = isSuperAdmin(me);
  const isSelf = !!editing && editing.id === me?.id;
  const [form, setForm] = useState<FormState>({
    full_name: "",
    email: "",
    password: "",
    is_active: true,
    is_admin: false,
    role_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      full_name: editing?.full_name ?? "",
      email: editing?.email ?? "",
      password: "",
      is_active: editing?.is_active ?? true,
      is_admin: editing?.is_admin ?? false,
      role_id: editing?.role?.id ?? "",
    });
  }, [open, editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.email.trim()) return setError("Email is required.");
    if (!editing && form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (editing && form.password && form.password.length < 8) return setError("New password must be at least 8 characters.");

    const body: Record<string, unknown> = {
      full_name: form.full_name.trim() || null,
      email: form.email.trim(),
    };
    if (!isSelf) body.is_active = form.is_active;
    if (form.password) body.password = form.password;
    if (superAdmin) {
      body.role_id = form.role_id || null;
      if (!isSelf) body.is_admin = form.is_admin;
    }

    setSaving(true);
    try {
      if (editing) await api.patch(`/api/admin/users/${editing.id}`, body);
      else await api.post("/api/admin/users", body);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(apiError(err, "Could not save the user."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update profile, access and status." : "Create an account and choose what they can access."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={255} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-password">{editing ? "New password" : "Password"}</Label>
            <Input
              id="u-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={editing ? "Leave blank to keep the current password" : "At least 8 characters"}
            />
          </div>

          {superAdmin ? (
            <div className="space-y-2">
              <Label htmlFor="u-role">Role</Label>
              <select
                id="u-role"
                className={selectClass}
                value={form.role_id}
                onChange={(e) => set("role_id", e.target.value)}
                disabled={form.is_admin}
              >
                <option value="">No role (regular user)</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.is_active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
              {form.is_admin && <p className="text-xs text-muted-foreground">Super admins already have every permission.</p>}
            </div>
          ) : (
            editing && (
              <p className="text-sm text-muted-foreground">
                Role: <span className="font-medium text-foreground">{editing.role?.name ?? "No role"}</span>. Only a super admin can change roles.
              </p>
            )
          )}

          <div className="space-y-3 rounded-md border border-border p-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Active</span>
                <span className="block text-xs text-muted-foreground">Inactive users can&apos;t sign in.</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={form.is_active}
                disabled={isSelf}
                onChange={(e) => set("is_active", e.target.checked)}
              />
            </label>
            {superAdmin && (
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">Super admin</span>
                  <span className="block text-xs text-muted-foreground">Full access, including roles & permissions.</span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={form.is_admin}
                  disabled={isSelf}
                  onChange={(e) => set("is_admin", e.target.checked)}
                />
              </label>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create user"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  target,
  title,
  description,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  target: AdminUser | null;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [target]);

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (err) {
                setError(apiError(err, "Something went wrong."));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type UserTab = "active" | "inactive";
type UserCounts = Record<UserTab, number>;
type UserPage = Page<AdminUser> & { counts: UserCounts };

const USER_TABS: { key: UserTab; label: string; icon: typeof Users; tone: string }[] = [
  { key: "active", label: "Active", icon: UserCheck, tone: "bg-success/10 text-success" },
  { key: "inactive", label: "Inactive", icon: UserX, tone: "bg-destructive/10 text-destructive" },
];

export default function AdminUsersPage() {
  const me = useAuthStore((s) => s.user);
  const superAdmin = isSuperAdmin(me);
  const defaultPageSize = useAppSettings((s) => s.settings.default_page_size);
  const [data, setData] = useState<UserPage | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [tab, setTab] = useState<UserTab>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ name: "", email: "", role: "" });
  const [sort, setSort] = useState<{ key: string; order: SortOrder }>({ key: "created_at", order: "desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [impersonating, setImpersonating] = useState<AdminUser | null>(null);

  const params = useCallback(
    () => ({
      q: search || undefined,
      name: filters.name || undefined,
      email: filters.email || undefined,
      role: filters.role || undefined,
      tab,
      sort: sort.key,
      order: sort.order,
    }),
    [search, filters, tab, sort]
  );

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    api
      .get<UserPage>("/api/admin/users", { ...params(), page, page_size: pageSize })
      .then((res) => {
        if (id !== requestId.current) return;
        setData(res);
        setError(null);
      })
      .catch((err) => id === requestId.current && setError(apiError(err, "Failed to load users.")))
      .finally(() => id === requestId.current && setLoading(false));
  }, [params, page, pageSize]);

  useEffect(load, [load]);

  useEffect(() => {
    if (superAdmin) api.get<AdminRole[]>("/api/admin/roles").then(setRoles).catch(() => setRoles([]));
  }, [superAdmin]);

  const canCreate = can(me, "users", "create");
  const canEdit = can(me, "users", "edit");
  const canDelete = can(me, "users", "delete");
  const canImpersonate = can(me, "users", "manage") && !me?.impersonator;

  // Mirror the server rules so we don't offer actions that will be refused.
  const editable = (u: AdminUser) => canEdit && (!u.is_admin || superAdmin);
  const deletable = (u: AdminUser) => canDelete && u.id !== me?.id && (!u.is_admin || superAdmin);
  const impersonatable = (u: AdminUser) =>
    canImpersonate && u.id !== me?.id && u.is_active && !u.is_admin && (superAdmin || !u.role);

  async function impersonate(user: AdminUser) {
    const res = await api.post<{ access_token: string }>(`/api/admin/users/${user.id}/impersonate`);
    startImpersonation(res.access_token);
    const target = await api.get<UserRead>("/api/auth/me");
    window.location.href = homeFor(target);
  }

  async function exportFile(format: ExportFormat) {
    try {
      await downloadExport("/api/admin/users/export", { ...params(), format }, `users.${format}`);
    } catch (err) {
      setError(apiError(err, "Export failed."));
    }
  }

  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: "name",
      header: "Name",
      sortKey: "name",
      filterable: true,
      filterPlaceholder: "Filter by name",
      className: "min-w-[180px]",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {(u.full_name || u.email).slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate font-medium">
            {u.full_name || "—"}
            {u.id === me?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
          </span>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      sortKey: "email",
      filterable: true,
      filterPlaceholder: "Filter by email",
      className: "min-w-[200px]",
      cell: (u) => <span className="text-sm">{u.email}</span>,
    },
    {
      key: "role",
      header: "Role",
      sortKey: "role",
      filterable: true,
      filterPlaceholder: "Filter by role",
      cell: (u) =>
        u.is_admin ? <Badge>Super Admin</Badge> : u.role ? <Badge variant="outline">{u.role.name}</Badge> : <Badge variant="secondary">User</Badge>,
    },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      cell: (u) =>
        u.is_active ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Inactive
          </span>
        ),
    },
    { key: "resumes", header: "Resumes", sortKey: "resumes", align: "right", cell: (u) => <span className="tabular-nums">{u.resume_count}</span> },
    {
      key: "created_at",
      header: "Joined",
      sortKey: "created_at",
      className: "whitespace-nowrap",
      cell: (u) => <span className="text-sm text-muted-foreground">{formatDate(u.created_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (u) => (
        <div className="flex justify-end gap-1">
          {editable(u) && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Edit"
              aria-label={`Edit ${u.email}`}
              onClick={() => {
                setEditing(u);
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {impersonatable(u) && (
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Impersonate" aria-label={`Impersonate ${u.email}`} onClick={() => setImpersonating(u)}>
              <UserCog className="h-4 w-4" />
            </Button>
          )}
          {deletable(u) && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Delete"
              aria-label={`Delete ${u.email}`}
              onClick={() => setDeleting(u)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell require={{ module: "users", action: "view" }}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage accounts, roles and access.</p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add user
            </Button>
          )}
        </div>

        <StatusTabs
          tabs={USER_TABS}
          active={tab}
          counts={data?.counts}
          onChange={(k) => {
            setTab(k);
            setPage(1);
          }}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(u) => u.id}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          loading={loading}
          sort={sort}
          filters={filters}
          search={search}
          searchPlaceholder="Search name, email or role…"
          emptyText="No users match your search."
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          onFilterChange={(key, value) => {
            setFilters((f) => ({ ...f, [key]: value }));
            setPage(1);
          }}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          onExport={exportFile}
        />
      </div>

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} roles={roles} onSaved={load} />

      <ConfirmDialog
        target={deleting}
        title="Delete user?"
        description={
          <>
            This permanently deletes <strong>{deleting?.email}</strong> and all of their resumes. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete user"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          await api.del(`/api/admin/users/${deleting!.id}`);
          setDeleting(null);
          load();
        }}
      />

      <ConfirmDialog
        target={impersonating}
        title="Impersonate user?"
        description={
          <>
            You&apos;ll see the app exactly as <strong>{impersonating?.email}</strong> does, for up to 30 minutes. Use
            &ldquo;Return to admin&rdquo; to switch back.
          </>
        }
        confirmLabel="Start impersonating"
        onCancel={() => setImpersonating(null)}
        onConfirm={() => impersonate(impersonating!)}
      />
    </AppShell>
  );
}
