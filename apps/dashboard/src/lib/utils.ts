export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDuration(start?: string | null, end?: string | null, fallbackMs?: number | null) {
  if (typeof fallbackMs === "number" && Number.isFinite(fallbackMs)) {
    return `${Math.max(0, Math.round(fallbackMs / 1000))}s`;
  }
  if (!start) return "—";
  const endDate = end ? new Date(end) : new Date();
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "—";
  const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
  return `${(diffMs / 1000).toFixed(1)}s`;
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatJobType(type: string) {
  return type.replace(/_/g, " ");
}

export function formatStatusText(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
