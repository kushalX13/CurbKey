"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE!;
const JWT_KEY = "curbkey_jwt";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(JWT_KEY);
}

export function setStoredToken(token: string) {
  localStorage.setItem(JWT_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(JWT_KEY);
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/valet";

  const [email, setEmail] = useState("admin@curbkey.com");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setStoredToken(data.access_token);
      router.push(next);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-4 font-sans">
      <main className="w-full max-w-sm rounded-xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900">CurbKey — Sign in</h1>
        <p className="mt-1 text-sm text-zinc-600">Valet or Manager</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
              required
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-500">
          After seed: admin@curbkey.com / admin123
        </p>
        <a href="/" className="mt-3 inline-block text-sm text-zinc-600 hover:underline">
          ← Back to home
        </a>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-4 font-sans">
          <p className="text-zinc-600">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
