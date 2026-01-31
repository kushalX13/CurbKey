import Link from "next/link";
import CreateDemoTicketButton from "./CreateDemoTicketButton";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-100 p-8 font-sans">
      <main className="mx-auto max-w-lg">
        <h1 className="text-3xl font-bold text-zinc-900">CurbKey</h1>
        <p className="mt-2 text-zinc-600">Valet request & scheduling demo</p>

        <div className="mt-10 flex flex-col gap-4">
          <section className="rounded-xl border border-zinc-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Customer (guest)</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Create a demo ticket and open the guest page. Sign in as manager first.
            </p>
            <CreateDemoTicketButton />
            <p className="mt-2 text-xs text-zinc-500">
              Or go to: <code className="rounded bg-zinc-200 px-1">/t/YOUR_TOKEN</code>
            </p>
          </section>

          <section className="rounded-xl border border-zinc-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Valet</h2>
            <p className="mt-1 text-sm text-zinc-600">
              See requests, mark Retrieving / Ready / Picked up. Log in first.
            </p>
            <Link
              href="/valet"
              className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Valet console →
            </Link>
          </section>

          <section className="rounded-xl border border-zinc-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Manager</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Scheduler tick, notifications drain, requests. Log in as manager.
            </p>
            <Link
              href="/manager"
              className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Manager console →
            </Link>
          </section>
        </div>

        <p className="mt-8 text-xs text-zinc-500">
          Default login after seed: <strong>admin@curbkey.com</strong> / <strong>admin123</strong>
        </p>
      </main>
    </div>
  );
}
