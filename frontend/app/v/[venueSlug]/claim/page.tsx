"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE!;

type ConfirmResult = {
  ok: boolean;
  ticket_token?: string;
  guest_path?: string;
  masked_vehicle?: string;
  error?: string;
  message?: string;
};

function ClaimForm() {
  const params = useParams<{ venueSlug: string }>();
  const searchParams = useSearchParams();
  const venueSlug = params?.venueSlug ?? "";
  const phoneFromQuery = searchParams?.get("phone") ?? "";

  const [phone, setPhone] = useState(phoneFromQuery);
  const [claimCode, setClaimCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (phoneFromQuery) setPhone(phoneFromQuery);
  }, [phoneFromQuery]);

  const guestUrl = result?.guest_path
    ? typeof window !== "undefined"
      ? `${window.location.origin}${result.guest_path}`
      : result.guest_path
    : "";

  const copyLink = useCallback(async () => {
    if (!guestUrl) return;
    try {
      await navigator.clipboard.writeText(guestUrl);
      setToast("Copied!");
      setTimeout(() => setToast(""), 2000);
    } catch {
      setToast("Copy failed");
      setTimeout(() => setToast(""), 2000);
    }
  }, [guestUrl]);

  const textMeLink = useCallback(() => {
    if (!guestUrl || !phone) return;
    const message = `CurbKey valet link: ${guestUrl}`;
    const smsUrl = `sms:${phone.replace(/\s/g, "")}?body=${encodeURIComponent(message)}`;
    window.location.href = smsUrl;
  }, [guestUrl, phone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setResult(null);
    const p = phone.trim().replace(/\s/g, "");
    const code = claimCode.trim();
    if (!p || !code) {
      setErr("Please enter your phone number and the code from the valet.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${API}/v/${venueSlug}/claim/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p, claim_code: code }),
      });
      let data: Partial<ConfirmResult> = {};
      try {
        data = (await r.json()) as Partial<ConfirmResult>;
      } catch {
        if (r.status === 429) setErr("Too many attempts. Please try again in a few minutes.");
        else setErr("Something went wrong. Please try again.");
        return;
      }
      if (!r.ok) {
        const msg = data.error === "expired" ? "Code expired. Ask the valet for a new code." : (data.message || (r.status === 429 ? "Too many attempts. Please try again later." : "Invalid code. Please try again."));
        setErr(msg);
        return;
      }
      if (data.ok && data.guest_path) {
        setResult(data as ConfirmResult);
      } else {
        setErr(data.message || "Something went wrong.");
      }
    } catch (e) {
      setErr("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (result?.ok && guestUrl) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-100">
        <div className="mx-auto max-w-md px-6 py-12 sm:py-16">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
              You’re all set
            </h1>
            <p className="mt-2 text-stone-600">
              Your valet link is ready. Text it to yourself or open it now.
            </p>
            <p className="mt-3 text-sm font-medium text-stone-500">
              Link sent to your phone? You can close this tab.
            </p>
          </div>

          <section className="card card-hover p-6 sm:p-8">
            <p className="text-sm font-medium uppercase tracking-wider text-stone-500">Your link</p>
            <a
              href={guestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block break-all text-lg font-semibold text-[var(--primary)] hover:underline"
            >
              {guestUrl}
            </a>
            {result.masked_vehicle && (
              <p className="mt-3 text-sm text-stone-500">Vehicle: {result.masked_vehicle}</p>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={textMeLink}
                className="btn-primary w-full py-3.5 text-base"
              >
                Text me my link
              </button>
              <button
                type="button"
                onClick={copyLink}
                className="w-full rounded-lg border border-stone-300 bg-white py-3.5 text-base font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Copy link
              </button>
              <a
                href={guestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-accent w-full py-3.5 text-center text-base"
              >
                Open now
              </a>
            </div>
          </section>

          {toast && (
            <div className="toast-enter fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-stone-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
              {toast}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-100">
      <div className="mx-auto max-w-md px-6 py-12 sm:py-16">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            Enter your code
          </h1>
          <p className="mt-2 text-stone-600">
            Use the 6-digit code the valet gave you.
          </p>
        </div>

        <section className="card card-hover p-6 sm:p-8">
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-stone-700">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                placeholder="+1 585 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-premium mt-2"
              />
            </div>
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-stone-700">
                Claim code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value.replace(/\D/g, ""))}
                className="input-premium mt-2 text-center text-2xl tracking-[0.4em]"
              />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
            >
              {loading ? "Checking…" : "Get my link"}
            </button>
          </form>
        </section>

        <a
          href={`/v/${venueSlug}`}
          className="mt-6 block text-center text-sm font-medium text-stone-500 hover:text-stone-700"
        >
          ← Change phone number
        </a>
      </div>
    </div>
  );
}

export default function VenueClaimConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-50 flex items-center justify-center">Loading…</div>}>
      <ClaimForm />
    </Suspense>
  );
}
