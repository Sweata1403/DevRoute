"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { isLoggedIn } from "@/lib/auth";
import api from "@/lib/api";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [result, setResult] = useState<{
    code: string;
    shortUrl: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleShorten(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;

    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await api.post("/api/links", {
        url,
        ...(alias ? { alias } : {}),
      });
      setResult({
        code: res.data.code,
        shortUrl: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/${res.data.code}`,
      });
      setUrl("");
      setAlias("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-semibold text-lg tracking-tight">DevRoute</span>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {!mounted ? null : isLoggedIn() ? (
              <Link href="/dashboard">
                <Button variant="outline" size="sm">
                  Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="max-w-2xl mx-auto px-4 pt-24 pb-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          Short links for developers
        </h1>
        <p className="text-muted-foreground text-lg mb-10">
          Shorten URLs, track clicks, monitor health — built with DevOps in
          mind.
        </p>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleShorten} className="space-y-3">
              <Input
                type="url"
                placeholder="https://your-long-url.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <Input
                placeholder="Custom alias (optional)"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Shortening..." : "Shorten URL"}
              </Button>
            </form>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            {result && (
              <div className="mt-4 p-3 rounded-md bg-muted flex items-center justify-between gap-2">
                <a
                  href={result.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary truncate"
                >
                  {result.shortUrl}
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(result.shortUrl)}
                >
                  Copy
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-20 grid grid-cols-3 gap-6 text-left">
          {[
            {
              title: "Click Analytics",
              desc: "Track every click with referrer and location data",
            },
            {
              title: "Health Monitoring",
              desc: "Auto-ping your links every 30 min, get alerted on failures",
            },
            {
              title: "Link Expiry",
              desc: "Set expiry dates or max click limits on any link",
            },
          ].map((f) => (
            <div key={f.title}>
              <p className="font-medium mb-1">{f.title}</p>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

