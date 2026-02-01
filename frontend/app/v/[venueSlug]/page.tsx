"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function VenueClaimStartPage() {
  const router = useRouter();
  const params = useParams<{ venueSlug: string }>();
  const venueSlug = params?.venueSlug ?? "";
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const p = phone.trim().replace(/\s/g, "");
    if (!p) {
      setErr("Please enter your phone number.");
      return;
    }
    setLoading(true);
    router.push(`/v/${venueSlug}/claim?phone=${encodeURIComponent(p)}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-100">
      <div className="mx-auto max-w-md px-6 py-12 sm:py-16">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            Claim your valet ticket
          </h1>
          <p className="mt-2 text-stone-600">
            Enter your phone number to get your personal link.
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
                inputMode="numeric"
                placeholder="+1 585 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-premium mt-2 text-lg"
                autoFocus
              />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
            >
              Continue
            </button>
          </form>
        </section>

        <p className="mt-6 text-center text-xs text-stone-400">
          You’ll enter a short code from the valet on the next screen.
        </p>
      </div>
    </div>
  );
}
