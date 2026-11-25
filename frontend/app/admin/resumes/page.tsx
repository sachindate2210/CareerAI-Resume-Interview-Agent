"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Files } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { type DataTableColumn, type ExportFormat, type SortOrder, DataTable, StatusTabs } from "@/components/data-table";
import { StatusBadge, scoreTone } from "@/components/resume-view";
import { api, ApiError } from "@/lib/api";
import { useAppSettings } from "@/lib/app-settings";
import { cn, formatDate } from "@/lib/utils";
import type { AdminResumeRow, Page, ResumeStatus } from "@/types/optimizer";

type Counts = { all: number; parsed: number; failed: number; pending: number };
type ResumePage = Page<AdminResumeRow> & { counts: Counts };
type Tab = "all" | ResumeStatus;

const TABS: { key: Tab; label: string; icon: typeof Files; tone: string }[] = [
  { key: "all", label: "All", icon: Files, tone: "bg-primary/10 text-primary" },
  { key: "parsed", label: "Parsed", icon: CheckCircle2, tone: "bg-success/10 text-success" },
  { key: "failed", label: "Failed", icon: AlertCircle, tone: "bg-destructive/10 text-destructive" },
  { key: "pending", label: "Pending", icon: Clock, tone: "bg-warning/10 text-warning" },
];

const COLUMNS: DataTableColumn<AdminResumeRow>[] = [
  {
    key: "filename",
    header: "Resume",
    sortKey: "filename",
    filterable: true,
    filterPlaceholder: "Filter by file name",
    className: "min-w-[220px]",
    cell: (r) => <span className="block max-w-xs truncate font-medium">{r.filename}</span>,
  },
  {
    key: "user",
    header: "User",
    sortKey: "user",
    filterable: true,
    filterPlaceholder: "Filter by name or email",
    className: "min-w-[200px]",
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate text-sm">{r.owner.full_name || "—"}</div>
        <div className="truncate text-xs text-muted-foreground">{r.owner.email}</div>
      </div>
    ),
  },
  { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
  {
    key: "score",
    header: "Score",
    sortKey: "score",
    align: "right",
    cell: (r) => <span className={cn("font-semibold tabular-nums", scoreTone(r.score))}>{r.score ?? "—"}</span>,
  },
  {
    key: "created_at",
    header: "Uploaded",
    sortKey: "created_at",
    className: "whitespace-nowrap",
    cell: (r) => <span className="text-sm text-muted-foreground">{formatDate(r.created_at)}</span>,
  },
];

export default function AdminResumesPage() {
  const router = useRouter();
  const defaultPageSize = useAppSettings((s) => s.settings.default_page_size);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ filename: "", user: "" });
  const [sort, setSort] = useState<{ key: string; order: SortOrder }>({ key: "created_at", order: "desc" });
  const [data, setData] = useState<ResumePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    api
      .get<ResumePage>("/api/admin/resumes", {
        page,
        page_size: pageSize,
        q: search || undefined,
        filename: filters.filename || undefined,
        user: filters.user || undefined,
        status: tab === "all" ? undefined : tab,
        sort: sort.key,
        order: sort.order,
      })
      .then((res) => {
        if (id !== requestId.current) return; // ignore out-of-order responses
        setData(res);
        setError(null);
      })
      .catch((err) => id === requestId.current && setError(err instanceof ApiError ? err.detail : "Failed to load resumes."))
      .finally(() => id === requestId.current && setLoading(false));
  }, [page, pageSize, search, filters, tab, sort]);

  useEffect(load, [load]);

  async function exportFile(format: ExportFormat) {
    try {
      const blob = await api.get<Blob>("/api/admin/resumes/export", {
        format,
        q: search || undefined,
        filename: filters.filename || undefined,
        user: filters.user || undefined,
        status: tab === "all" ? undefined : tab,
        sort: sort.key,
        order: sort.order,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resumes-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Export failed.");
    }
  }

  return (
    <AppShell require={{ module: "resumes", action: "view" }}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every resume uploaded by signed-in users. Click a row to open it.</p>
        </div>

        <StatusTabs
          tabs={TABS}
          active={tab}
          counts={data?.counts}
          onChange={(k) => {
            setTab(k);
            setPage(1);
          }}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DataTable
          columns={COLUMNS}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          loading={loading}
          sort={sort}
          filters={filters}
          search={search}
          searchPlaceholder="Search file, name or email…"
          emptyText={tab === "all" ? "No resumes match your search." : `No ${tab} resumes match your search.`}
          onRowClick={(r) => router.push(`/admin/resumes/${r.id}`)}
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
    </AppShell>
  );
}
