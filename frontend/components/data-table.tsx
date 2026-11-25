"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SortOrder = "asc" | "desc";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Server-side sort key; omit to make the column unsortable. */
  sortKey?: string;
  /** Show an inline search box under the header for this column (value keyed by `key`). */
  filterable?: boolean;
  filterPlaceholder?: string;
  align?: "left" | "right" | "center";
  className?: string;
}

const PAGE_SIZES = [10, 20, 50, 100];

export type ExportFormat = "csv" | "xlsx" | "pdf";

const EXPORT_OPTIONS: { format: ExportFormat; label: string; hint: string; icon: typeof FileText; tone: string }[] = [
  { format: "xlsx", label: "Excel", hint: ".xlsx spreadsheet", icon: FileSpreadsheet, tone: "text-emerald-600" },
  { format: "csv", label: "CSV", hint: "Comma-separated values", icon: FileText, tone: "text-sky-600" },
  { format: "pdf", label: "PDF", hint: "Printable document", icon: FileText, tone: "text-rose-600" },
];

/** Export dropdown; exports every row matching the current filters (handled by the parent). */
function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function run(format: ExportFormat) {
    setBusy(format);
    try {
      await onExport(format);
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Export
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-lg">
          {EXPORT_OPTIONS.map(({ format, label, hint, icon: Icon, tone }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => run(format)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent disabled:opacity-60"
            >
              {busy === format ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className={cn("h-4 w-4", tone)} />}
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Text input that reports changes after the user stops typing. */
function DebouncedInput({
  value,
  onChange,
  placeholder,
  className,
  icon = true,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  icon?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={cn("relative", className)}>
      {icon && <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "h-8 w-full rounded-md border border-input bg-background pr-7 text-xs font-normal text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          icon ? "pl-8" : "pl-2.5"
        )}
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText("");
            onChange("");
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function pageWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
}

/**
 * Server-driven data table: global search, inline per-column filters, sortable headers,
 * page-size selector and numbered pagination. The parent owns state and fetching.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  loading,
  sort,
  filters,
  search,
  searchPlaceholder = "Search…",
  toolbar,
  emptyText = "No records found.",
  onRowClick,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onFilterChange,
  onSearchChange,
  onExport,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  sort: { key: string; order: SortOrder };
  filters: Record<string, string>;
  search: string;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sort: { key: string; order: SortOrder }) => void;
  onFilterChange: (key: string, value: string) => void;
  onSearchChange: (value: string) => void;
  /** Show the Export menu; the parent downloads the file for the given format. */
  onExport?: (format: ExportFormat) => Promise<void>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const hasFilters = columns.some((c) => c.filterable);
  const activeFilters = Object.values(filters).filter(Boolean).length + (search ? 1 : 0);
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortKey) return;
    if (sort.key !== col.sortKey) onSortChange({ key: col.sortKey, order: col.sortKey === "created_at" ? "desc" : "asc" });
    else onSortChange({ key: col.sortKey, order: sort.order === "asc" ? "desc" : "asc" });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Show
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          entries
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                Object.keys(filters).forEach((k) => filters[k] && onFilterChange(k, ""));
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Clear filters ({activeFilters})
            </button>
          )}
          {toolbar}
          <DebouncedInput value={search} onChange={onSearchChange} placeholder={searchPlaceholder} className="w-full sm:w-72 [&_input]:h-9 [&_input]:text-sm" />
          {onExport && <ExportMenu onExport={onExport} />}
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-x-auto">
        {loading && <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" />}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/40">
              {columns.map((col) => {
                const active = col.sortKey && sort.key === col.sortKey;
                const Icon = !active ? ArrowUpDown : sort.order === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.order === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground", align(col.align), col.className)}
                  >
                    {col.sortKey ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn(
                          "inline-flex items-center gap-1.5 uppercase hover:text-foreground",
                          active && "text-foreground",
                          col.align === "right" && "flex-row-reverse"
                        )}
                      >
                        {col.header}
                        <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
            {hasFilters && (
              <tr className="border-b border-border bg-secondary/20">
                {columns.map((col) => (
                  <th key={col.key} className={cn("px-4 py-2 font-normal", col.className)}>
                    {col.filterable && (
                      <DebouncedInput
                        icon={false}
                        value={filters[col.key] ?? ""}
                        onChange={(v) => onFilterChange(col.key, v)}
                        placeholder={col.filterPlaceholder ?? `Filter ${col.header.toLowerCase()}`}
                      />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border transition-colors last:border-0",
                  onRowClick && "cursor-pointer hover:bg-accent/50",
                  loading && "opacity-60"
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-3", align(col.align), col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center text-sm text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            )}
            {loading && rows.length === 0 &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-4">
                      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Showing <span className="font-medium text-foreground">{from}</span> to <span className="font-medium text-foreground">{to}</span> of{" "}
          <span className="font-medium text-foreground">{total}</span> entries
        </span>
        <nav className="flex items-center gap-1" aria-label="Pagination">
          {[
            { icon: ChevronsLeft, to: 1, label: "First page", disabled: page <= 1 },
            { icon: ChevronLeft, to: page - 1, label: "Previous page", disabled: page <= 1 },
          ].map(({ icon: Icon, to: target, label, disabled }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={() => onPageChange(target)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          {pageWindow(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`e-${i}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPageChange(p)}
                className={cn(
                  "h-8 min-w-8 rounded-md border px-2 text-sm font-medium",
                  p === page ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {p}
              </button>
            )
          )}
          {[
            { icon: ChevronRight, to: page + 1, label: "Next page", disabled: page >= totalPages },
            { icon: ChevronsRight, to: totalPages, label: "Last page", disabled: page >= totalPages },
          ].map(({ icon: Icon, to: target, label, disabled }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={() => onPageChange(target)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Underline tabs with count badges, used above data tables (status / segment filters). */
export function StatusTabs<K extends string>({
  tabs,
  active,
  counts,
  onChange,
}: {
  tabs: { key: K; label: string; icon: typeof Search; tone: string }[];
  active: K;
  counts?: Partial<Record<K, number>> | null;
  onChange: (key: K) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(({ key, label, icon: Icon, tone }) => {
        const selected = active === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition-colors",
              selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            <span
              className={cn(
                "min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums",
                selected ? tone : "bg-secondary text-muted-foreground"
              )}
            >
              {counts?.[key] ?? "–"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Fetch an export endpoint (with auth) and save the file. */
export async function downloadExport(path: string, query: Record<string, string | number | undefined>, fallbackName: string) {
  const { api } = await import("@/lib/api");
  const blob = await api.get<Blob>(path, query);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const [base, ext] = fallbackName.split(".");
  a.download = `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
