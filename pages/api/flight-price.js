// Cerca il prezzo di un volo verso l'aeroporto di riferimento di una struttura.
// Prova prima Google Flights via SerpApi (dati live, gratis fino a una soglia
// mensile), poi Travelpayouts come riserva (dati di cache fino a 7 giorni).
// Le chiavi sono private: per questo la ricerca gira qui e non nel browser.
//
// Il "prezzo trovato" mostrato all'utente è sempre quello per la data
// esatta richiesta. Il riferimento usato per il suggerimento, invece, NON è
// il prezzo di un singolo giorno: è il prezzo medio dei voli su quella
// stessa tratta osservato in un periodo più lungo, così un solo volo raro o
// fuori mercato in un singolo giorno non falsa il confronto.
//
// Fonte preferita per la media: il grafico storico prezzi che Google
// Flights calcola per ogni rotta (SerpApi lo espone come
// price_insights.price_history, tipicamente gli ultimi ~2 mesi di prezzi
// osservati) — un solo campo, una sola richiesta, e già rappresentativo di
// un periodo lungo invece che di una singola data.
//
// Se per una rotta Google non fornisce questo storico, si ricade su un
// fallback: si allarga la ricerca a qualche giorno vicino alla data
// richiesta (stessa tratta) e si uniscono i prezzi trovati in un unico
// pool, per avere comunque una media su più giorni invece che su uno solo.
const MIN_HISTORY_SAMPLE = 1;
const MIN_WIDEN_SAMPLE = 3;
const NEARBY_DAY_OFFSETS = [-1, 1, -2, 2, -3, 3, -5, 5, -7, 7];

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
      const result = await fetchFromSerpApi({ origin, destination, departureDate, returnDate, apiKey: serpApiKey });
      if (result != null) {
        return res.status(200).json({
          price: result.min,
          average: result.average,
          stdDev: result.stdDev,
          sampleSize: result.count,
          averageBasis: result.basis,
          source: "google_flights",
        });
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
      const result = await fetchFromTravelpayouts({ origin, destination, departureDate, token: tpToken });
      if (result != null) {
        return res.status(200).json({
          price: result.min,
          average: result.average,
          stdDev: result.stdDev,
          sampleSize: result.count,
          averageBasis: "mese",
          source: "travelpayouts",
        });
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

// Media aritmetica semplice; non è statisticamente robusta (un solo volo di
// lusso può alzarla parecchio), ma è la scelta più prevedibile e facile da
// spiegare a un utente non tecnico.
function average(nums) {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// Deviazione standard campionaria dei prezzi del pool usato per la media.
// Serve al front-end per giudicare quanto è "insolito" (in deviazioni
// standard, non in una % fissa uguale per ogni rotta) il prezzo trovato
// oggi rispetto alla normale variabilità storica di quella rotta. Con un
// solo campione la deviazione standard non è definita: si restituisce 0 e
// il front-end ricade su una soglia percentuale fissa di riserva.
function stdDev(nums) {
  if (nums.length < 2) return 0;
  const m = average(nums);
  const variance = nums.reduce((s, x) => s + (x - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function shiftDate(iso, offsetDays) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromIso, toIso) {
  const a = new Date(fromIso + "T00:00:00Z");
  const b = new Date(toIso + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

async function fetchFromSerpApi({ origin, destination, departureDate, returnDate, apiKey }) {
  const primaryData = await fetchSerpApiRaw({ origin, destination, departureDate, returnDate, apiKey });
  if (primaryData == null) return null;

  const primaryCandidates = extractFlightPrices(primaryData);
  if (primaryCandidates.length === 0) return null;
  const min = Math.min(...primaryCandidates);

  // 1) Preferita: lo storico prezzi della rotta calcolato da Google Flights
  // (un periodo di settimane/mesi, non un singolo giorno).
  const history = extractPriceHistory(primaryData);
  if (history.length >= MIN_HISTORY_SAMPLE) {
    return { min, average: average(history), stdDev: stdDev(history), count: history.length, basis: "storico" };
  }

  // 2) Fallback: allarga la ricerca a qualche giorno vicino alla data
  // richiesta e unisce i prezzi trovati in un unico pool.
  let pool = primaryCandidates.slice();
  if (pool.length < MIN_WIDEN_SAMPLE) {
    const tripLengthDays = returnDate ? diffDays(departureDate, returnDate) : null;
    for (const offset of NEARBY_DAY_OFFSETS) {
      if (pool.length >= MIN_WIDEN_SAMPLE) break;
      const altDeparture = shiftDate(departureDate, offset);
      const altReturn = tripLengthDays != null ? shiftDate(altDeparture, tripLengthDays) : undefined;
      try {
        const altData = await fetchSerpApiRaw({ origin, destination, departureDate: altDeparture, returnDate: altReturn, apiKey });
        if (altData) {
          const extra = extractFlightPrices(altData);
          if (extra.length) pool = pool.concat(extra);
        }
      } catch (err) {
        // Una data vicina che fallisce non deve bloccare la ricerca principale.
        console.error("flight-price/serpapi (data vicina):", err);
      }
    }
  }

  if (pool.length > primaryCandidates.length) {
    return { min, average: average(pool), stdDev: stdDev(pool), count: pool.length, basis: "date vicine" };
  }

  // 3) Ultima risorsa: media dei soli voli trovati per la data esatta.
  return {
    min,
    average: average(primaryCandidates),
    stdDev: stdDev(primaryCandidates),
    count: primaryCandidates.length,
    basis: "singola data",
  };
}

async function fetchSerpApiRaw({ origin, destination, departureDate, returnDate, apiKey }) {
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
  return data;
}

function extractFlightPrices(data) {
  return [...(data.best_flights || []), ...(data.other_flights || [])]
    .map((f) => Number(f.price))
    .filter((p) => isFinite(p) && p > 0);
}

// price_insights.price_history è un array di coppie [timestamp, prezzo] con
// l'andamento del prezzo di questa rotta nel tempo (Google Flights lo usa
// per il grafico "storico prezzi"); qui interessa solo il prezzo.
function extractPriceHistory(data) {
  const history = data && data.price_insights && Array.isArray(data.price_insights.price_history)
    ? data.price_insights.price_history
    : [];
  return history
    .map((entry) => Number(Array.isArray(entry) ? entry[1] : entry && entry.price))
    .filter((p) => isFinite(p) && p > 0);
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

  // Travelpayouts è già una cache: qui si usa tutta la cache trovata per la
  // rotta (non filtrata a un solo giorno), quindi la media è già su un
  // periodo più lungo per costruzione.
  const prices = data.data.map((d) => Number(d.price)).filter((p) => isFinite(p) && p > 0);
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), average: average(prices), stdDev: stdDev(prices), count: prices.length };
}
