import { useState, type FormEvent } from "react";
import { SiteHeader } from "./SiteHeader";

export function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("ops@harbourfreight.example");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch {
      setError("That email and password did not match.");
      setBusy(false);
    }
  };

  return (
    <>
      <SiteHeader />
      <div className="wrap sheet" style={{ display: "flex" }}>
        <main className="login">
          <form onSubmit={submit}>
            <p className="wordmark">Harbour Ops</p>
            <p className="muted">Today's jobs, one screen. Demo user: ops@harbourfreight.example, password harbour-demo.</p>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" disabled={busy}>Sign in</button>
          </form>
        </main>
      </div>
    </>
  );
}
