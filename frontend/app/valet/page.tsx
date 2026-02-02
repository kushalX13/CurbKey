"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredToken } from "../login/page";
import { formatDateTime, parseUTC } from "../utils/date";

type ReqT = {
  id: number;
  ticket_id: number;
  ticket_token?: string;
  car_number?: string | null;
  vehicle_description?: string | null;
  status: string;
  scheduled_for?: string | null;
  exit?: { code: string; name: string };
  claimed_at?: string | null;
  claimed_phone_masked?: string | null;
};

type ReceivedTicketT = {
  id: number;
  token: string;
  claim_code: string;
  claimed_at: string | null;
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

// Matches backend ALLOWED_TRANSITIONS: only show valid next actions
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  SCHEDULED: ["REQUESTED"], // "Get car" → then Retrieving → Ready
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

function ScheduledCountdown({ scheduledFor }: { scheduledFor: string | null | undefined }) {
  const [remaining, setRemaining] = useState<string>("");
  useEffect(() => {
    if (!scheduledFor) {
      setRemaining("");
      return;
    }
    const update = () => {
      const at = parseUTC(scheduledFor);
      const now = Date.now();
      const sec = Math.max(0, Math.floor((at - now) / 1000));
      if (sec <= 0) {
        setRemaining("Due now");
        return;
      }
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setRemaining(`${m}:${s.toString().padStart(2, "0")} remaining`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [scheduledFor]);
  if (!scheduledFor || !remaining) return null;
  return <span className="ml-2 text-sm font-medium text-amber-700">{remaining}</span>;
}

export default function ValetPage() {
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE!;
  const [tab, setTab] = useState<"active" | "history">("active");
  const [venueId, setVenueId] = useState<number | null>(null);
  const [reqs, setReqs] = useState<ReqT[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [err, setErr] = useState<string>("");
  const [carNumberDrafts, setCarNumberDrafts] = useState<Record<number, string>>({});
  const [vehicleDescriptionDrafts, setVehicleDescriptionDrafts] = useState<Record<number, string>>({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [stats, setStats] = useState<{ requests_today?: number; avg_time_to_ready_min?: number | null } | null>(null);
  const [receivedTickets, setReceivedTickets] = useState<ReceivedTicketT[]>([]);
  const [editingReceivedId, setEditingReceivedId] = useState<number | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [requestsCollapsed, setRequestsCollapsed] = useState(false);
  const prevReqsRef = useRef<{ id: number; status: string }[]>([]);
  const PAGE_SIZE = 50;

  const PencilIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );

  const setCarDetails = async (ticketId: number, carNumber: string, vehicleDescription?: string) => {
    const r = await fetch(`${API}/api/tickets/${ticketId}/car-number`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        car_number: carNumber || null,
        vehicle_description: (vehicleDescription ?? "").trim() || null,
      }),
    });
    if (r.status === 401) {
      router.replace("/login?next=/valet");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    setEditingReceivedId((prev) => (prev === ticketId ? null : prev));
    await load();
    await loadReceivedTickets();
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !getStoredToken()) {
      router.replace("/login?next=/valet");
      return;
    }
  }, [router]);

  useEffect(() => {
    const fetchMe = async () => {
      const r = await fetch(`${API}/me`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        setVenueId(data.venue_id != null ? Number(data.venue_id) : 1);
      } else {
        setVenueId(1);
      }
    };
    fetchMe();
  }, [API]);

  useEffect(() => {
    if (venueId == null) return;
    const f = async () => {
      const r = await fetch(`${API}/api/stats?venue_id=${venueId}`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        setStats(data);
      }
    };
    f();
    const t = setInterval(f, 30000);
    return () => clearInterval(t);
  }, [API, venueId]);

  const load = async (cursor?: number | null, append = false) => {
    const vid = venueId ?? 1;
    setErr("");
    const scope = tab === "active" ? "active" : "history";
    const params = new URLSearchParams({
      venue_id: String(vid),
      scope,
      limit: String(PAGE_SIZE),
    });
    if (cursor != null) params.set("cursor", String(cursor));
    const r = await fetch(`${API}/api/requests?${params}`, { headers: authHeaders() });
    if (r.status === 401) {
      router.replace("/login?next=/valet");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const list = data.requests ?? [];
    setReqs((prev) => (append ? [...prev, ...list] : list));
    setNextCursor(data.next_cursor ?? null);
  };

  const loadReceivedTickets = async () => {
    const vid = venueId ?? 1;
    const r = await fetch(`${API}/api/received-tickets?venue_id=${vid}`, { headers: authHeaders() });
    if (r.status === 401) return;
    if (!r.ok) return;
    const data = await r.json();
    setReceivedTickets(data.tickets ?? []);
  };

  const setStatus = async (id: number, status: string) => {
    const r = await fetch(`${API}/api/requests/${id}/status`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    if (r.status === 401) {
      router.replace("/login?next=/valet");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    await load();
  };

  useEffect(() => {
    if (venueId === null) return;
    load(null, false).catch((e) => setErr(String(e)));
    loadReceivedTickets().catch(() => {});
    const t = setInterval(() => load(null, false).catch(() => {}), 2000);
    const t2 = setInterval(() => loadReceivedTickets().catch(() => {}), 2000);
    return () => {
      clearInterval(t);
      clearInterval(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, tab]);

  useEffect(() => {
    if (!reqs.length || !("Notification" in window)) return;
    const prev = prevReqsRef.current;
    const current = reqs.map((r) => ({ id: r.id, status: r.status }));
    if (prev.length > 0 && notificationsEnabled && Notification.permission === "granted") {
      const prevIds = new Set(prev.map((p) => p.id));
      const prevStatus = new Map(prev.map((p) => [p.id, p.status]));
      for (const r of reqs) {
        if (!prevIds.has(r.id)) {
          new Notification("CurbKey — New request", { body: `Request #${r.id} — Exit ${r.exit?.code ?? "—"}` });
        } else if (prevStatus.get(r.id) !== "READY" && r.status === "READY") {
          new Notification("CurbKey — Car ready", { body: `Request #${r.id} is ready at exit ${r.exit?.code ?? "—"}` });
        }
      }
    }
    prevReqsRef.current = current;
  }, [reqs, notificationsEnabled]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100">
      <main className="mx-auto max-w-3xl px-6 py-8 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">Valet Console</h1>
            {stats != null && (
              <p className="mt-1 text-sm text-stone-500">
                Today: <strong>{stats.requests_today ?? 0}</strong> requests
                {stats.avg_time_to_ready_min != null && (
                  <> · Avg to ready: <strong>{stats.avg_time_to_ready_min}</strong> min</>
                )}
              </p>
            )}
          </div>
          <a href="/" className="text-sm font-medium text-stone-500 transition hover:text-stone-800">← Home</a>
        </header>

        <section className="card card-hover mb-6 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm font-medium text-stone-700">Venue ID</label>
            {typeof window !== "undefined" && "Notification" in window && (
              <button
                type="button"
                onClick={async () => {
                  const perm = await Notification.requestPermission();
                  setNotificationsEnabled(perm === "granted");
                }}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50"
              >
                {notificationsEnabled ? "Notifications on" : "Enable notifications"}
              </button>
            )}
            <input
              type="number"
              value={venueId ?? 1}
              onChange={(e) => setVenueId(Number(e.target.value) || 1)}
              className="input-premium w-24"
            />
            <button
              onClick={() => load(null, false).catch((e) => setErr(String(e)))}
              className="btn-primary px-4 py-2.5 text-sm"
            >
              Refresh
            </button>
          </div>
        </section>

        <section className="card card-hover mb-6 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-stone-900">Received cars</h2>
          <p className="mt-1 text-sm text-stone-500">Claimed cars. Enter vehicle and plate here.</p>
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
                            value={vehicleDescriptionDrafts[t.id] ?? t.vehicle_description ?? ""}
                            onChange={(e) => setVehicleDescriptionDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            className="input-premium mt-1 w-40"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-600">Plate / Car #</label>
                          <input
                            type="text"
                            placeholder="e.g. ABC 1234"
                            value={carNumberDrafts[t.id] ?? t.car_number ?? ""}
                            onChange={(e) => setCarNumberDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            className="input-premium mt-1 w-32"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCarDetails(
                              t.id,
                              carNumberDrafts[t.id] ?? t.car_number ?? "",
                              vehicleDescriptionDrafts[t.id] ?? t.vehicle_description ?? ""
                            ).catch((e) => setErr(String(e)))
                          }
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
                  onClick={() => setTab("active")}
                  className={`flex-1 rounded-md px-3.5 py-2 text-sm font-medium transition sm:flex-none ${tab === "active" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setTab("history")}
                  className={`flex-1 rounded-md px-3.5 py-2 text-sm font-medium transition sm:flex-none ${tab === "history" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
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
        <div className="grid gap-4 p-4 pt-0">
          {reqs.map((r) => (
            <div key={r.id} className="card card-hover p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-stone-900">Request #{r.id}</span>
                    <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-semibold text-stone-700">{r.status}</span>
                    {(r.claimed_at ?? r.claimed_phone_masked) && (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800" title={r.claimed_phone_masked ?? undefined}>
                        Claimed ✓
                      </span>
                    )}
                  </div>
                  {r.scheduled_for && (
                    <div className="mt-1.5 text-sm text-stone-600">
                      Scheduled: <strong>{formatDateTime(r.scheduled_for)}</strong>
                      <ScheduledCountdown scheduledFor={r.scheduled_for} />
                    </div>
                  )}
                  <div className="mt-1 text-sm text-stone-600">
                    Exit: <strong>{r.exit?.code ?? "—"}</strong> {r.exit?.name && <span className="text-stone-500">({r.exit.name})</span>}
                  </div>
                  <div className="mt-1 text-sm text-stone-600">
                    Ticket: <strong>{r.ticket_token ?? "—"}</strong>{" "}
                    {r.ticket_token && (
                      <a href={`/t/${r.ticket_token}`} className="font-medium text-[var(--primary)] hover:underline">
                        Open guest
                      </a>
                    )}
                  </div>
                  {(ACTIONS_BY_STATUS[r.status] ?? []).length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
                      <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Actions</span>
                      {(ACTIONS_BY_STATUS[r.status] ?? []).map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setStatus(r.id, action).catch((e) => alert(String(e)))}
                          className={
                            action === "RETRIEVING"
                              ? "rounded-lg border-2 border-amber-500 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                              : action === "READY"
                                ? "rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                                : action === "REQUESTED"
                                  ? "rounded-lg border-2 border-blue-600 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
                                  : "btn-primary px-3.5 py-2 text-sm"
                          }
                          title={action === "READY" ? "Customer will see “Your car is ready”" : undefined}
                        >
                          {ACTION_LABELS[action] ?? action}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
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
                        <div>
                          <label className="block text-xs font-medium text-stone-600">Vehicle</label>
                          <input
                            type="text"
                            placeholder="e.g. McLaren 720"
                            value={vehicleDescriptionDrafts[r.ticket_id] ?? r.vehicle_description ?? ""}
                            onChange={(e) => setVehicleDescriptionDrafts((prev) => ({ ...prev, [r.ticket_id]: e.target.value }))}
                            className="input-premium mt-1 w-36"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-600">Car #</label>
                          <input
                            type="text"
                            placeholder="e.g. ABC 1234"
                            value={carNumberDrafts[r.ticket_id] ?? r.car_number ?? ""}
                            onChange={(e) => setCarNumberDrafts((prev) => ({ ...prev, [r.ticket_id]: e.target.value }))}
                            className="input-premium mt-1 w-32"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await setCarDetails(
                                r.ticket_id,
                                carNumberDrafts[r.ticket_id] ?? r.car_number ?? "",
                                vehicleDescriptionDrafts[r.ticket_id] ?? r.vehicle_description ?? ""
                              );
                              setEditingRequestId((prev) => (prev === r.id ? null : prev));
                            } catch (e) {
                              alert(String(e));
                            }
                          }}
                          className="btn-primary self-end px-3 py-2 text-sm"
                        >
                          Save
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {nextCursor != null && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => load(nextCursor, true).catch((e) => setErr(String(e)))}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                Load more
              </button>
            </div>
          )}
        </div>
          )}
        </section>
      </main>
    </div>
  );
}
