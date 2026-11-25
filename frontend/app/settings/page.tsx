"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/store";
import { getUser } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import type { UserRead } from "@/types/api";

export default function SettingsPage() {
  const router = useRouter();
  const { user, setUser, logout, hydrate } = useAuthStore();

  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
    const current = getUser();
    if (current) setFullName(current.full_name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) setFullName(user.full_name ?? "");
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      // NOTE: docs/API.md does not document a PATCH/PUT endpoint for updating
      // the current user's profile (no "update user" route under /api/auth).
      // Because there is no backend contract for persisting full_name, this
      // Save button only updates local state (and localStorage via the auth
      // store) for now — it does NOT call an undocumented PATCH endpoint.
      // We refresh from GET /api/auth/me (documented) so the UI reflects
      // whatever the server actually has, then merge the locally-edited name
      // on top for a responsive-feeling save.
      const refreshed = await api.get<UserRead>("/api/auth/me");
      setUser({ ...refreshed, full_name: fullName || refreshed.full_name });
      setSaveSuccess("Saved locally. Note: the backend has no endpoint yet to persist name changes.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.detail : "Failed to refresh profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your account details.
          </p>
        </div>

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} readOnly disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
              />
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
            {saveSuccess && <p className="text-sm text-success">{saveSuccess}</p>}

            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </CardContent>
        </Card>

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out of your account on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={handleLogout}>
              Log out
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
