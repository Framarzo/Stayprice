// Suggerisce un prezzo di partenza per un nuovo periodo di listino,
// confrontando la struttura con strutture simili nella stessa zona (per
// numero di camere/bagni/ospiti) tramite i dati di mercato di AirROI.
//
// Non è collegato ai prezzi dei voli: quello resta il Controllo rapido, che
// aggiusta un prezzo che hai già messo in listino. Questo endpoint serve
// invece per il momento "non so ancora da che prezzo partire per questo
// periodo" — usa un confronto con il mercato reale, non lo storico voli.
//
// Fonte: AirROI GET /listings/comparables — restituisce gli annunci
// comparabili nella zona (per indirizzo, filtrati per camere/bagni/ospiti)
// con la loro tariffa media recente (ultimi 90 giorni, o l'intero ultimo
// anno se i 90 giorni non sono disponibili per un annuncio). La fascia
// della struttura (economy/standard/luxury) sceglie a quale punto della
// distribuzione di queste tariffe guardare — economy al 25° percentile,
// standard alla mediana, luxury al 75° percentile — così il prezzo
// suggerito riflette sia il mercato reale sia il posizionamento scelto per
// la struttura, non un unico numero "medio" uguale per tutti.
const MIN_COMPARABLES = 5;
const RADII_MILES = [3, 5, 10]; // allarga la ricerca se i risultati sono pochi

export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body || {};
  const address = typeof params.address === "string" ? params.address.trim() : "";
  const bedrooms = clampInt(params.bedrooms, 0, 20);
  const bathrooms = clampNumber(params.bathrooms, 0, 20);
  const guests = clampInt(params.guests, 1, 30);
  const propertyType = ["economy", "standard", "luxury"].includes(params.propertyType) ? params.propertyType : "standard";

  if (!address) {
    return res.status(400).json({ error: "Indirizzo o zona della struttura mancante." });
  }
  if (bedrooms == null || bathrooms == null || guests == null) {
    return res.status(400).json({ error: "Numero di camere, bagni e ospiti mancante o non valido." });
  }

  const apiKey = process.env.AIRROI_API_KEY;
  if (!apiKey) {
    return res.status(502).json({ error: "AIRROI_API_KEY non configurata." });
  }

  let comparables = [];
  let usedRadius = RADII_MILES[0];
  try {
    for (const radius of RADII_MILES) {
      usedRadius = radius;
      comparables = await fetchComparables({ address, bedrooms, bathrooms, guests, radius, apiKey });
      if (comparables.length >= MIN_COMPARABLES) break;
    }
  } catch (err) {
    console.error("starting-price:", err);
    return res.status(502).json({
      error: `AirROI non raggiungibile: ${err && err.message ? err.message : err}`,
    });
  }

  const rates = comparables
    .map((c) => {
      const m = (c && c.performance_metrics) || {};
      const r = m.l90d_avg_rate != null ? m.l90d_avg_rate : m.ttm_avg_rate;
      return Number(r);
    })
    .filter((r) => isFinite(r) && r > 0)
    .sort((a, b) => a - b);

  if (rates.length === 0) {
    return res.status(502).json({
      error:
        "Nessuna struttura simile trovata in zona con questi criteri: prova a rivedere camere/bagni/ospiti o l'indirizzo.",
    });
  }

  const stats = {
    count: rates.length,
    radiusMiles: usedRadius,
    min: rates[0],
    max: rates[rates.length - 1],
    p25: percentile(rates, 25),
    median: percentile(rates, 50),
    p75: percentile(rates, 75),
    average: rates.reduce((s, n) => s + n, 0) / rates.length,
  };

  const suggested = propertyType === "economy" ? stats.p25 : propertyType === "luxury" ? stats.p75 : stats.median;

  return res.status(200).json({
    suggestedPrice: Math.round(suggested),
    stats,
    propertyType,
  });
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function clampNumber(v, min, max) {
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * frac;
}

async function fetchComparables({ address, bedrooms, bathrooms, guests, radius, apiKey }) {
  const url = new URL("https://api.airroi.com/listings/comparables");
  url.searchParams.set("address", address);
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("bedrooms", String(bedrooms));
  url.searchParams.set("baths", String(bathrooms));
  url.searchParams.set("guests", String(guests));
  url.searchParams.set("room_type", "entire_home");
  url.searchParams.set("currency", "native");

  const resp = await fetch(url.toString(), {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const reason = body && (body.message || body.error) ? body.message || body.error : `risposta HTTP ${resp.status}`;
    throw new Error(reason);
  }

  const data = await resp.json();
  // La forma esatta della risposta (array diretto o oggetto con una chiave
  // che contiene la lista) non è documentata pubblicamente in dettaglio:
  // si gestiscono le forme più plausibili invece di assumerne una sola.
  if (Array.isArray(data)) return data;
  return data.listings || data.results || data.data || data.comparables || [];
}
