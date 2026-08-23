import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../../lib/supabaseClient";
import {
  CONFIDENCE_LABELS,
  DEFAULT_CONFIG,
  Badge,
  CalendarPicker,
  SettingsSlider,
  computeSuggestion,
  formatEUR,
  formatPct,
  formatZ,
  isoToLabel,
  periodLabelFromDates,
  todayIso,
} from "../../components/ui";

// Un periodo del listino è "occupato" se si sovrappone a un evento del
// calendario iCal collegato (nessuna sovrapposizione = "libero").
function isOccupied(checkIn, checkOut, busyRanges) {
  return busyRanges.some((b) => checkIn < b.end && checkOut > b.start);
}

export default function PropertyPage() {
  const router = useRouter();
  const { id } = router.query;

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [property, setProperty] = useState(null);
  const [listino, setListino] = useState([]);
  const [flightChecks, setFlightChecks] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const [busyRanges, setBusyRanges] = useState([]);
  const [calendarError, setCalendarError] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);

  // --- form: nuovo periodo di listino ---
  const [newCheckIn, setNewCheckIn] = useState("");
  const [newCheckOut, setNewCheckOut] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [listinoSaving, setListinoSaving] = useState(false);
  const [listinoError, setListinoError] = useState("");

  // --- form: controllo rapido ---
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [origin, setOrigin] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkResult, setCheckResult] = useState(null); // { flightPrice, source, baseline, suggestion }
  const [savingCheck, setSavingCheck] = useState(false);

  // --- analisi periodo: quali giorni del periodo hanno il calo di prezzo
  // volo più significativo, con un suggerimento di prezzo per ciascuno ---
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState(null); // { days, mean, stdDev, sampleSize, ... }

  // --- modifica struttura ---
  const [editingProperty, setEditingProperty] = useState(false);
  const [editAirport, setEditAirport] = useState("");
  const [editIcalUrl, setEditIcalUrl] = useState("");
  const [savingProperty, setSavingProperty] = useState(false);

  // --- impostazioni ---
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadAll = useCallback(async (propertyId) => {
    const [{ data: propData, error: propErr }, { data: listinoData }, { data: checksData }, { data: settingsData }] =
      await Promise.all([
        supabase.from("properties").select("*").eq("id", propertyId).maybeSingle(),
        supabase.from("listino").select("*").eq("property_id", propertyId).order("check_in", { ascending: true }),
        supabase
          .from("flight_checks")
          .select("*")
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false }),
        supabase.from("settings").select("*").eq("property_id", propertyId).maybeSingle(),
      ]);

    if (propErr || !propData) {
      setNotFound(true);
      return;
    }

    setProperty(propData);
    setEditAirport(propData.airport_code || "");
    setEditIcalUrl(propData.ical_url || "");
    setListino(listinoData || []);
    setFlightChecks(checksData || []);
    setConfig(
      settingsData
        ? {
            elasticity: Number(settingsData.elasticity),
            capUp: Number(settingsData.cap_up),
            capDown: Number(settingsData.cap_down),
            threshold: Number(settingsData.threshold),
            // z_threshold è una colonna nuova: finché non esegui la migrazione
            // SQL sul database, per gli utenti esistenti non c'è ancora — in
            // quel caso si usa il valore di default finché non salvi di nuovo.
            zThreshold: settingsData.z_threshold != null ? Number(settingsData.z_threshold) : DEFAULT_CONFIG.zThreshold,
          }
        : DEFAULT_CONFIG
    );
  }, []);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace("/");
        return;
      }
      setSession(data.session);
      await loadAll(id);
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) router.replace("/");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [id, router, loadAll]);

  // Carica lo stato libero/occupato dal calendario iCal collegato, se presente.
  useEffect(() => {
    if (!property || !property.ical_url) {
      setBusyRanges([]);
      return;
    }
    let mounted = true;
    setCalendarLoading(true);
    setCalendarError("");

    fetch(`/api/ical-availability?url=${encodeURIComponent(property.ical_url)}`)
      .then(async (resp) => {
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || "Errore nella lettura del calendario.");
        return body;
      })
      .then((body) => {
        if (!mounted) return;
        setBusyRanges(body.busy || []);
      })
      .catch((err) => {
        if (!mounted) return;
        setCalendarError(err.message);
        setBusyRanges([]);
      })
      .finally(() => {
        if (mounted) setCalendarLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [property]);

  const selectedPeriod = useMemo(
    () => listino.find((p) => p.id === selectedPeriodId) || null,
    [listino, selectedPeriodId]
  );

  // Andamento dei controlli voli per il periodo selezionato, in ordine cronologico.
  const periodChecksChart = useMemo(() => {
    if (!selectedPeriod) return [];
    return flightChecks
      .filter((c) => c.check_in === selectedPeriod.check_in && c.check_out === selectedPeriod.check_out)
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((c) => ({
        data: new Date(c.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }),
        prezzo: Number(c.flight_price),
      }));
  }, [flightChecks, selectedPeriod]);

  async function handleAddListino(e) {
    e.preventDefault();
    setListinoError("");
    if (!newCheckIn || !newCheckOut || !newPrice) return;
    if (newCheckOut <= newCheckIn) {
      setListinoError("La data di check-out deve essere successiva al check-in.");
      return;
    }
    setListinoSaving(true);

    const { error } = await supabase.from("listino").upsert(
      {
        property_id: property.id,
        check_in: newCheckIn,
        check_out: newCheckOut,
        price: parseFloat(newPrice),
      },
      { onConflict: "property_id,check_in,check_out" }
    );

    setListinoSaving(false);
    if (error) {
      setListinoError(error.message);
      return;
    }
    setNewCheckIn("");
    setNewCheckOut("");
    setNewPrice("");
    loadAll(property.id);
  }

  async function handleDeleteListino(periodId) {
    await supabase.from("listino").delete().eq("id", periodId);
    if (selectedPeriodId === periodId) setSelectedPeriodId("");
    loadAll(property.id);
  }

  async function handleRunCheck(e) {
    e.preventDefault();
    setCheckError("");
    setCheckResult(null);
    if (!selectedPeriod) {
      setCheckError("Seleziona prima un periodo dal listino.");
      return;
    }
    if (!origin.trim()) {
      setCheckError("Inserisci l'aeroporto di partenza.");
      return;
    }
    setChecking(true);

    try {
      const resp = await fetch("/api/flight-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: origin.trim(),
          destination: property.airport_code,
          departureDate: selectedPeriod.check_in,
          returnDate: selectedPeriod.check_out,
        }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || "Ricerca prezzo volo non riuscita.");

      // Il riferimento per il suggerimento è il prezzo medio di mercato per
      // questa tratta calcolato su un periodo più lungo (storico prezzi
      // della rotta, o in fallback qualche giorno vicino alla data
      // richiesta), non il prezzo di un singolo giorno né lo storico dei
      // controlli salvati manualmente in passato. Insieme alla media si usa
      // anche la deviazione standard dello stesso pool di voli: il
      // suggerimento non scatta più a una % fissa uguale per ogni rotta, ma
      // quando il prezzo di oggi è statisticamente insolito per QUESTA
      // rotta (vedi computeSuggestion in components/ui.js).
      const baseline = body.average;
      const stats = { mean: body.average, stdDev: body.stdDev, count: body.sampleSize };
      const suggestion = baseline ? computeSuggestion(body.price, stats, selectedPeriod.price, config) : null;

      setCheckResult({
        flightPrice: body.price,
        average: body.average,
        sampleSize: body.sampleSize,
        averageBasis: body.averageBasis || "",
        source: body.source,
        baseline,
        suggestion,
      });
    } catch (err) {
      setCheckError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function handleScanPeriod() {
    setScanError("");
    setScanResult(null);
    if (!selectedPeriod) {
      setScanError("Seleziona prima un periodo dal listino.");
      return;
    }
    if (!origin.trim()) {
      setScanError("Inserisci l'aeroporto di partenza.");
      return;
    }
    setScanning(true);

    try {
      const resp = await fetch("/api/flight-price-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: origin.trim(),
          destination: property.airport_code,
          startDate: selectedPeriod.check_in,
          endDate: selectedPeriod.check_out,
        }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || "Analisi del periodo non riuscita.");
      setScanResult(body);
    } catch (err) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function handleSaveCheck() {
    if (!checkResult || !selectedPeriod) return;
    setSavingCheck(true);
    const { error } = await supabase.from("flight_checks").insert({
      property_id: property.id,
      check_in: selectedPeriod.check_in,
      check_out: selectedPeriod.check_out,
      origin: origin.trim().toUpperCase(),
      flight_price: checkResult.flightPrice,
      source: checkResult.source,
    });
    setSavingCheck(false);
    if (error) {
      setCheckError(error.message);
      return;
    }
    setCheckResult(null);
    loadAll(property.id);
  }

  async function handleSaveProperty(e) {
    e.preventDefault();
    setSavingProperty(true);
    const { error } = await supabase
      .from("properties")
      .update({
        airport_code: (editAirport.trim() || "BDS").toUpperCase(),
        ical_url: editIcalUrl.trim() || null,
      })
      .eq("id", property.id);
    setSavingProperty(false);
    if (!error) {
      setEditingProperty(false);
      loadAll(property.id);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    setSettingsSaved(false);
    const { error } = await supabase.from("settings").upsert(
      {
        property_id: property.id,
        elasticity: config.elasticity,
        cap_up: config.capUp,
        cap_down: config.capDown,
        threshold: config.threshold,
        z_threshold: config.zThreshold,
      },
      { onConflict: "property_id" }
    );
    setSavingSettings(false);
    if (!error) {
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    }
  }

  if (loading) {
    return (
      <div className="page-center">
        <p className="text-dim">Caricamento…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-center">
        <div className="card">
          <p>Struttura non trovata (o non hai accesso).</p>
          <Link href="/dashboard" className="btn btn-secondary">
            Torna alla dashboard
          </Link>
        </div>
      </div>
    );
  }

  const today = todayIso();

  return (
    <div className="container">
      <header className="topbar">
        <div>
          <Link href="/dashboard" className="back-link">
            ← Le tue strutture
          </Link>
          <h1>{property.name}</h1>
        </div>
      </header>

      {/* Dettagli struttura */}
      <div className="card">
        <div className="card-header-row">
          <h2>Struttura</h2>
          <button className="btn btn-ghost" onClick={() => setEditingProperty((v) => !v)}>
            {editingProperty ? "Annulla" : "Modifica"}
          </button>
        </div>
        {editingProperty ? (
          <form onSubmit={handleSaveProperty} className="stack">
            <label className="field">
              <span>Aeroporto di riferimento (codice IATA)</span>
              <input
                className="input"
                value={editAirport}
                onChange={(e) => setEditAirport(e.target.value)}
                maxLength={4}
              />
            </label>
            <label className="field">
              <span>Link calendario iCal</span>
              <input
                className="input"
                type="url"
                value={editIcalUrl}
                onChange={(e) => setEditIcalUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={savingProperty}>
              {savingProperty ? "Salvataggio…" : "Salva"}
            </button>
          </form>
        ) : (
          <div className="stack">
            <p className="text-dim">
              Aeroporto di riferimento: <strong className="text-ink">{property.airport_code}</strong>
            </p>
            <p className="text-dim">
              Calendario iCal: {property.ical_url ? <strong className="text-ink">collegato</strong> : "non collegato"}
            </p>
            {calendarLoading && <p className="text-dim">Lettura calendario…</p>}
            {calendarError && <p className="notice notice-error">{calendarError}</p>}
          </div>
        )}
      </div>

      {/* Disponibilità e prezzi */}
      <div className="card">
        <h2>Disponibilità e prezzi</h2>
        {listino.length === 0 && <p className="text-dim empty-msg">Nessun periodo nel listino ancora.</p>}
        <div className="period-list">
          {listino.map((p) => {
            const occupied = property.ical_url ? isOccupied(p.check_in, p.check_out, busyRanges) : null;
            const lastCheck = flightChecks.find((c) => c.check_in === p.check_in && c.check_out === p.check_out);
            return (
              <div key={p.id} className="period-row">
                <div className="period-row-main">
                  <strong>{periodLabelFromDates(p.check_in, p.check_out)}</strong>
                  <span className="text-dim">{formatEUR(Number(p.price))}</span>
                </div>
                <div className="period-row-badges">
                  {occupied !== null && <Badge action={occupied ? "occupato" : "libero"} />}
                  {lastCheck && <Badge action="riferimento" />}
                  <button className="icon-text-btn" onClick={() => handleDeleteListino(p.id)}>
                    Rimuovi
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <h3 className="subheading">Aggiungi periodo</h3>
        <form onSubmit={handleAddListino} className="stack">
          <div className="two-col">
            <CalendarPicker label="Check-in" value={newCheckIn} onChange={setNewCheckIn} minDate={today} />
            <CalendarPicker label="Check-out" value={newCheckOut} onChange={setNewCheckOut} minDate={newCheckIn || today} />
          </div>
          <label className="field">
            <span>Prezzo a notte (€)</span>
            <input
              className="input"
              type="number"
              min="0"
              step="1"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={listinoSaving}>
            {listinoSaving ? "Salvataggio…" : "Aggiungi al listino"}
          </button>
          {listinoError && <p className="notice notice-error">{listinoError}</p>}
        </form>
      </div>

      {/* Controllo rapido */}
      <div className="card">
        <h2>Controllo rapido</h2>
        <p className="text-dim">
          Cerca il prezzo attuale di un volo per un periodo del listino e confrontalo con il prezzo medio dei
          voli su quella rotta osservato in un periodo più lungo, non solo in quel singolo giorno. Se il periodo
          è lungo (una settimana, un mese), puoi anche analizzarlo giorno per giorno per scoprire quali date
          hanno il calo di prezzo dei voli più significativo, con un suggerimento di prezzo specifico per quei
          giorni.
        </p>
        <form onSubmit={handleRunCheck} className="stack">
          <label className="field">
            <span>Periodo</span>
            <select
              className="input"
              value={selectedPeriodId}
              onChange={(e) => {
                setSelectedPeriodId(e.target.value);
                setCheckResult(null);
              }}
              required
            >
              <option value="">Seleziona un periodo dal listino…</option>
              {listino.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabelFromDates(p.check_in, p.check_out)} — {formatEUR(Number(p.price))}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Aeroporto di partenza (codice IATA)</span>
            <input
              className="input"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="es. MXP"
              maxLength={4}
              required
            />
          </label>
          <div className="two-col">
            <button type="submit" className="btn btn-primary" disabled={checking}>
              {checking ? "Ricerca…" : "Cerca prezzo volo attuale"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleScanPeriod} disabled={scanning}>
              {scanning ? "Analisi in corso…" : "Analizza tutto il periodo"}
            </button>
          </div>
          {checkError && <p className="notice notice-error">{checkError}</p>}
          {scanError && <p className="notice notice-error">{scanError}</p>}
        </form>

        {checkResult && (
          <div className="suggestion-box">
            <div className="suggestion-row">
              <span className="text-dim">Prezzo volo trovato</span>
              <strong>{formatEUR(checkResult.flightPrice)}</strong>
            </div>
            <div className="suggestion-row">
              <span className="text-dim">Fonte</span>
              <span>{checkResult.source === "google_flights" ? "Google Flights" : "Travelpayouts (cache)"}</span>
            </div>
            {checkResult.baseline == null ? (
              <p className="notice notice-info">
                Non è stato possibile calcolare un prezzo medio di mercato per questa ricerca: nessun suggerimento
                disponibile.
              </p>
            ) : (
              <>
                <div className="suggestion-row">
                  <span className="text-dim">
                    Prezzo medio di mercato
                    {checkResult.sampleSize ? ` (su ${checkResult.sampleSize} voli trovati)` : ""}
                  </span>
                  <strong>{formatEUR(checkResult.baseline)}</strong>
                </div>
                <p className="text-dim" style={{ fontSize: 12.5, marginTop: -4 }}>
                  {checkResult.averageBasis === "storico" &&
                    "Media calcolata sullo storico prezzi di questa rotta (ultimi periodi osservati da Google Flights), non sul singolo giorno cercato."}
                  {checkResult.averageBasis === "date vicine" &&
                    "Su questa data erano disponibili pochi voli: la media include anche qualche giorno vicino sulla stessa rotta, per un riferimento più stabile."}
                  {checkResult.averageBasis === "mese" &&
                    "Media calcolata sui prezzi in cache per questa rotta nel periodo, non sul singolo giorno cercato."}
                  {checkResult.averageBasis === "singola data" &&
                    "Nessuno storico disponibile per questa rotta: la media è calcolata solo sui voli trovati per la data esatta cercata."}
                </p>
                <div className="suggestion-row">
                  <span className="text-dim">Variazione rispetto alla media</span>
                  <strong>{formatPct(checkResult.suggestion.varPct)}</strong>
                </div>
                <div className="suggestion-row">
                  <span className="text-dim">Scostamento statistico (deviazioni standard)</span>
                  <strong>{formatZ(checkResult.suggestion.z)}</strong>
                </div>
                <div className="suggestion-row">
                  <span className="text-dim">Affidabilità del dato</span>
                  <strong>
                    {CONFIDENCE_LABELS[checkResult.suggestion.confidenceLevel]}
                    {checkResult.suggestion.n ? ` (su ${checkResult.suggestion.n} voli storici)` : ""}
                  </strong>
                </div>
                {!checkResult.suggestion.significant && (
                  <p className="text-dim" style={{ fontSize: 12.5, marginTop: -4 }}>
                    Lo scostamento non è abbastanza insolito per questa rotta (o i dati storici sono troppo pochi
                    per giudicarlo): il sistema preferisce non proporre variazioni non giustificate dai dati.
                  </p>
                )}
                <div className="suggestion-row">
                  <span className="text-dim">Suggerimento</span>
                  <Badge action={checkResult.suggestion.action} />
                </div>
                <div className="suggestion-row">
                  <span className="text-dim">Nuovo prezzo camera suggerito</span>
                  <strong>{formatEUR(checkResult.suggestion.newRoom)}</strong>
                </div>
              </>
            )}
            <button className="btn btn-primary" onClick={handleSaveCheck} disabled={savingCheck}>
              {savingCheck ? "Salvataggio…" : "Salva controllo"}
            </button>
          </div>
        )}

        {scanResult && (
          <div className="suggestion-box">
            <h3 className="subheading" style={{ marginTop: 0 }}>
              Giorni del periodo per calo di prezzo del volo
            </h3>
            <p className="text-dim" style={{ fontSize: 12.5 }}>
              {scanResult.scannedDays < scanResult.totalDaysInPeriod
                ? `Il periodo ha ${scanResult.totalDaysInPeriod} giorni: ne sono stati analizzati ${scanResult.scannedDays}, distribuiti su tutto l'intervallo, per contenere il numero di ricerche.`
                : `Tutti i ${scanResult.totalDaysInPeriod} giorni del periodo sono stati analizzati.`}{" "}
              Prezzo medio del volo nel periodo: {formatEUR(scanResult.mean)} (su {scanResult.sampleSize} giorni con
              voli trovati). I giorni sono ordinati dal calo di prezzo più significativo al rialzo più
              significativo.
            </p>
            <div className="period-list">
              {scanResult.days.map((d) => {
                const daySuggestion = computeSuggestion(
                  d.price,
                  { mean: scanResult.mean, stdDev: scanResult.stdDev, count: scanResult.sampleSize },
                  selectedPeriod.price,
                  config
                );
                return (
                  <div key={d.date} className="period-row">
                    <div className="period-row-main">
                      <strong>{isoToLabel(d.date)}</strong>
                      <span className="text-dim">
                        Volo: {formatEUR(d.price)} ({formatPct(d.varPct)} vs media del periodo, {formatZ(d.z)})
                      </span>
                    </div>
                    <div className="period-row-badges">
                      {daySuggestion && <Badge action={daySuggestion.action} />}
                      {daySuggestion && <span className="text-dim">{formatEUR(daySuggestion.newRoom)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {scanResult.skippedDates && scanResult.skippedDates.length > 0 && (
              <p className="text-dim" style={{ fontSize: 12.5 }}>
                Nessun volo trovato per: {scanResult.skippedDates.map((d) => isoToLabel(d)).join(", ")}.
              </p>
            )}
          </div>
        )}

        {periodChecksChart.length >= 2 && (
          <>
            <h3 className="subheading">Andamento prezzo volo — periodo selezionato</h3>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={periodChecksChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} stroke="var(--dim)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--dim)" width={48} />
                  <Tooltip formatter={(v) => formatEUR(v)} />
                  <Line type="monotone" dataKey="prezzo" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {flightChecks.length > 0 && (
          <>
            <h3 className="subheading">Storico controlli</h3>
            <div className="period-list">
              {flightChecks.slice(0, 10).map((c) => (
                <div key={c.id} className="period-row">
                  <div className="period-row-main">
                    <strong>{periodLabelFromDates(c.check_in, c.check_out)}</strong>
                    <span className="text-dim">
                      {c.origin} → {property.airport_code}: {formatEUR(Number(c.flight_price))}
                    </span>
                  </div>
                  <span className="text-dim">{new Date(c.created_at).toLocaleDateString("it-IT")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Impostazioni del modello */}
      <div className="card">
        <h2>Impostazioni</h2>
        <p className="text-dim">
          Regolano quanto il suggerimento di prezzo reagisce alla variazione del prezzo dei voli.
        </p>
        <SettingsSlider
          label="Elasticità"
          value={config.elasticity}
          min={0}
          max={1}
          step={0.05}
          display={config.elasticity.toFixed(2)}
          onChange={(v) => setConfig((c) => ({ ...c, elasticity: v }))}
        />
        <SettingsSlider
          label="Tetto massimo di aumento"
          value={config.capUp}
          min={0}
          max={50}
          step={1}
          display={`${config.capUp}%`}
          onChange={(v) => setConfig((c) => ({ ...c, capUp: v }))}
        />
        <SettingsSlider
          label="Tetto massimo di riduzione"
          value={config.capDown}
          min={0}
          max={50}
          step={1}
          display={`${config.capDown}%`}
          onChange={(v) => setConfig((c) => ({ ...c, capDown: v }))}
        />
        <SettingsSlider
          label="Sensibilità statistica (deviazioni standard)"
          value={config.zThreshold}
          min={0.3}
          max={3}
          step={0.1}
          display={`${config.zThreshold.toFixed(1)}σ`}
          onChange={(v) => setConfig((c) => ({ ...c, zThreshold: v }))}
        />
        <p className="text-dim" style={{ fontSize: 12.5, marginTop: -8, marginBottom: 14 }}>
          Determina quanto il prezzo del volo deve discostarsi dalla normale variabilità storica di quella rotta,
          prima che venga proposta una variazione di prezzo. Un valore più basso rende il suggerimento più
          reattivo, uno più alto più prudente.
        </p>
        <SettingsSlider
          label="Soglia minima di variazione (riserva, senza storico)"
          value={config.threshold}
          min={0}
          max={20}
          step={1}
          display={`${config.threshold}%`}
          onChange={(v) => setConfig((c) => ({ ...c, threshold: v }))}
        />
        <p className="text-dim" style={{ fontSize: 12.5, marginTop: -8, marginBottom: 14 }}>
          Usata solo quando non c'è ancora abbastanza storico prezzi per calcolare la variabilità della rotta.
        </p>
        <button className="btn btn-primary" onClick={handleSaveSettings} disabled={savingSettings}>
          {savingSettings ? "Salvataggio…" : "Salva impostazioni"}
        </button>
        {settingsSaved && <p className="notice notice-ok">Impostazioni salvate.</p>}
      </div>
    </div>
  );
}
