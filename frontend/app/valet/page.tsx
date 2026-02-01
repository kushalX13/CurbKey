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
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <h1 className="text-2xl font-bold text-zinc-900">CurbKey — Valet Console</h1>
      <a href="/" className="mt-2 inline-block text-sm text-zinc-600 hover:underline">← Home</a>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-zinc-700">Venue ID</label>
        <input
          type="number"
          value={venueId ?? 1}
          onChange={(e) => setVenueId(Number(e.target.value) || 1)}
          className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-zinc-900"
        />
        <button
          onClick={() => load(null, false).catch((e) => setErr(String(e)))}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Refresh
        </button>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-6 flex gap-2 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "active"
              ? "border-zinc-900 text-zinc-900"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "history"
              ? "border-zinc-900 text-zinc-900"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          History
        </button>
      </div>

      <div className="mt-4 grid gap-4">
        {reqs.map((r) => (
          <div key={r.id} className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold text-zinc-900">Request #{r.id}</div>
                {r.scheduled_for && (
                  <div className="text-sm text-zinc-600">
                    Scheduled for: <strong>{new Date(r.scheduled_for).toLocaleString()}</strong>
                    <ScheduledCountdown scheduledFor={r.scheduled_for} />
                  </div>
                )}
                <div className="text-sm text-zinc-600">
                  Exit: <strong>{r.exit?.code ?? "—"}</strong> ({r.exit?.name ?? ""})
                </div>
                <div className="text-sm text-zinc-600">
                  Ticket: <strong>{r.ticket_token ?? "—"}</strong>{" "}
                  {r.ticket_token && (
                    <a href={`/t/${r.ticket_token}`} className="ml-2 text-blue-600 hover:underline">
                      Open guest
                    </a>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-sm text-zinc-600">Car #:</label>
                  <input
                    type="text"
                    placeholder="e.g. ABC 1234"
                    value={carNumberDrafts[r.ticket_id] ?? r.car_number ?? ""}
                    onChange={(e) => setCarNumberDrafts((prev) => ({ ...prev, [r.ticket_id]: e.target.value }))}
                    className="w-32 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => setCarNumber(r.ticket_id, carNumberDrafts[r.ticket_id] ?? r.car_number ?? "").catch((e) => alert(String(e)))}
                    className="rounded bg-zinc-700 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-600"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="rounded bg-zinc-200 px-2 py-1 font-bold text-zinc-900">{r.status}</div>
            </div>

            {(ACTIONS_BY_STATUS[r.status] ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(ACTIONS_BY_STATUS[r.status] ?? []).map((action) => (
                  <button
                    key={action}
                    onClick={() => setStatus(r.id, action).catch((e) => alert(String(e)))}
                    className={
                      action === "RETRIEVING"
                        ? "rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                        : action === "READY"
                          ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                          : "rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
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
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => load(nextCursor, true).catch((e) => setErr(String(e)))}
              className="rounded-lg border-2 border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
