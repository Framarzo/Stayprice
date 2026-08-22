import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

// Login via magic link: nessuna password, l'utente riceve un'email con un
// link che lo autentica direttamente su /dashboard.
export default function Home() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        router.replace("/dashboard");
      } else {
        setCheckingSession(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace("/dashboard");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  if (checkingSession) {
    return (
      <div className="page-center">
        <p className="text-dim">Caricamento…</p>
      </div>
    );
  }

  return (
    <div className="page-center">
      <div className="card auth-card">
        <h1>Tabellone</h1>
        <p className="text-dim">Accedi con un link via email — nessuna password da ricordare.</p>

        {status === "sent" ? (
          <p className="notice notice-ok">
            Ti abbiamo inviato un link di accesso a <strong>{email}</strong>. Aprilo da questo dispositivo per
            entrare.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="stack">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                autoFocus
                className="input"
                placeholder="nome@esempio.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={status === "sending"}>
              {status === "sending" ? "Invio…" : "Invia link di accesso"}
            </button>
            {status === "error" && <p className="notice notice-error">{errorMsg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
