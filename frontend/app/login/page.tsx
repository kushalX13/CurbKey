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
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center p-6">
      <main className="w-full max-w-md card p-8" role="main">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Sign in</h1>
        <p className="mt-1 text-sm text-stone-500">Valet or Manager</p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-stone-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-premium mt-1.5"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-premium mt-1.5"
              required
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-xs text-stone-400">
          Demo: admin@curbkey.com / admin123
        </p>
        <a href="/" className="mt-4 inline-block text-sm text-stone-500 transition hover:text-stone-700">
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
        <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center p-6">
          <p className="text-stone-500">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
