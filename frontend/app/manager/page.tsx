"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { getStoredToken, clearStoredToken } from "../login/page";
import { formatDateTime } from "../utils/date";

type ReceivedTicketT = {
  id: number;
  token: string;
  claim_code: string;
  claimed_at: string | null;
  claimed_phone_masked?: string | null;
  car_number?: string | null;
  vehicle_description?: string | null;
};

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

// Same as Valet: Get car → Retrieving → Ready (car at exit)
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  SCHEDULED: ["REQUESTED"],
  REQUESTED: ["RETRIEVING"],
  ASSIGNED: ["RETRIEVING"],
  RETRIEVING: ["READY"],
  READY: ["PICKED_UP"],
  PICKED_UP: [],
  CLOSED: [],
  CANCELED: [],
};
const ACTION_LABELS: Record<string, string> = {
  REQUESTED: "Get car",
  RETRIEVING: "Retrieving",
  READY: "Ready (car at exit)",
  PICKED_UP: "Picked Up",
};

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
  const [receivedTickets, setReceivedTickets] = useState<ReceivedTicketT[]>([]);
  const [receivedVehicleDrafts, setReceivedVehicleDrafts] = useState<Record<number, string>>({});
  const [receivedCarNumberDrafts, setReceivedCarNumberDrafts] = useState<Record<number, string>>({});
  const [editingReceivedId, setEditingReceivedId] = useState<number | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [requestsCollapsed, setRequestsCollapsed] = useState(false);
  const [stats, setStats] = useState<{ requests_today?: number; avg_time_to_ready_min?: number | null } | null>(null);
  const [tipsData, setTipsData] = useState<{ tips: { id: number; request_id: number; amount_cents: number; status: string; created_at: string; vehicle_description?: string | null; car_number?: string | null }[]; by_valet: { user_id: number; email: string | null; total_cents: number; count: number }[] } | null>(null);
  const [tipsListCollapsed, setTipsListCollapsed] = useState(true);
  const [backendStatus, setBackendStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const createResultRef = useRef<HTMLDivElement>(null);

  const PencilIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );

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
    loadReceivedTickets().catch(() => {});
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !getStoredToken()) {
      router.replace("/login?next=/manager");
      return;
    }
  }, [router]);

  useEffect(() => {
    const checkRole = async () => {
      const r = await fetch(`${API}/me`, { headers: authHeaders() });
      if (r.status === 401) {
        router.replace("/login?next=/manager");
        return;
      }
      if (r.ok) {
        const data = await r.json();
        if (data.role === "VALET") {
          clearStoredToken();
          router.replace("/login?next=/manager");
        }
      }
    };
    checkRole();
  }, [API, router]);

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const r = await fetch(`${API}/healthz`, { method: "GET" });
        setBackendStatus(r.ok ? "ok" : "error");
      } catch {
        setBackendStatus("error");
      }
    };
    checkBackend();
    const t = setInterval(checkBackend, 30000);
    return () => clearInterval(t);
  }, [API]);

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

  const loadReceivedTickets = async () => {
    const r = await fetch(`${API}/api/received-tickets?venue_id=1`, { headers: authHeaders() });
    if (r.status === 401) return;
    if (!r.ok) return;
    const data = await r.json();
    setReceivedTickets(data.tickets ?? []);
  };

  const loadTips = async () => {
    const r = await fetch(`${API}/api/tips?venue_id=1`, { headers: authHeaders() });
    if (r.status === 401) return;
    if (!r.ok) return;
    const data = await r.json();
    setTipsData({ tips: data.tips ?? [], by_valet: data.by_valet ?? [] });
  };

  const setRequestStatus = async (reqId: number, status: string) => {
    const r = await fetch(`${API}/api/requests/${reqId}/status`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    if (r.status === 401) {
      router.replace("/login?next=/manager");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    load(null, false).catch(() => {});
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
        setBackendStatus("error");
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
      setBackendStatus("ok");
      load(null, false).catch(() => {});
      setTimeout(() => createResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 150);
    } catch (e) {
      const msg = String(e);
      const isNetwork = /failed to fetch|networkerror|load failed/i.test(msg) || (e instanceof TypeError && msg === "Failed to fetch");
      setCreateTicketResult(
        isNetwork
          ? "Backend unreachable. On Render free tier the service sleeps after ~15 min — wait 30–60s and try again."
          : msg
      );
      setBackendStatus("error");
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
    loadReceivedTickets().catch(() => {});
    loadTips().catch(() => {});
    const t = setInterval(() => load(null, false).catch(() => {}), 5000);
    const t2 = setInterval(() => loadReceivedTickets().catch(() => {}), 5000);
    const t3 = setInterval(() => loadTips().catch(() => {}), 5000);
    return () => {
      clearInterval(t);
      clearInterval(t2);
      clearInterval(t3);
    };
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
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
            <p className="mt-1 text-sm">
              {backendStatus === "ok" && <span className="text-green-700">Backend: connected</span>}
              {backendStatus === "error" && (
                <span className="text-amber-700" title="Create Ticket will fail until backend is up. On Render free tier the service sleeps after ~15 min — wait 30–60s and refresh.">
                  Backend: unreachable (Render may be sleeping — wait 30s and retry)
                </span>
              )}
              {backendStatus === "unknown" && <span className="text-stone-400">Backend: checking…</span>}
            </p>
          </div>
          <span className="flex items-center gap-3">
            <a href="/" className="text-sm font-medium text-stone-500 transition hover:text-stone-800">← Home</a>
            <button type="button" onClick={() => { clearStoredToken(); router.push("/login"); }} className="text-sm font-medium text-stone-500 transition hover:text-stone-800">Log out</button>
          </span>
        </header>

        <section className="card card-hover mb-6 p-6">
          <h2 className="text-lg font-semibold text-stone-900">Demo Kit</h2>
          <p className="mt-1 text-sm text-stone-500">Set up or reset the demo.</p>
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

        <section className="card card-hover mb-6 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-stone-900">Tips</h2>
          <p className="mt-1 text-sm text-stone-500">Totals by valet. Recent tips below.</p>
          {tipsData && (
            <>
              {tipsData.by_valet.length > 0 ? (
                <div className="mt-5 space-y-2">
                  {tipsData.by_valet.map((v, i) => (
                    <div key={v.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <span className="font-medium text-stone-800">Valet {i + 1}</span>
                      <span className="font-mono text-lg font-semibold text-stone-900">${(v.total_cents / 100).toFixed(2)}</span>
                      <span className="text-xs text-stone-500">{v.count} tip{v.count !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-stone-500">No tips yet.</p>
              )}
              {tipsData.tips.length > 0 && (
                <div className="mt-5 border-t border-stone-200 pt-5">
                  <button
                    type="button"
                    onClick={() => setTipsListCollapsed((c) => !c)}
                    className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-stone-50/50 px-4 py-3 text-left font-medium text-stone-800 transition hover:bg-stone-100"
                    aria-expanded={!tipsListCollapsed}
                  >
                    <span>Recent tips ({tipsData.tips.length})</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={tipsListCollapsed ? "" : "rotate-180"} aria-hidden>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {!tipsListCollapsed && (
                    <ul className="mt-2 space-y-2">
                      {tipsData.tips.slice(0, 20).map((tip) => (
                        <li key={tip.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-100 bg-white px-4 py-2.5 text-sm">
                          <span className="font-medium text-stone-800">
                            {tip.vehicle_description || tip.car_number || `Request #${tip.request_id}`}
                          </span>
                          <span className="font-mono font-semibold text-stone-900">${(tip.amount_cents / 100).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section className="card card-hover mb-6 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-stone-900">Received cars</h2>
          <p className="mt-1 text-sm text-stone-500">Claimed cars. Enter vehicle and plate here. (Venue 1)</p>
          {receivedTickets.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">No claimed cars yet.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {receivedTickets.map((t) => (
                <div key={t.id} className="rounded-lg border border-stone-200 bg-stone-50/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-stone-900">{t.claim_code}</span>
                    {t.claimed_at && (
                      <span className="text-xs text-stone-500">Claimed {formatDateTime(t.claimed_at)}</span>
                    )}
                    {t.claimed_phone_masked && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">{t.claimed_phone_masked}</span>
                    )}
                    <a href={`/t/${t.token}`} className="text-xs font-medium text-[var(--primary)] hover:underline">Open guest</a>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {(t.vehicle_description || t.car_number) && editingReceivedId !== t.id ? (
                      <>
                        <span className="text-sm text-stone-700">
                          {t.vehicle_description || "—"} · {t.car_number || "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingReceivedId(t.id)}
                          className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-600 transition hover:bg-stone-50"
                          aria-label="Edit car details"
                        >
                          <PencilIcon />
                          Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-stone-600">Vehicle</label>
                          <input
                            type="text"
                            placeholder="e.g. McLaren 720"
                            value={receivedVehicleDrafts[t.id] ?? t.vehicle_description ?? ""}
                            onChange={(e) => setReceivedVehicleDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            className="input-premium mt-1 w-40 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-600">Plate / Car #</label>
                          <input
                            type="text"
                            placeholder="e.g. ABC 1234"
                            value={receivedCarNumberDrafts[t.id] ?? t.car_number ?? ""}
                            onChange={(e) => setReceivedCarNumberDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            className="input-premium mt-1 w-32 text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await saveManagerCarDetails(
                                t.id,
                                receivedCarNumberDrafts[t.id] ?? t.car_number ?? "",
                                receivedVehicleDrafts[t.id] ?? t.vehicle_description ?? ""
                              );
                              setEditingReceivedId((prev) => (prev === t.id ? null : prev));
                            } catch (e) {
                              setErr(String(e));
                            }
                          }}
                          className="btn-primary px-3 py-2 text-sm"
                        >
                          Save
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

        <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 p-4">
            <h2 className="text-lg font-semibold text-stone-900">Requests</h2>
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                onClick={() => setRequestsCollapsed((c) => !c)}
                className="rounded-lg border border-stone-300 bg-white p-2 text-stone-600 transition hover:bg-stone-50"
                aria-label={requestsCollapsed ? "Expand requests list" : "Collapse requests list"}
                aria-expanded={!requestsCollapsed}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={requestsCollapsed ? "" : "rotate-180"}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
          {!requestsCollapsed && (
          <>
          <div className="mt-0 grid gap-3 p-4 pt-0">
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
                {(ACTIONS_BY_STATUS[r.status] ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
                    <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Actions</span>
                    {(ACTIONS_BY_STATUS[r.status] ?? []).map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setRequestStatus(r.id, action).catch((e) => setErr(String(e)))}
                        className={
                          action === "RETRIEVING"
                            ? "rounded-lg border-2 border-amber-500 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                            : action === "READY"
                              ? "rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                              : action === "REQUESTED"
                                ? "rounded-lg border-2 border-blue-600 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
                                : "rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                        }
                        title={action === "READY" ? "Customer will see “Your car is ready”" : undefined}
                      >
                        {ACTION_LABELS[action] ?? action}
                      </button>
                    ))}
                  </div>
                )}
                {r.ticket_id != null && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-2">
                    {(r.vehicle_description || r.car_number) && editingRequestId !== r.id ? (
                      <>
                        <span className="text-sm text-stone-700">
                          {r.vehicle_description || "—"} · {r.car_number || "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingRequestId(r.id)}
                          className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-600 transition hover:bg-stone-50"
                          aria-label="Edit car details"
                        >
                          <PencilIcon />
                          Edit
                        </button>
                      </>
                    ) : (
                      <>
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
                          onClick={async () => {
                            try {
                              await saveManagerCarDetails(r.ticket_id!, managerCarNumberDrafts[r.id] ?? r.car_number ?? "", managerVehicleDrafts[r.id] ?? r.vehicle_description ?? "");
                              setEditingRequestId((prev) => (prev === r.id ? null : prev));
                            } catch (e) {
                              setErr(String(e));
                            }
                          }}
                          className="btn-primary mt-1 px-3 py-1.5 text-xs"
                        >
                          Save
                        </button>
                      </>
                    )}
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
          </>
          )}
        </section>
      </main>
    </div>
  );
}
