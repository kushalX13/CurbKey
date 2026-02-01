"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CreateDemoTicketButton from "./CreateDemoTicketButton";
import { getStoredToken } from "./login/page";

export default function Home() {
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    setIsStaff(!!getStoredToken());
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100">
      <main className="mx-auto max-w-xl px-6 py-12 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          CurbKey
        </h1>
        <p className="mt-2 text-stone-600">
          Valet request & scheduling — request your car when you’re ready.
        </p>

        <div className="mt-12 flex flex-col gap-6">
          <section className="card card-hover p-6 transition">
            <h2 className="text-lg font-semibold text-stone-900">Customer (guest)</h2>
            <p className="mt-1.5 text-sm text-stone-500">
              Open a ticket link or create a demo ticket. No app download — just scan and go.
            </p>
            <div className="mt-4">
              <CreateDemoTicketButton />
            </div>
            <p className="mt-3 text-xs text-stone-400">
              Or go to: <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-600">/t/YOUR_TOKEN</code>
            </p>
          </section>

          {isStaff && (
            <>
              <section className="card card-hover p-6 transition">
                <h2 className="text-lg font-semibold text-stone-900">Valet</h2>
                <p className="mt-1.5 text-sm text-stone-500">
                  See requests, mark Retrieving → Ready → Picked up.
                </p>
                <Link href="/valet" className="btn-primary mt-4 inline-block px-5 py-2.5 text-sm">
                  Valet console →
                </Link>
              </section>

              <section className="card card-hover p-6 transition">
                <h2 className="text-lg font-semibold text-stone-900">Manager</h2>
                <p className="mt-1.5 text-sm text-stone-500">
                  Scheduler, notifications, tickets, and metrics.
                </p>
                <Link href="/manager" className="btn-primary mt-4 inline-block px-5 py-2.5 text-sm">
                  Manager console →
                </Link>
              </section>
            </>
          )}

        </div>

        {isStaff && (
          <p className="mt-10 text-xs text-stone-400">
            Default login after seed: <strong className="text-stone-600">admin@curbkey.com</strong> / <strong className="text-stone-600">admin123</strong>
          </p>
        )}
      </main>
    </div>
  );
}
