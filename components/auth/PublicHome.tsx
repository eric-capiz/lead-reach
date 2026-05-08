"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublicHome() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);

  const submit = async () => {
    setError(null);
    const u = username.trim();
    const p = password;
    if (!u) return setError("Username required");
    if (!p) return setError("Password required");

    try {
      setBusy(true);
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      const j = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) throw new Error(j.error || "Request failed");
      if (mode === "register") {
        router.push("/?registered=1");
      } else {
        router.push("/");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-lux-bg text-lux-fg-dim">
      <div
        className="pointer-events-none fixed inset-0 opacity-100"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse 70% 50% at 50% -20%, var(--color-lux-gold-glow), transparent 55%)",
            "radial-gradient(ellipse 45% 40% at 100% 0%, rgba(45, 212, 191, 0.06), transparent 50%)",
            "radial-gradient(ellipse 40% 35% at 0% 80%, rgba(159, 27, 61, 0.07), transparent 50%)",
          ].join(", "),
        }}
      />

      <div className="relative mx-auto max-w-3xl px-4 pb-24 pt-16 sm:px-6 lg:px-8">
        <header className="space-y-4 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.38em] text-lux-gold-bright">
            Outreach command
          </p>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-lux-fg sm:text-5xl">
            LeadReach
          </h1>
          <p className="mx-auto max-w-xl text-sm text-lux-muted">
            Find local businesses by category, pull maps + web info, and generate ready-to-send outreach messages.
          </p>
        </header>

        <div className="mt-10 grid gap-4 rounded-sm border border-lux-line bg-lux-panel/90 p-6 shadow-[0_1px_0_var(--color-lux-rim)_inset,0_12px_40px_-12px_rgba(0,0,0,0.45)]">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 rounded-sm px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                mode === "login"
                  ? "bg-gradient-to-b from-lux-primary to-[#8a721f] text-lux-primary-fg"
                  : "text-lux-muted hover:bg-lux-gold-soft/50 hover:text-lux-fg"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError(null);
              }}
              className={`flex-1 rounded-sm px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                mode === "register"
                  ? "bg-gradient-to-b from-lux-primary to-[#8a721f] text-lux-primary-fg"
                  : "text-lux-muted hover:bg-lux-gold-soft/50 hover:text-lux-fg"
              }`}
            >
              Register
            </button>
          </div>

          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-lux-gold-muted">
                Username
              </span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm outline-none focus:border-lux-gold"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-lux-teal">
                Password
              </span>
              <div className="flex items-center gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  className="flex-1 rounded-sm border border-lux-line bg-lux-field px-3 py-2 text-sm outline-none focus:border-lux-gold"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="rounded-sm border border-lux-line bg-lux-canvas px-3 py-2 text-xs font-semibold text-lux-muted hover:text-lux-fg"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            {error ? (
              <p className="rounded-sm border border-lux-crimson/40 bg-lux-crimson-soft/30 px-3 py-2 text-sm text-lux-crimson">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="w-full rounded-sm bg-lux-primary px-5 py-3 text-xs font-semibold uppercase tracking-wider text-lux-primary-fg shadow-[0_8px_28px_-8px_rgba(201,162,39,0.35)] transition hover:bg-lux-primary-hover disabled:opacity-40"
            >
              {busy ? "Working…" : mode === "login" ? "Login" : "Create account"}
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

