"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type ExitT = { id: number; code: string; name: string };
type TicketResp = {
  ticket: { id: number; venue_id: number; token: string; car_number?: string | null };
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100">
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-stone-900">CurbKey</h1>
            {ticket?.car_number && (
              <p className="mt-0.5 text-sm text-stone-500">
                Your car: <span className="font-medium uppercase tracking-wide text-stone-700">{ticket.car_number}</span>
              </p>
            )}
          </div>
          <a
            href="/"
            className="text-sm text-stone-400 transition hover:text-stone-600"
            aria-label="Back to home"
          >
            ← Home
          </a>
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
          {req?.scheduled_for && (
            <p className="mt-3 text-sm opacity-90">
              Scheduled for {new Date(req.scheduled_for).toLocaleString()}
            </p>
          )}
        </section>

        {/* Request section */}
        {canRequest && (
          <section className="card p-6">
            <h3 className="text-lg font-semibold text-stone-900">Request your car</h3>
            <p className="mt-1 text-sm text-stone-500">Pick your pickup exit and when you’d like your car.</p>

            <label className="mt-4 block text-sm font-medium text-stone-700">Pickup exit</label>
            <select
              value={selectedExit ?? ""}
              onChange={(e) => setSelectedExit(Number(e.target.value))}
              className="input-premium mt-1.5"
            >
              {exits.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.code} — {ex.name}
                </option>
              ))}
            </select>

            <div className="mt-6">
              <button
                onClick={() => requestCar()}
                disabled={loading}
                className="btn-primary w-full py-4 text-base disabled:opacity-60"
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
