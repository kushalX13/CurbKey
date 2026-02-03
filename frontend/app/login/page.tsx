"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE!;
const JWT_KEY = "curbkey_jwt";

const VALET_CREDS = { email: "valet@demo.curbkey.com", password: "valet123" };
const MANAGER_CREDS = { email: "admin@curbkey.com", password: "admin123" };

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
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (next === "/valet") {
      setEmail(VALET_CREDS.email);
      setPassword(VALET_CREDS.password);
    } else if (next === "/manager") {
      setEmail(MANAGER_CREDS.email);
      setPassword(MANAGER_CREDS.password);
    }
  }, [next]);

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
      const role = data.user?.role;
      if (role === "VALET") router.push("/valet");
      else if (role === "MANAGER") router.push("/manager");
      else router.push(next || "/valet");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (next !== "/valet" && next !== "/manager") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center p-6">
        <main className="w-full max-w-md space-y-6" role="main">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">Staff sign in</h1>
            <p className="mt-1 text-sm text-stone-500">Choose Valet or Manager to sign in.</p>
          </div>
          <div className="grid gap-4">
            <Link
              href="/login?next=/valet"
              className="card card-hover block p-6 text-left transition"
            >
              <h2 className="text-lg font-semibold text-stone-900">Valet</h2>
              <p className="mt-1 text-sm text-stone-500">Valet console — requests, status, car details.</p>
              <span className="btn-primary mt-4 inline-block px-5 py-2.5 text-sm">Log in as Valet →</span>
            </Link>
            <Link
              href="/login?next=/manager"
              className="card card-hover block p-6 text-left transition"
            >
              <h2 className="text-lg font-semibold text-stone-900">Manager</h2>
              <p className="mt-1 text-sm text-stone-500">Manager console — demo kit, scheduler, tips.</p>
              <span className="btn-primary mt-4 inline-block px-5 py-2.5 text-sm">Log in as Manager →</span>
            </Link>
          </div>
          <p className="text-center text-xs text-stone-400">
            Valet: valet@demo.curbkey.com / valet123 · Manager: admin@curbkey.com / admin123 (after seed)
          </p>
          <a href="/" className="block text-center text-sm text-stone-500 hover:text-stone-700">
            ← Back to home
          </a>
        </main>
      </div>
    );
  }

  const isValet = next === "/valet";
  const title = isValet ? "Valet sign in" : "Manager sign in";
  const subtitle = isValet ? "Valet console" : "Manager console";

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center p-6">
      <main className="w-full max-w-md card p-8" role="main">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        <p className="mt-1 text-sm text-stone-500">{subtitle}</p>

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
          {isValet ? `Demo: ${VALET_CREDS.email} / ${VALET_CREDS.password}` : `Demo: ${MANAGER_CREDS.email} / ${MANAGER_CREDS.password}`}
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm text-stone-500 hover:text-stone-700">
          ← Choose Valet or Manager
        </Link>
        <a href="/" className="mt-2 block text-sm text-stone-500 hover:text-stone-700">
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
