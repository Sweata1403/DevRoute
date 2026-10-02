"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

interface LinkDetail {
  id: number;
  code: string;
  alias: string | null;
  url: string;
  clicks: number;
  health_status: "healthy" | "degraded" | "dead" | "unknown";
  last_checked_at: string | null;
  created_at: string;
}

interface HealthEvent {
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ClickPoint {
  date: string; // YYYY-MM-DD
  clicks: number;
}

const HEALTH_BADGE: Record<string, { label: string; className: string }> = {
  healthy: {
    label: "✓ Healthy",
    className:
      "bg-green-100  text-green-800  dark:bg-green-900  dark:text-green-200",
  },
  degraded: {
    label: "⚠ Degraded",
    className:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  dead: {
    label: "✗ Dead",
    className:
      "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200",
  },
  unknown: {
    label: "? Unknown",
    className:
      "bg-gray-100   text-gray-600   dark:bg-gray-800   dark:text-gray-400",
  },
};

// Minimal bar-chart rendered with divs — no external chart library needed
function ClickChart({ data }: { data: ClickPoint[] }) {
  if (!data.length)
    return <p className="text-muted-foreground text-sm">No click data yet.</p>;
  const max = Math.max(...data.map((d) => d.clicks), 1);

  return (
    <div className="flex items-end gap-1 h-32 w-full overflow-x-auto">
      {data.map((d) => (
        <div
          key={d.date}
          className="flex flex-col items-center gap-1 min-w-[28px] flex-1"
        >
          <div
            className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors"
            style={{
              height: `${Math.round((d.clicks / max) * 100)}%`,
              minHeight: d.clicks ? "4px" : "0",
            }}
            title={`${d.clicks} clicks`}
          />
          <span className="text-[10px] text-muted-foreground rotate-45 origin-top-left hidden sm:block">
            {d.date.slice(5)} {/* MM-DD */}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LinkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const code = params?.code as string;

  const [link, setLink] = useState<LinkDetail | null>(null);
  const [history, setHistory] = useState<HealthEvent[]>([]);
  const [clickData, setClickData] = useState<ClickPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkQueued, setCheckQueued] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }
    if (!code) return;
    Promise.all([
      api.get(`/api/health-monitor/${code}`),
      api
        .get(`/api/analytics/${code}?period=30d`)
        .catch(() => ({ data: { daily: [] } })),
    ])
      .then(([healthRes, analyticsRes]) => {
        setLink(healthRes.data.link);
        setHistory(healthRes.data.history ?? []);
        // Normalise analytics — API may return { daily: [...] } or an array directly
        const daily = analyticsRes.data?.daily ?? analyticsRes.data ?? [];
        setClickData(daily);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => setLoading(false));
  }, [code]);

  async function triggerHealthCheck() {
    setCheckQueued(true);
    try {
      await api.post(`/api/health-monitor/${code}/check`);
    } finally {
      setTimeout(() => setCheckQueued(false), 3000);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!link) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Link not found.</p>
          <Link href="/dashboard" className="underline text-sm">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const badge = HEALTH_BADGE[link.health_status ?? "unknown"];
  const shortUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/${link.alias ?? link.code}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b px-6 py-3 flex items-center justify-between">
        <Link href="/dashboard" className="font-bold text-lg tracking-tight">
          ← DevRoute
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Link header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold font-mono">
              /{link.alias ?? link.code}
            </h1>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground truncate block max-w-md mt-1"
            >
              {link.url}
            </a>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
              {link.last_checked_at && (
                <span className="text-xs text-muted-foreground">
                  Last checked {new Date(link.last_checked_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(shortUrl)}
            >
              Copy link
            </Button>
            <Button
              size="sm"
              onClick={triggerHealthCheck}
              disabled={checkQueued}
            >
              {checkQueued ? "Queued ✓" : "Run health check"}
            </Button>
          </div>
        </div>

        {/* Click stats */}
        <section className="rounded-lg border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Click analytics — last 30 days</h2>
            <span className="text-2xl font-bold">{link.clicks ?? 0} total</span>
          </div>
          <ClickChart data={clickData} />
        </section>

        {/* Health history */}
        <section className="rounded-lg border p-5">
          <h2 className="font-medium mb-4">Health check history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No health events recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((event, i) => {
                const statusLabel = (event.metadata?.status_code as number)
                  ? `HTTP ${event.metadata.status_code}`
                  : ((event.metadata?.error as string) ?? "");
                const duration = event.metadata?.response_time_ms
                  ? `${event.metadata.response_time_ms}ms`
                  : "";

                const actionColor: Record<string, string> = {
                  "health.healthy": "text-green-600  dark:text-green-400",
                  "health.degraded": "text-yellow-600 dark:text-yellow-400",
                  "health.dead": "text-red-600    dark:text-red-400",
                };

                return (
                  <li
                    key={i}
                    className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
                  >
                    <span
                      className={
                        actionColor[event.action] ?? "text-muted-foreground"
                      }
                    >
                      {event.action.replace("health.", "")}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {statusLabel} {duration && `· ${duration}`}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Meta */}
        <section className="rounded-lg border p-5 text-sm">
          <h2 className="font-medium mb-3">Details</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-muted-foreground">
            <dt>Code</dt>{" "}
            <dd className="font-mono text-foreground">{link.code}</dd>
            <dt>Alias</dt>{" "}
            <dd className="font-mono text-foreground">{link.alias ?? "—"}</dd>
            <dt>Created</dt>{" "}
            <dd>{new Date(link.created_at).toLocaleString()}</dd>
            <dt>Short URL</dt> <dd className="break-all">{shortUrl}</dd>
          </dl>
        </section>
      </main>
    </div>
  );
}
