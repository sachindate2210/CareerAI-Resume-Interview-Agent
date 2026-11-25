"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { BrandLoader, BrandLogo, ThemeToggle } from "@/components/brand";
import { useAppSettings } from "@/lib/app-settings";
import { api } from "@/lib/api";
import { isAuthenticated, stopImpersonation } from "@/lib/auth";
import { type Action, type Module, can, hasAdminAccess, homeFor, isSuperAdmin } from "@/lib/permissions";
import type { UserRead } from "@/types/api";

export { homeFor } from "@/lib/permissions";

const SIDEBAR_KEY = "careerai_sidebar_collapsed";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Sparkles;
  exact?: boolean;
  visible: (u: UserRead | null) => boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true, visible: (u) => can(u, "dashboard", "view") },
  { href: "/admin/resumes", label: "Resumes", icon: FileText, visible: (u) => can(u, "resumes", "view") },
  { href: "/admin/users", label: "Users", icon: Users, visible: (u) => can(u, "users", "view") },
  { href: "/admin/roles", label: "Roles & Permissions", icon: ShieldCheck, visible: isSuperAdmin },
  { href: "/admin/settings", label: "Theme Configuration", icon: Palette, visible: isSuperAdmin },
  { href: "/optimizer", label: "Resume Optimizer", icon: Sparkles, visible: (u) => !hasAdminAccess(u) },
];

export function AppShell({
  children,
  requireAdmin = false,
  require,
  requireSuperAdmin = false,
}: {
  children: React.ReactNode;
  /** Any admin access at all. Prefer `require` for a specific permission. */
  requireAdmin?: boolean;
  require?: { module: Module; action: Action };
  requireSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hydrate, setUser, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const appName = useAppSettings((st) => st.settings.app_name);

  // Remember the collapsed sidebar per browser.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* storage blocked */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* storage blocked */
      }
      return !c;
    });
  }

  useEffect(() => {
    hydrate();
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    // Always re-read /me: roles and permissions can change while a session is open.
    api
      .get<UserRead>("/api/auth/me")
      .then((me) => {
        setUser(me);
        const ok =
          (!requireSuperAdmin || isSuperAdmin(me)) &&
          (!require || can(me, require.module, require.action)) &&
          (!requireAdmin || hasAdminAccess(me));
        if (ok) setAllowed(true);
        else router.replace(homeFor(me));
      })
      .catch(() => {
        /* 401s are handled inside api (refresh / back to login) */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function returnToAdmin() {
    stopImpersonation();
    // Full reload so every page re-reads the restored admin session.
    window.location.href = "/admin/users";
  }

  const nav = NAV.filter((item) => item.visible(user));
  const roleLabel = user?.is_admin ? "Super Admin" : user?.role?.name;
  const displayName = user?.full_name || user?.email || "";
  const initials =
    (user?.full_name || user?.email || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {user?.impersonator && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-warning px-4 py-2 text-sm text-white">
          <span className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Viewing as <strong>{user.full_name || user.email}</strong>
            <span className="opacity-80">· signed in as {user.impersonator.email}</span>
          </span>
          <button
            onClick={returnToAdmin}
            className="rounded-md bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30"
          >
            Return to admin
          </button>
        </div>
      )}
      <div className="flex flex-1">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col bg-[#0f1b2d] text-slate-300 shadow-xl transition-all duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none lg:[box-shadow:0_100vh_0_0_#0f1b2d,0_200vh_0_0_#0f1b2d]",
            collapsed ? "w-[76px]" : "w-64",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/* Brand */}
          <div className={cn("flex h-16 shrink-0 items-center border-b border-white/10", collapsed ? "justify-center px-2" : "px-5")}>
            <Link href={homeFor(user)} className="flex min-w-0 items-center" title={appName}>
              <BrandLogo variant="dark" compact={collapsed} className="min-w-0 text-white" />
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {nav.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname?.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg py-2.5 text-[15px] transition-colors",
                    collapsed ? "justify-center px-0" : "px-3.5",
                    active
                      ? "bg-[#1b3358] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                  <Icon className={cn("h-5 w-5 shrink-0", active ? "text-white" : "text-slate-400 group-hover:text-white")} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* Signed-in user */}
          <div className="shrink-0 border-t border-white/10 p-3">
            <div className={cn("flex items-center gap-3 rounded-lg px-2 py-2", collapsed && "justify-center px-0")} title={collapsed ? displayName : undefined}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                {initials}
              </span>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{displayName}</div>
                  <div className="truncate text-xs text-slate-400">{roleLabel ?? "User"}</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur lg:px-8">
            <div className="flex items-center gap-2">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label="Toggle navigation"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <button
                className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:flex"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <div className="hidden items-center gap-2.5 rounded-full border border-border py-1 pl-1 pr-3 sm:flex">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </span>
                <div className="leading-tight">
                  <div className="max-w-[160px] truncate text-sm font-medium">{displayName}</div>
                  <div className="text-xs text-muted-foreground">{roleLabel ?? "User"}</div>
                </div>
              </div>
              {user?.impersonator ? (
                <button
                  onClick={returnToAdmin}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <UserCog className="h-4 w-4" />
                  <span className="hidden sm:inline">Return to admin</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    logout();
                    router.replace("/login");
                  }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              )}
            </div>
          </header>
          <main className="flex flex-1 flex-col px-4 py-6 lg:px-8 lg:py-8">
            {allowed ? children : <BrandLoader className="flex-1 py-0" label="Loading…" />}
          </main>
        </div>
      </div>
    </div>
  );
}
