// Analizza un intero periodo (non un solo giorno) per capire quali date di
// partenza, all'interno di quel periodo, hanno un prezzo del volo
// particolarmente più basso (o più alto) della media DELLO STESSO periodo —
// utile perché in listino un periodo lungo (una settimana, un mese) ha oggi
// un unico prezzo fisso per la struttura, ma la domanda (stimata dal
// prezzo dei voli) in realtà può variare parecchio giorno per giorno.
//
// La media e la deviazione standard di riferimento sono quelle DEL
// CAMPIONE STESSO raccolto in questa scansione (non uno storico esterno):
// rispondono esattamente alla domanda "rispetto alla media di QUESTO
// periodo, quali giorni sono più a buon mercato o più cari?".
//
// Per ogni giorno si cerca solo il volo di sola andata più economico (non
// andata e ritorno): serve a confrontare i giorni fra loro in modo
// coerente, non a prenotare — il "Controllo rapido" su un singolo periodo
// resta lo strumento per il prezzo esatto del volo andata/ritorno.
//
// Nota sui costi: ogni giorno analizzato è una richiesta a SerpApi. Per non
// esaurire in fretta la quota mensile gratuita, il periodo viene
// campionato quando è più lungo di MAX giorni: invece dei soli primi
// giorni, si distribuiscono uniformemente su tutto l'intervallo, così il
// campione resta rappresentativo dell'intero periodo anche se ridotto.
const DEFAULT_SCAN_DAYS = 10;
const MAX_SCAN_DAYS_HARD_CAP = 20;
const CONCURRENCY = 5;

export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body || {};
  const origin = normalizeIata(params.origin);
  const destination = normalizeIata(params.destination);
  const startDate = params.startDate;
  const endDate = params.endDate;
  const maxDays = clampInt(params.maxDays, 1, MAX_SCAN_DAYS_HARD_CAP, DEFAULT_SCAN_DAYS);

  if (!origin || !destination) {
    return res.status(400).json({ error: "Aeroporto di partenza e di arrivo (codice IATA) obbligatori." });
  }
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate <= startDate) {
    return res.status(400).json({ error: "Intervallo di date del periodo non valido." });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return res.status(502).json({ error: "SERPAPI_KEY non configurata: l'analisi del periodo richiede Google Flights." });
  }

  const totalDaysInPeriod = diffDays(startDate, endDate) + 1;
  const dates = sampleDates(startDate, totalDaysInPeriod, maxDays);

  const scanned = await mapWithConcurrency(dates, CONCURRENCY, async (date) => {
    try {
      const prices = await fetchOneWayPrices({ origin, destination, departureDate: date, apiKey });
      return { date, price: prices.length ? Math.min(...prices) : null };
    } catch (err) {
      console.error("flight-price-scan:", date, err && err.message ? err.message : err);
      return { date, price: null };
    }
  });

  const valid = scanned.filter((r) => r.price != null);
  if (valid.length < 2) {
    return res.status(502).json({
      error: "Non è stato possibile trovare abbastanza voli in questo periodo per un confronto tra i giorni.",
    });
  }

  const prices = valid.map((r) => r.price);
  const mean = average(prices);
  const sd = stdDev(prices);

  const days = valid
    .map((r) => ({
      date: r.date,
      price: r.price,
      varPct: mean > 0 ? ((r.price - mean) / mean) * 100 : 0,
      z: sd > 0 ? (r.price - mean) / sd : null,
    }))
    // Dal calo di prezzo più significativo al rialzo più significativo.
    .sort((a, b) => a.varPct - b.varPct);

  return res.status(200).json({
    days,
    mean,
    stdDev: sd,
    sampleSize: valid.length,
    totalDaysInPeriod,
    scannedDays: dates.length,
    skippedDates: scanned.filter((r) => r.price == null).map((r) => r.date),
  });
}

function normalizeIata(v) {
  if (typeof v !== "string") return "";
  return v.trim().toUpperCase();
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function average(nums) {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

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

// Se il periodo entra nel limite, analizza ogni giorno. Se è più lungo,
// sceglie `maxDays` date distribuite uniformemente sull'intero intervallo
// (compresi sempre il primo e l'ultimo giorno), invece di limitarsi
// all'inizio del periodo.
function sampleDates(startDate, totalDaysInPeriod, maxDays) {
  if (totalDaysInPeriod <= maxDays) {
    return Array.from({ length: totalDaysInPeriod }, (_, i) => shiftDate(startDate, i));
  }
  const offsets = new Set();
  for (let i = 0; i < maxDays; i++) {
    offsets.add(Math.round((i * (totalDaysInPeriod - 1)) / (maxDays - 1)));
  }
  return Array.from(offsets)
    .sort((a, b) => a - b)
    .map((offset) => shiftDate(startDate, offset));
}

// Esegue `fn` su ogni elemento con al più `limit` chiamate in parallelo,
// invece di tutte insieme (per non sovraccaricare SerpApi) o una alla
// volta (troppo lento su periodi con molti giorni).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchOneWayPrices({ origin, destination, departureDate, apiKey }) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", departureDate);
  url.searchParams.set("currency", "EUR");
  url.searchParams.set("hl", "it");
  url.searchParams.set("type", "2"); // sola andata
  url.searchParams.set("api_key", apiKey);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`SerpApi ha risposto ${resp.status}`);
  }
  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return [...(data.best_flights || []), ...(data.other_flights || [])]
    .map((f) => Number(f.price))
    .filter((p) => isFinite(p) && p > 0);
}
