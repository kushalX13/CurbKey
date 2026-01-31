"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredToken } from "../login/page";

type ReqT = {
  id: number;
  ticket_token?: string;
  status: string;
  scheduled_for?: string | null;
  exit?: { code: string; name: string };
};

function authHeaders(): HeadersInit {
  const t = getStoredToken();
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (t) (h as Record<string, string>)["Authorization"] = `Bearer ${t}`;
  return h;
}

export default function ManagerPage() {
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE!;
  const [reqTab, setReqTab] = useState<"active" | "history">("active");
  const [reqs, setReqs] = useState<ReqT[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const PAGE_SIZE = 50;
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [lastGuestUrl, setLastGuestUrl] = useState<string | null>(null);
  const [createTicketResult, setCreateTicketResult] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [tickResult, setTickResult] = useState<string | null>(null);
  const [drainResult, setDrainResult] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !getStoredToken()) {
      router.replace("/login?next=/manager");
      return;
    }
  }, [router]);

  const load = async (cursor?: number | null, append = false) => {
    setErr("");
    const scope = reqTab === "active" ? "active" : "history";
    const params = new URLSearchParams({ scope, limit: String(PAGE_SIZE) });
    if (cursor != null) params.set("cursor", String(cursor));
    const r = await fetch(`${API}/api/requests?${params}`, { headers: authHeaders() });
    if (r.status === 401) {
      router.replace("/login?next=/manager");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const list = data.requests ?? [];
    setReqs((prev) => (append ? [...prev, ...list] : list));
    setNextCursor(data.next_cursor ?? null);
  };

  const runTick = async () => {
    setTickResult(null);
    const res = await fetch(`${API}/api/scheduler/tick`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    if (res.status === 401) {
      router.replace("/login?next=/manager");
      return;
    }
    if (!res.ok) {
      setTickResult(`Error: ${res.status}`);
      return;
    }
    const data = await res.json();
    setTickResult(`Flipped ${data.flipped ?? 0} scheduled → requested`);
    load(null, false).catch(() => {});
  };

  const runDrain = async () => {
    setDrainResult(null);
    const res = await fetch(`${API}/api/notifs/drain`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    if (res.status === 401) {
      router.replace("/login?next=/manager");
      return;
    }
    if (!res.ok) {
      setDrainResult(`Error: ${res.status}`);
      return;
    }
    const data = await res.json();
    setDrainResult(`Sent ${data.sent ?? 0} notifications`);
  };

  const runSeedDemo = async () => {
    setSeedResult(null);
    setErr("");
    try {
      const res = await fetch(`${API}/api/demo/seed`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ create_valet: true }),
      });
      if (res.status === 401) {
        router.replace("/login?next=/manager");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        setSeedResult(`Error: ${text}`);
        return;
      }
      const data = await res.json();
      setSeedResult(
        `Venue ${data.venue_id}, ${data.exits?.length ?? 0} exits, ${data.zones?.length ?? 0} zones` +
          (data.valet ? `, valet ${data.valet.email}` : ""),
      );
      load(null, false).catch(() => {});
    } catch (e) {
      setSeedResult(String(e));
    }
  };

  const runCreateTicket = async () => {
    setCreateTicketResult(null);
    setErr("");
    try {
      const res = await fetch(`${API}/api/demo/tickets`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        router.replace("/login?next=/manager");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        setCreateTicketResult(`Error: ${text}`);
        return;
      }
      const data = await res.json();
      const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${data.guest_url}` : data.guest_url;
      setLastGuestUrl(fullUrl);
      setCreateTicketResult(`Created ticket → ${data.guest_url}`);
      load(null, false).catch(() => {});
    } catch (e) {
      setCreateTicketResult(String(e));
    }
  };

  const copyGuestLink = async () => {
    if (!lastGuestUrl) return;
    try {
      await navigator.clipboard.writeText(lastGuestUrl);
      setCreateTicketResult("Copied to clipboard!");
      setTimeout(() => setCreateTicketResult(null), 2000);
    } catch {
      setCreateTicketResult("Copy failed");
    }
  };

  const runResetDemo = async () => {
    if (!confirm("Wipe all tickets, requests, events & outbox for this demo?")) return;
    setResetResult(null);
    setErr("");
    try {
      const res = await fetch(`${API}/api/demo/reset`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        router.replace("/login?next=/manager");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        setResetResult(`Error: ${text}`);
        return;
      }
      const data = await res.json();
      const d = data.deleted ?? {};
      setResetResult(
        `Deleted: ${d.tickets ?? 0} tickets, ${d.requests ?? 0} requests, ${d.status_events ?? 0} events`,
      );
      load(null, false).catch(() => {});
    } catch (e) {
      setResetResult(String(e));
    }
  };

  useEffect(() => {
    load(null, false).catch((e) => setErr(String(e)));
    const t = setInterval(() => load(null, false).catch(() => {}), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqTab]);

  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <h1 className="text-2xl font-bold text-zinc-900">CurbKey — Manager</h1>
      <a href="/" className="mt-2 inline-block text-sm text-zinc-600 hover:underline">← Home</a>

      <section className="mt-6 rounded-xl border border-zinc-300 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-zinc-900">Demo Kit</h2>
        <p className="mt-1 text-sm text-zinc-600">Set up and tear down the demo in seconds.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={runSeedDemo}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Seed Demo
          </button>
          <button
            onClick={runCreateTicket}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Create Ticket
          </button>
          <button
            onClick={copyGuestLink}
            disabled={!lastGuestUrl}
            className="rounded-lg border border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Copy Guest Link
          </button>
          <button
            onClick={runResetDemo}
            className="rounded-lg border border-red-400 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Reset Demo
          </button>
        </div>
        {seedResult && <p className="mt-2 text-sm text-zinc-600">{seedResult}</p>}
        {createTicketResult && <p className="mt-2 text-sm text-zinc-600">{createTicketResult}</p>}
        {lastGuestUrl && (
          <p className="mt-2 truncate text-xs text-zinc-500" title={lastGuestUrl}>
            {lastGuestUrl}
          </p>
        )}
        {resetResult && <p className="mt-2 text-sm text-zinc-600">{resetResult}</p>}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-300 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-zinc-900">Ops</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            onClick={runTick}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Scheduler tick
          </button>
          <button
            onClick={runDrain}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Drain notifications
          </button>
        </div>
        {tickResult && <p className="mt-2 text-sm text-zinc-600">{tickResult}</p>}
        {drainResult && <p className="mt-2 text-sm text-zinc-600">{drainResult}</p>}
      </section>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <section className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold text-zinc-900">Requests</h2>
          <div className="flex gap-2 border-b border-zinc-200">
            <button
              type="button"
              onClick={() => setReqTab("active")}
              className={`border-b-2 px-3 py-1.5 text-sm font-medium ${
                reqTab === "active"
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setReqTab("history")}
              className={`border-b-2 px-3 py-1.5 text-sm font-medium ${
                reqTab === "history"
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              History
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {reqs.map((r) => (
            <div key={r.id} className="rounded-xl border border-zinc-300 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-zinc-900">#{r.id}</span>
                  <span className="ml-2 rounded bg-zinc-200 px-2 py-0.5 text-sm font-medium text-zinc-800">
                    {r.status}
                  </span>
                  {r.scheduled_for && (
                    <span className="ml-2 text-xs text-zinc-500">scheduled {r.scheduled_for}</span>
                  )}
                </div>
                <div className="text-sm text-zinc-600">
                  Exit: {r.exit?.code ?? "—"}
                  {r.ticket_token && (
                    <a href={`/t/${r.ticket_token}`} className="ml-2 text-blue-600 hover:underline">
                      Guest
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {nextCursor != null && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => load(nextCursor, true).catch((e) => setErr(String(e)))}
              className="rounded-lg border-2 border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Load more
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
