"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { getStoredToken } from "../login/page";
import { formatDateTime } from "../utils/date";

type ReqT = {
  id: number;
  ticket_id?: number;
  ticket_token?: string;
  status: string;
  scheduled_for?: string | null;
  exit?: { code: string; name: string };
  claimed_at?: string | null;
  claimed_phone_masked?: string | null;
  car_number?: string | null;
  vehicle_description?: string | null;
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
  const [lastClaimCode, setLastClaimCode] = useState<string | null>(null);
  const [lastVenueSlug, setLastVenueSlug] = useState<string | null>(null);
  const [createTicketResult, setCreateTicketResult] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [tickResult, setTickResult] = useState<string | null>(null);
  const [drainResult, setDrainResult] = useState<string | null>(null);
  const [managerVehicleDrafts, setManagerVehicleDrafts] = useState<Record<number, string>>({});
  const [managerCarNumberDrafts, setManagerCarNumberDrafts] = useState<Record<number, string>>({});
  const [stats, setStats] = useState<{ requests_today?: number; avg_time_to_ready_min?: number | null } | null>(null);
  const createResultRef = useRef<HTMLDivElement>(null);

  const saveManagerCarDetails = async (ticketId: number, carNumber: string, vehicleDescription: string) => {
    const r = await fetch(`${API}/api/tickets/${ticketId}/car-number`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        car_number: carNumber || null,
        vehicle_description: (vehicleDescription ?? "").trim() || null,
      }),
    });
    if (r.status === 401) {
      router.replace("/login?next=/manager");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    load(null, false).catch(() => {});
  };

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

  const runCreateTicket = async (count = 1) => {
    setCreateTicketResult(null);
    setErr("");
    try {
      const res = await fetch(`${API}/api/demo/tickets`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(count > 1 ? { count } : {}),
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
      const first = data.tickets ? data.tickets[0] : data;
      const guestPath = first.guest_url ?? `/t/${first.token ?? ""}`;
      const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${guestPath}` : guestPath;
      setLastGuestUrl(fullUrl);
      setLastClaimCode(first.claim_code ?? null);
      setLastVenueSlug(first.venue_slug ?? null);
      setCreateTicketResult(data.count ? `Created ${data.count} tickets` : `Created ticket → ${guestPath}`);
      load(null, false).catch(() => {});
      setTimeout(() => createResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 150);
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

  useEffect(() => {
    const f = async () => {
      const r = await fetch(`${API}/api/stats?venue_id=1`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        setStats(data);
      }
    };
    f();
    const t = setInterval(f, 30000);
    return () => clearInterval(t);
  }, [API]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100">
      <main className="mx-auto max-w-3xl px-6 py-8 sm:py-10">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">Manager</h1>
            {stats != null && (
              <p className="mt-1 text-sm text-stone-500">
                Today (venue 1): <strong>{stats.requests_today ?? 0}</strong> requests
                {stats.avg_time_to_ready_min != null && (
                  <> · Avg to ready: <strong>{stats.avg_time_to_ready_min}</strong> min</>
                )}
              </p>
            )}
          </div>
          <a href="/" className="text-sm font-medium text-stone-500 transition hover:text-stone-800">← Home</a>
        </header>

        <section className="card card-hover mb-6 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-stone-900">Demo Kit</h2>
          <p className="mt-1 text-sm text-stone-500">Set up and tear down the demo in seconds.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={runSeedDemo} className="btn-accent px-4 py-2.5 text-sm">
              Seed Demo
            </button>
            <button onClick={() => runCreateTicket(1)} className="btn-primary px-4 py-2.5 text-sm">
              Create Ticket
            </button>
            <button onClick={() => runCreateTicket(5)} className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
              Create 5 tickets
            </button>
            <button
              onClick={copyGuestLink}
              disabled={!lastGuestUrl}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copy Guest Link
            </button>
            <button
              onClick={runResetDemo}
              className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50"
            >
              Reset Demo
            </button>
          </div>
          {seedResult && <p className="mt-3 text-sm text-stone-600">{seedResult}</p>}
          <div ref={createResultRef}>
            {createTicketResult && <p className="mt-2 text-sm text-stone-600">{createTicketResult}</p>}
          </div>
          {lastGuestUrl && (
            <>
              <p className="mt-3 text-sm font-semibold text-stone-700">Step 1 — Customer scans this first (venue link)</p>
              <p className="mt-0.5 text-xs text-stone-500">Customer scans → enters phone → enters 6-digit code → taps &quot;Text me my link&quot;. Do not give them the guest link below.</p>
              {lastVenueSlug && (
                <>
                  <div className="mt-3 rounded-xl border-2 border-[var(--primary)] bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Venue link (this QR only)</p>
                    <div className="mt-2 flex flex-wrap items-start gap-4">
                      <div className="rounded-lg border border-stone-200 bg-white p-3">
                        <QRCodeSVG
                          value={typeof window !== "undefined" ? `${window.location.origin}/v/${lastVenueSlug}` : `/v/${lastVenueSlug}`}
                          size={180}
                          level="M"
                        />
                      </div>
                      <div>
                        <p className="break-all text-sm font-medium text-stone-800">
                          {typeof window !== "undefined" ? `${window.location.origin}/v/${lastVenueSlug}` : `/v/${lastVenueSlug}`}
                        </p>
                        {lastClaimCode && (
                          <p className="mt-2 text-lg font-mono font-bold tracking-widest text-stone-900">Code: {lastClaimCode}</p>
                        )}
                        <p className="mt-1 text-xs text-stone-500">Give customer this code after they scan</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              <p className="mt-4 text-sm font-semibold text-stone-600">Step 2 — After they claim (guest link — for you, not for customer to scan)</p>
              <p className="mt-0.5 truncate text-xs text-stone-500" title={lastGuestUrl}>{lastGuestUrl}</p>
              <div className="mt-2 flex items-start gap-3">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-2">
                  <QRCodeSVG value={lastGuestUrl} size={100} level="M" />
                </div>
                <p className="text-xs text-stone-500">They get this link after entering the code and tapping &quot;Text me my link&quot;. Use this to open guest page yourself.</p>
              </div>
            </>
          )}
          {resetResult && <p className="mt-2 text-sm text-stone-600">{resetResult}</p>}
        </section>

        <section className="card card-hover mb-6 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-stone-900">Ops</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={runTick} className="btn-primary px-4 py-2.5 text-sm">
              Scheduler tick
            </button>
            <button onClick={runDrain} className="btn-accent px-4 py-2.5 text-sm">
              Drain notifications
            </button>
          </div>
          {tickResult && <p className="mt-2 text-sm text-stone-600">{tickResult}</p>}
          {drainResult && <p className="mt-2 text-sm text-stone-600">{drainResult}</p>}
        </section>

        {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-stone-900">Requests</h2>
            <div className="flex gap-0.5 rounded-lg bg-stone-100 p-1">
              <button
                type="button"
                onClick={() => setReqTab("active")}
                className={`rounded-md px-3.5 py-2 text-sm font-medium transition ${reqTab === "active" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setReqTab("history")}
                className={`rounded-md px-3.5 py-2 text-sm font-medium transition ${reqTab === "history" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
              >
                History
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            {reqs.map((r) => (
              <div key={r.id} className="card card-hover p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-semibold text-stone-900">#{r.id}</span>
                    <span className="ml-2 rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-700">{r.status}</span>
                    {(r.claimed_at ?? r.claimed_phone_masked) && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800" title={r.claimed_phone_masked ?? undefined}>
                        Claimed ✓
                      </span>
                    )}
                    {r.scheduled_for && <span className="ml-2 text-xs text-stone-500">{formatDateTime(r.scheduled_for)}</span>}
                  </div>
                  <div className="text-sm text-stone-600">
                    Exit {r.exit?.code ?? "—"}
                    {r.ticket_token && (
                      <a href={`/t/${r.ticket_token}`} className="ml-2 font-medium text-[var(--primary)] hover:underline">
                        Guest
                      </a>
                    )}
                  </div>
                </div>
                {r.ticket_id != null && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-2">
                    <span className="text-xs font-medium text-stone-500">Vehicle</span>
                    <input
                      type="text"
                      placeholder="e.g. McLaren 720"
                      value={managerVehicleDrafts[r.id] ?? r.vehicle_description ?? ""}
                      onChange={(e) => setManagerVehicleDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="input-premium mt-1 w-36 text-sm"
                    />
                    <span className="text-xs font-medium text-stone-500">Car #</span>
                    <input
                      type="text"
                      placeholder="e.g. ABC 1234"
                      value={managerCarNumberDrafts[r.id] ?? r.car_number ?? ""}
                      onChange={(e) => setManagerCarNumberDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="input-premium mt-1 w-28 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => saveManagerCarDetails(r.ticket_id!, managerCarNumberDrafts[r.id] ?? r.car_number ?? "", managerVehicleDrafts[r.id] ?? r.vehicle_description ?? "").catch((e) => setErr(String(e)))}
                      className="btn-primary mt-1 px-3 py-1.5 text-xs"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {nextCursor != null && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => load(nextCursor, true).catch((e) => setErr(String(e)))}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                Load more
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
