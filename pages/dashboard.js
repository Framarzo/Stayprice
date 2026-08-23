import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { PROPERTY_TYPE_LABELS, PROPERTY_TYPES } from "../components/ui";

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);

  const [name, setName] = useState("");
  const [airportCode, setAirportCode] = useState("BDS");
  const [icalUrl, setIcalUrl] = useState("");
  const [propertyType, setPropertyType] = useState("standard");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const loadProperties = useCallback(async () => {
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setProperties(data || []);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace("/");
        return;
      }
      setSession(data.session);
      setLoading(false);
      loadProperties();
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) router.replace("/");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [router, loadProperties]);

  async function handleAddProperty(e) {
    e.preventDefault();
    if (!name.trim() || !session) return;
    setSaving(true);
    setErrorMsg("");

    const { error } = await supabase.from("properties").insert({
      user_id: session.user.id,
      name: name.trim(),
      airport_code: (airportCode.trim() || "BDS").toUpperCase(),
      ical_url: icalUrl.trim() || null,
      property_type: propertyType,
    });

    setSaving(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setName("");
    setAirportCode("BDS");
    setIcalUrl("");
    setPropertyType("standard");
    loadProperties();
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="page-center">
        <p className="text-dim">Caricamento…</p>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="topbar">
        <h1>Le tue strutture</h1>
        <button className="btn btn-ghost" onClick={handleLogout}>
          Esci
        </button>
      </header>

      <div className="grid-cards">
        {properties.map((p) => (
          <Link key={p.id} href={`/property/${p.id}`} className="card property-card">
            <h3>{p.name}</h3>
            <p className="text-dim">
              Fascia: {PROPERTY_TYPE_LABELS[p.property_type] || PROPERTY_TYPE_LABELS.standard}
            </p>
            <p className="text-dim">Aeroporto di riferimento: {p.airport_code}</p>
            <p className="text-dim">{p.ical_url ? "Calendario collegato" : "Nessun calendario collegato"}</p>
          </Link>
        ))}
        {properties.length === 0 && (
          <p className="text-dim empty-msg">Non hai ancora aggiunto nessuna struttura.</p>
        )}
      </div>

      <div className="card">
        <h2>Aggiungi struttura</h2>
        <form onSubmit={handleAddProperty} className="stack">
          <label className="field">
            <span>Nome struttura</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="es. Villa al Mare"
              required
            />
          </label>
          <label className="field">
            <span>Aeroporto di riferimento (codice IATA)</span>
            <input
              className="input"
              value={airportCode}
              onChange={(e) => setAirportCode(e.target.value)}
              placeholder="BDS"
              maxLength={4}
            />
          </label>
          <label className="field">
            <span>Link calendario iCal (facoltativo)</span>
            <input
              className="input"
              type="url"
              value={icalUrl}
              onChange={(e) => setIcalUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className="field">
            <span>Fascia della struttura</span>
            <select className="input" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-dim" style={{ fontSize: 12.5, marginTop: -8 }}>
            Determina i valori di partenza della strategia di prezzo (quanto e quanto in fretta il prezzo reagisce
            al costo dei voli) — resta comunque regolabile in ogni momento dalle Impostazioni della struttura.
          </p>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvataggio…" : "Aggiungi struttura"}
          </button>
          {errorMsg && <p className="notice notice-error">{errorMsg}</p>}
        </form>
      </div>
    </div>
  );
}
