"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "same-origin",
    });

    setBusy(false);
    if (response.ok) {
      router.replace("/admin/dashboard");
      router.refresh();
      return;
    }

    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      errors?: Record<string, string[]>;
    };
    setErrors(body.errors ?? {});
    setMessage(body.message ?? "Login failed.");
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-col items-center gap-2 pb-2 text-center">
        <Image src="/logo.png" alt="National Exam Preparation" width={112} height={112} priority className="rounded-full" />
        <h1 className="text-xl font-semibold">Admin sign in</h1>
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          autoComplete="email"
          required
        />
        {errors.email?.map((error) => (
          <p key={error} className="mt-1 text-xs text-rose-600">
            {error}
          </p>
        ))}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          autoComplete="current-password"
          required
        />
        {errors.password?.map((error) => (
          <p key={error} className="mt-1 text-xs text-rose-600">
            {error}
          </p>
        ))}
      </div>

      {message ? <p className="text-sm text-rose-600">{message}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
