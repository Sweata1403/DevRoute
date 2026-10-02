"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { isLoggedIn, logout } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

interface ShortLink {
  code: string;
  alias: string | null;
  url: string;
  clicks: number;
  health_status: "healthy" | "degraded" | "dead" | "unknown";
  last_checked_at: string | null;
  created_at: string;
  active: boolean;
}

const HEALTH_BADGE: Record<string, { label: string; className: string }> = {
  healthy: {
    label: "Healthy",
    className:
      "bg-green-100  text-green-800  dark:bg-green-900  dark:text-green-200",
  },
  degraded: {
    label: "Degraded",
    className:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  dead: {
    label: "Dead",
    className:
      "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200",
  },
  unknown: {
    label: "Unknown",
    className:
      "bg-gray-100   text-gray-600   dark:bg-gray-800   dark:text-gray-400",
  },
};

export default function DashboardPage() {
  const router = useRouter();
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<string>("all");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }
    fetchLinks();
  }, []);

  async function fetchLinks() {
    try {
      setLoading(true);
      const res = await api.get("/api/links");
      setLinks(res.data.links ?? res.data);
    } catch (err: unknown) {
      setError("Failed to load links. Please refresh.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(code: string) {
    if (!confirm(`Delete /${code}?`)) return;
    try {
      await api.delete(`/api/links/${code}`);
      setLinks((prev) => prev.filter((l) => l.code !== code));
    } catch {
      alert("Delete failed");
    }
  }

  async function handleHealthCheck(code: string) {
    try {
      await api.post(`/api/health-monitor/${code}/check`);
      alert("Health check queued — refresh in a moment");
    } catch {
      alert("Failed to queue health check");
    }
  }

  const filtered = links.filter((l) => {
    const matchSearch =
      l.code.toLowerCase().includes(search.toLowerCase()) ||
      l.url.toLowerCase().includes(search.toLowerCase()) ||
      (l.alias ?? "").toLowerCase().includes(search.toLowerCase());
    const matchHealth =
      healthFilter === "all" || l.health_status === healthFilter;
    return matchSearch && matchHealth;
  });

  const summary = links.reduce(
    (acc, l) => {
      acc[l.health_status ?? "unknown"] =
        (acc[l.health_status ?? "unknown"] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b px-6 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight">
          DevRoute
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              logout();
              router.push("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Header + stats */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-4">Your Links</h1>
          <div className="flex gap-3 flex-wrap mb-4">
            {Object.entries(HEALTH_BADGE).map(
              ([status, { label, className }]) => (
                <span
                  key={status}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}
                >
                  {label}: {summary[status] ?? 0}
                </span>
              ),
            )}
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              Total: {links.length}
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Search by code, URL or alias…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All statuses</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="dead">Dead</option>
            <option value="unknown">Unknown</option>
          </select>
          <Button onClick={() => router.push("/")} size="sm">
            + New link
          </Button>
        </div>

        {/* Table */}
        {loading && (
          <div className="text-center py-16 text-muted-foreground">
            Loading…
          </div>
        )}
        {error && (
          <div className="text-center py-8 text-destructive">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No links found.{" "}
            <button onClick={() => router.push("/")} className="underline">
              Create one
            </button>
            .
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">
                    Short link
                  </th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                    Destination
                  </th>
                  <th className="text-right px-4 py-3 font-medium">Clicks</th>
                  <th className="text-center px-4 py-3 font-medium">Health</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((link, i) => {
                  const badge = HEALTH_BADGE[link.health_status ?? "unknown"];
                  const shortUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/${link.alias ?? link.code}`;
                  return (
                    <tr
                      key={link.code}
                      className={i % 2 === 0 ? "" : "bg-muted/20"}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/${link.code}`}
                          className="font-mono text-primary hover:underline"
                        >
                          /{link.alias ?? link.code}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {new Date(link.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell max-w-xs">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate block text-muted-foreground hover:text-foreground"
                          title={link.url}
                        >
                          {link.url}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {link.clicks ?? 0}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(shortUrl)
                            }
                            className="text-xs text-muted-foreground hover:text-foreground"
                            title="Copy short link"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => handleHealthCheck(link.code)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                            title="Trigger health check"
                          >
                            Check
                          </button>
                          <Link
                            href={`/dashboard/${link.code}`}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Details
                          </Link>
                          <button
                            onClick={() => handleDelete(link.code)}
                            className="text-xs text-destructive hover:opacity-80"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
