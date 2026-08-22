// Cerca il prezzo di un volo verso l'aeroporto di riferimento di una struttura.
// Prova prima Google Flights via SerpApi (dati live, gratis fino a una soglia
// mensile), poi Travelpayouts come riserva (dati di cache fino a 7 giorni).
// Le chiavi sono private: per questo la ricerca gira qui e non nel browser.
export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body || {};
  const origin = normalizeIata(params.origin);
  const destination = normalizeIata(params.destination);
  const departureDate = params.departureDate;
  const returnDate = params.returnDate || undefined;

  if (!origin || !destination) {
    return res.status(400).json({ error: "Aeroporto di partenza e di arrivo (codice IATA) obbligatori." });
  }
  if (!departureDate || !/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    return res.status(400).json({ error: "Data di partenza mancante o in formato non valido (atteso AAAA-MM-GG)." });
  }

  const errors = [];

  const serpApiKey = process.env.SERPAPI_KEY;
  if (serpApiKey) {
    try {
      const price = await fetchFromSerpApi({ origin, destination, departureDate, returnDate, apiKey: serpApiKey });
      if (price != null) {
        return res.status(200).json({ price, source: "google_flights" });
      }
      errors.push("Google Flights: nessun volo trovato per queste date.");
    } catch (err) {
      console.error("flight-price/serpapi:", err);
      errors.push(`Google Flights non raggiungibile: ${err && err.message ? err.message : err}`);
    }
  } else {
    errors.push("SERPAPI_KEY non configurata.");
  }

  const tpToken = process.env.TRAVELPAYOUTS_TOKEN;
  if (tpToken) {
    try {
      const price = await fetchFromTravelpayouts({ origin, destination, departureDate, token: tpToken });
      if (price != null) {
        return res.status(200).json({ price, source: "travelpayouts" });
      }
      errors.push("Travelpayouts: nessun prezzo in cache per questa rotta.");
    } catch (err) {
      console.error("flight-price/travelpayouts:", err);
      errors.push(`Travelpayouts non raggiungibile: ${err && err.message ? err.message : err}`);
    }
  } else {
    errors.push("TRAVELPAYOUTS_TOKEN non configurato.");
  }

  return res.status(502).json({
    error: "Nessuna fonte prezzo voli disponibile al momento.",
    detail: errors,
  });
}

function normalizeIata(v) {
  if (typeof v !== "string") return "";
  return v.trim().toUpperCase();
}

async function fetchFromSerpApi({ origin, destination, departureDate, returnDate, apiKey }) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", departureDate);
  url.searchParams.set("currency", "EUR");
  url.searchParams.set("hl", "it");
  url.searchParams.set("api_key", apiKey);
  if (returnDate) {
    url.searchParams.set("return_date", returnDate);
    url.searchParams.set("type", "1"); // andata e ritorno
  } else {
    url.searchParams.set("type", "2"); // sola andata
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`SerpApi ha risposto ${resp.status}`);
  }
  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error);
  }

  const candidates = [...(data.best_flights || []), ...(data.other_flights || [])]
    .map((f) => Number(f.price))
    .filter((p) => isFinite(p) && p > 0);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

async function fetchFromTravelpayouts({ origin, destination, departureDate, token }) {
  const url = new URL("https://api.travelpayouts.com/v2/prices/latest");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("currency", "eur");
  url.searchParams.set("sorting", "price");
  url.searchParams.set("limit", "30");
  url.searchParams.set("token", token);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Travelpayouts ha risposto ${resp.status}`);
  }
  const data = await resp.json();
  if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
    return null;
  }

  // Preferisci un prezzo per una data di partenza nello stesso mese richiesto;
  // se non c'è, usa comunque il più economico trovato per la rotta (i dati sono
  // già in cache fino a 7 giorni, quindi è un'approssimazione dichiarata).
  const targetMonth = departureDate.slice(0, 7);
  const sameMonth = data.data.filter((d) => typeof d.depart_date === "string" && d.depart_date.startsWith(targetMonth));
  const pool = sameMonth.length > 0 ? sameMonth : data.data;

  const prices = pool.map((d) => Number(d.price)).filter((p) => isFinite(p) && p > 0);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}
