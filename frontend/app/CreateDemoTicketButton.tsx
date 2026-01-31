"use client";

import { useRouter } from "next/navigation";
import { getStoredToken } from "./login/page";

const API = process.env.NEXT_PUBLIC_API_BASE!;

export default function CreateDemoTicketButton() {
  const router = useRouter();

  const handleClick = async () => {
    const jwt = getStoredToken();
    if (!jwt) {
      router.push("/login?next=/");
      return;
    }
    try {
      const r = await fetch(`${API}/api/demo/ticket`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({}),
      });
      if (r.status === 401) {
        router.push("/login?next=/");
        return;
      }
      if (!r.ok) {
        const text = await r.text();
        alert(text || `Error ${r.status}`);
        return;
      }
      const data = await r.json();
      router.push(`/t/${data.token}`);
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-3 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
    >
      Open sample ticket
    </button>
  );
}
