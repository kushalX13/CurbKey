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

export default function TicketPage() {
  const API = process.env.NEXT_PUBLIC_API_BASE!;
  const { token } = useParams<{ token: string }>();

  const [ticket, setTicket] = useState<TicketResp["ticket"] | null>(null);
  const [req, setReq] = useState<TicketResp["request"] | null>(null);
  const [exits, setExits] = useState<ExitT[]>([]);
  const [selectedExit, setSelectedExit] = useState<number | null>(null);
  const [statusLine, setStatusLine] = useState<string>("Loading...");
  const lastIdRef = useRef<number>(0);
  const esRef = useRef<EventSource | null>(null);
  const reqRef = useRef<TicketResp["request"] | null>(null);

  const venueId = ticket?.venue_id;

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

  const loadExits = async (venue_id: number) => {
    const r = await fetch(`${API}/api/venues/${venue_id}/exits`);
    if (!r.ok) throw new Error(await r.text());
    const data: ExitT[] = await r.json();
    setExits(data);
    if (!selectedExit && data.length) setSelectedExit(data[0].id);
  };

  const requestCar = async (delayMinutes?: number) => {
    if (!selectedExit) return;
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
  };

  // SSE connect
  const connectSSE = () => {
    if (esRef.current) esRef.current.close();

    const url = `${API}/t/${token}/events?last_id=${lastIdRef.current}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("status", (evt: MessageEvent) => {
      // expects valid JSON string
      const payload = JSON.parse(evt.data);
      lastIdRef.current = payload.id;
      setStatusLine(payload.to_status);
      // update request status locally (keep it minimal)
      setReq((prev) => {
        const next = prev ? { ...prev, status: payload.to_status } : prev;
        reqRef.current = next;
        return next;
      });

      // if this page had "No request yet", pull latest request from backend
      if (!reqRef.current) {
        load().catch(() => {});
      }
    });

    es.onerror = () => {
      // auto-reconnect after a moment
      es.close();
      setTimeout(connectSSE, 1500);
    };
  };

  useEffect(() => {
    load().catch((e) => setStatusLine(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (venueId) {
      loadExits(venueId).catch((e) => setStatusLine(String(e)));
      connectSSE();
    }
    return () => {
      if (esRef.current) esRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  return (
    <div className="min-h-screen bg-zinc-100 py-8">
    <main className="mx-auto max-w-lg rounded-xl bg-white p-6 font-sans text-zinc-900 shadow-md">
      <h1 className="text-2xl font-bold text-zinc-900">CurbKey</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Ticket: <strong className="font-mono">{token}</strong>
      </p>
      {ticket?.car_number && (
        <p className="mt-1 text-sm font-medium text-zinc-700">
          Your car: <strong className="uppercase tracking-wide">{ticket.car_number}</strong>
        </p>
      )}
      <a href="/" className="mt-2 inline-block text-sm text-zinc-500 hover:underline">← Home</a>

      <div className="mt-6 rounded-xl border-2 border-zinc-300 bg-zinc-50 p-4">
        <div className="text-sm font-medium text-zinc-600">Status</div>
        <div className="mt-2 text-xl font-bold text-zinc-900">{statusLine}</div>
        {req?.scheduled_for && (
          <div className="mt-2 text-sm text-zinc-600">
            Scheduled for: <strong>{new Date(req.scheduled_for).toLocaleString()}</strong>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl border-2 border-zinc-300 bg-zinc-50 p-4">
        <div className="font-semibold text-zinc-900">Request pickup exit</div>

        <select
          value={selectedExit ?? ""}
          onChange={(e) => setSelectedExit(Number(e.target.value))}
          className="mt-3 w-full rounded-lg border-2 border-zinc-300 bg-white px-3 py-2 text-zinc-900"
        >
          {exits.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.code} — {ex.name}
            </option>
          ))}
        </select>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => requestCar().catch((e) => alert(String(e)))}
            className="flex-1 rounded-xl bg-zinc-900 py-3 font-bold text-white hover:bg-zinc-800"
          >
            Request now
          </button>
          <button
            onClick={() => requestCar(1).catch((e) => alert(String(e)))}
            className="rounded-xl border-2 border-zinc-400 bg-white px-4 py-3 font-bold text-zinc-800 hover:bg-zinc-100"
          >
            In 1 min
          </button>
        </div>

        {req?.exit?.code && (
          <p className="mt-3 text-sm text-zinc-600">
            Current exit: <strong>{req.exit.code}</strong>
          </p>
        )}
      </div>
    </main>
    </div>
  );
}
