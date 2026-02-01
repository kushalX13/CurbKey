"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatDateTime, parseUTC } from "../../utils/date";

type ExitT = { id: number; code: string; name: string };
type TicketResp = {
  ticket: { id: number; venue_id: number; token: string; car_number?: string | null; vehicle_description?: string | null };
  request: null | {
    id: number;
    status: string;
    exit_id: number;
    scheduled_for?: string | null;
    exit?: { id: number; code: string; name: string };
  };
};

const STATUS_CONFIG: Record<string, { label: string; sublabel: string; bg: string; text: string }> = {
  "No request yet": {
    label: "Ready when you are",
    sublabel: "Choose your pickup exit and request your car below.",
    bg: "bg-stone-100",
    text: "text-stone-700",
  },
  SCHEDULED: {
    label: "Scheduled",
    sublabel: "Your car will be requested at the time you chose.",
    bg: "bg-amber-50",
    text: "text-amber-900",
  },
  REQUESTED: {
    label: "Request received",
    sublabel: "We’ll bring your car to the exit. We’ll notify you when it’s ready.",
    bg: "bg-sky-50",
    text: "text-sky-900",
  },
  ASSIGNED: {
    label: "In progress",
    sublabel: "A valet is on the way to retrieve your car.",
    bg: "bg-sky-50",
    text: "text-sky-900",
  },
  RETRIEVING: {
    label: "Bringing your car",
    sublabel: "Your car is on the way to the pickup area.",
    bg: "bg-sky-50",
    text: "text-sky-900",
  },
  READY: {
    label: "Your car is ready",
    sublabel: "Please head to the pickup exit.",
    bg: "bg-emerald-50",
    text: "text-emerald-900",
  },
  PICKED_UP: {
    label: "Enjoy the drive",
    sublabel: "Thanks for using our valet service.",
    bg: "bg-emerald-50",
    text: "text-emerald-900",
  },
  CLOSED: {
    label: "All set",
    sublabel: "Thanks for using our valet service.",
    bg: "bg-stone-100",
    text: "text-stone-700",
  },
  CANCELED: {
    label: "Canceled",
    sublabel: "You can request again when you’re ready.",
    bg: "bg-stone-100",
    text: "text-stone-600",
  },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? {
    label: status,
    sublabel: "",
    bg: "bg-stone-100",
    text: "text-stone-700",
  };
}

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
        setRemaining("Requesting now");
      } else {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        setRemaining(`${m}:${s.toString().padStart(2, "0")} until request`);
      }
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [scheduledFor]);
  if (!scheduledFor || !remaining) return null;
  return <span className="mt-2 block text-sm font-medium opacity-90">{remaining}</span>;
}

