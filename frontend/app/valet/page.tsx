"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredToken } from "../login/page";

type ReqT = {
  id: number;
  ticket_id: number;
  ticket_token?: string;
  car_number?: string | null;
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

// Matches backend ALLOWED_TRANSITIONS: only show valid next actions
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  SCHEDULED: [],
  REQUESTED: ["RETRIEVING"],
  ASSIGNED: ["RETRIEVING"],
  RETRIEVING: ["READY"],
  READY: ["PICKED_UP"],
  PICKED_UP: [],
  CLOSED: [],
  CANCELED: [],
};

const ACTION_LABELS: Record<string, string> = {
  RETRIEVING: "Retrieving",
  READY: "Ready",
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
      const at = new Date(scheduledFor).getTime();
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
  const PAGE_SIZE = 50;

  const setCarNumber = async (ticketId: number, carNumber: string) => {
    const r = await fetch(`${API}/api/tickets/${ticketId}/car-number`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ car_number: carNumber || null }),
    });
    if (r.status === 401) {
      router.replace("/login?next=/valet");
      return;
    }
    if (!r.ok) throw new Error(await r.text());
    await load();
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
    const t = setInterval(() => load(null, false).catch(() => {}), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, tab]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100">
      <main className="mx-auto max-w-3xl px-6 py-8 sm:py-10">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">Valet Console</h1>
          <a href="/" className="text-sm font-medium text-stone-500 transition hover:text-stone-800">← Home</a>
        </header>

        <section className="card card-hover mb-6 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm font-medium text-stone-700">Venue ID</label>
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

        {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

        <div className="mb-5 flex gap-0.5 rounded-lg bg-stone-100 p-1">
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

        <div className="grid gap-4">
          {reqs.map((r) => (
            <div key={r.id} className="card card-hover p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-stone-900">Request #{r.id}</span>
                    <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-semibold text-stone-700">{r.status}</span>
                  </div>
                  {r.scheduled_for && (
                    <div className="mt-1.5 text-sm text-stone-600">
                      Scheduled: <strong>{new Date(r.scheduled_for).toLocaleString()}</strong>
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="text-sm font-medium text-stone-600">Car #</label>
                    <input
                      type="text"
                      placeholder="e.g. ABC 1234"
                      value={carNumberDrafts[r.ticket_id] ?? r.car_number ?? ""}
                      onChange={(e) => setCarNumberDrafts((prev) => ({ ...prev, [r.ticket_id]: e.target.value }))}
                      className="input-premium w-36"
                    />
                    <button
                      type="button"
                      onClick={() => setCarNumber(r.ticket_id, carNumberDrafts[r.ticket_id] ?? r.car_number ?? "").catch((e) => alert(String(e)))}
                      className="btn-primary px-3 py-2 text-sm"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>

              {(ACTIONS_BY_STATUS[r.status] ?? []).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-200 pt-4">
                  {(ACTIONS_BY_STATUS[r.status] ?? []).map((action) => (
                    <button
                      key={action}
                      onClick={() => setStatus(r.id, action).catch((e) => alert(String(e)))}
                      className={
                        action === "RETRIEVING"
                          ? "btn-accent px-3.5 py-2 text-sm"
                          : action === "READY"
                            ? "rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98]"
                            : "btn-primary px-3.5 py-2 text-sm"
                      }
                    >
                      {ACTION_LABELS[action] ?? action}
                    </button>
                  ))}
                </div>
              )}
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
      </main>
    </div>
  );
}
