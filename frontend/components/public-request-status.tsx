import { Badge } from "@/components/ui/badge";
import type { PublicRequestStatus } from "@/types/optimizer";

const VARIANTS: Record<PublicRequestStatus, "success" | "destructive" | "warning" | "secondary"> = {
  completed: "success",
  failed: "destructive",
  processing: "warning",
  pending: "secondary",
};

export function PublicStatusBadge({ status }: { status: PublicRequestStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}

export { formatDateTime } from "@/lib/app-settings";

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