export default function TicketPage() {
  const API = process.env.NEXT_PUBLIC_API_BASE!;
  const { token } = useParams<{ token: string }>();

  const [ticket, setTicket] = useState<TicketResp["ticket"] | null>(null);
  const [req, setReq] = useState<TicketResp["request"] | null>(null);
  const [exits, setExits] = useState<ExitT[]>([]);
  const [selectedExit, setSelectedExit] = useState<number | null>(null);
  const [statusLine, setStatusLine] = useState<string>("Loading...");
  const [loading, setLoading] = useState(false);
  const reqRef = useRef<TicketResp["request"] | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${API}/t/${token}`);
      if (!r.ok) {
        const text = await r.text();
        let msg = "Ticket not found (invalid token).";
        try {
          const j = JSON.parse(text);
          if (j?.message && typeof j.message === "string") msg = j.message;
        } catch {
          if (r.status === 404) msg = "Ticket not found (invalid token).";
        }
        throw new Error(msg);
      }
      const data: TicketResp = await r.json();
      setTicket(data.ticket);
      setReq(data.request);
      reqRef.current = data.request;
      setStatusLine(data.request?.status ?? "No request yet");
      if (data.request?.exit_id) setSelectedExit(data.request.exit_id);
    } catch (e) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("Can't load. Check your connection.");
      }
      throw e;
    }
  };

  const loadExits = async () => {
    const r = await fetch(`${API}/t/${token}/exits`);
    if (!r.ok) throw new Error(await r.text());
    const data: ExitT[] = await r.json();
    setExits(data);
    if (!selectedExit && data.length) setSelectedExit(data[0].id);
  };

  const requestCar = async (delayMinutes?: number) => {
    if (!selectedExit) return;
    setLoading(true);
    try {
      const body: { exit_id: number; delay_minutes?: number } = { exit_id: selectedExit };
      if (delayMinutes != null && delayMinutes > 0) body.delay_minutes = delayMinutes;
      const r = await fetch(`${API}/t/${token}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setReq(data.request);
      reqRef.current = data.request;
      setStatusLine(data.request.status);
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch((e) => setStatusLine(String(e)));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadExits().catch((e) => setStatusLine(String(e)));
    const interval = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(interval);
  }, [token]);

  const config = getStatusConfig(statusLine);
  const canRequest = !req || ["No request yet", "SCHEDULED", "CLOSED", "CANCELED"].includes(statusLine);

  const [outdoorTheme, setOutdoorTheme] = useState(false);
  useEffect(() => {
    const v = typeof window !== "undefined" && localStorage.getItem("curbkey_theme") === "outdoor";
    setOutdoorTheme(!!v);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = v ? "outdoor" : "";
    }
  }, []);
  const toggleOutdoor = () => {
    const next = !outdoorTheme;
    setOutdoorTheme(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("curbkey_theme", next ? "outdoor" : "");
      document.documentElement.dataset.theme = next ? "outdoor" : "";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100" role="main">
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-stone-900" id="page-title">CurbKey</h1>
            {(() => {
              const type = ticket?.vehicle_description ?? "";
              const plate = ticket?.car_number ?? "";
              const last4 = plate.length >= 4 ? `••••${plate.slice(-4)}` : plate;
              const carLine = type && last4 ? `${type} ${last4}` : type || last4;
              return carLine ? (
                <p className="mt-0.5 text-sm text-stone-500">
                  Your car: <span className="font-medium tracking-wide text-stone-700">{carLine}</span>
                </p>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleOutdoor}
              className="text-xs font-medium text-stone-500 transition hover:text-stone-700"
              aria-label={outdoorTheme ? "Turn off high contrast" : "High contrast (outdoor)"}
            >
              {outdoorTheme ? "High contrast on" : "High contrast"}
            </button>
            <button
              type="button"
              onClick={() => window.close()}
              className="text-sm text-stone-400 transition hover:text-stone-600"
              aria-label="Done, close this page"
            >
              Done
            </button>
          </div>
        </div>

        {/* Status card */}
        <section className={`mb-8 rounded-2xl p-6 ${config.bg} ${config.text}`}>
          <p className="text-sm font-medium uppercase tracking-wider opacity-80">Status</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">{config.label}</h2>
          {config.sublabel && <p className="mt-2 text-[15px] leading-relaxed opacity-90">{config.sublabel}</p>}
          {req?.exit?.code && (statusLine === "READY" || statusLine === "RETRIEVING" || statusLine === "PICKED_UP") && (
            <p className="mt-3 inline-block rounded-full bg-white/60 px-4 py-1.5 text-sm font-semibold">
              Exit {req.exit.code}
            </p>
          )}
          {statusLine === "READY" && req?.id && (
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                try {
                  const r = await fetch(`${API}/t/${token}/request/${req.id}/picked-up`, { method: "POST" });
                  if (!r.ok) throw new Error(await r.text());
                  await load();
                } catch (e) {
                  setStatusLine(String(e));
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-emerald-600 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              aria-label={loading ? "Marking as picked up" : "I got my car"}
            >
              {loading ? "…" : "Got my car"}
            </button>
          )}
          {req?.scheduled_for && (
            <p className="mt-3 text-sm opacity-90">
              Scheduled for {formatDateTime(req.scheduled_for)}
              <ScheduledCountdown scheduledFor={req.scheduled_for} />
            </p>
          )}
        </section>

        {/* Request section */}
        {canRequest && (
          <section className="card p-6">
            <h3 className="text-lg font-semibold text-stone-900">Request your car</h3>
            <p className="mt-1 text-sm text-stone-500">Pick your pickup exit and when you’d like your car.</p>

            <label htmlFor="pickup-exit" className="mt-4 block text-sm font-medium text-stone-700">Pickup exit</label>
            <select
              id="pickup-exit"
              value={selectedExit ?? ""}
              onChange={(e) => setSelectedExit(Number(e.target.value))}
              className="input-premium mt-1.5"
              aria-describedby="pickup-exit-desc"
            >
              {exits.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.code} — {ex.name}
                </option>
              ))}
            </select>

            <div className="mt-6" id="pickup-exit-desc">
              <button
                onClick={() => requestCar()}
                disabled={loading}
                className="btn-primary w-full py-4 text-base disabled:opacity-60"
                aria-label={loading ? "Requesting your car" : "Request my car now"}
              >
                {loading ? "Requesting…" : "Request my car now"}
              </button>
              <p className="mt-3 text-center text-sm text-stone-500">or schedule for later</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {[1, 5, 10].map((min) => (
                  <button
                    key={min}
                    onClick={() => requestCar(min)}
                    disabled={loading}
                    className="rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 disabled:opacity-60"
                  >
                    In {min} min
                  </button>
                ))}
              </div>
            </div>

            {req?.exit?.code && statusLine !== "No request yet" && (
              <p className="mt-4 text-center text-sm text-stone-500">
                Pickup at <strong>Exit {req.exit.code}</strong>
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
