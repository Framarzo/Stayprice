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
// standard alla mediana, luxury al 75° percentile.
//
// Piscina, vasca idromassaggio e gli altri servizi selezionati nella
// scheda Struttura NON vengono tradotti in un bonus percentuale inventato:
// l'endpoint di AirROI non permette di filtrare i comparabili per
// servizi, ma ogni annuncio restituito include comunque la propria lista
// di amenities. Quando la struttura ha almeno un servizio selezionato, si
// restringe quindi il confronto agli annunci in zona che condividono
// almeno uno di quegli stessi servizi (match testuale sulle amenities
// restituite da AirROI) — se ce ne sono abbastanza per un confronto
// affidabile — invece di mescolarli con strutture senza piscina o SPA.
// Se il confronto ristretto non ha abbastanza campioni si ricade sul
// confronto per l'intera zona, come prima.
//
// Raggio di ricerca: l'endpoint di AirROI non supporta una ricerca per
// comune o macrozona, solo indirizzo + raggio in miglia (1-10, come da
// documentazione AirROI). Di default il raggio si allarga da solo
// (3 → 5 → 10 miglia) finché non trova abbastanza comparabili. Se il
// proprietario sceglie un raggio a mano dal menu nella scheda struttura,
// quella scelta sostituisce l'allargamento automatico: si cerca solo a
// quel raggio, così chi conosce la propria zona (es. una struttura in un
// comune piccolo vicino a una città molto turistica) può evitare di
// mescolare mercati molto diversi che un raggio più ampio includerebbe.
const MIN_COMPARABLES = 5;
const RADII_MILES = [3, 5, 10]; // allarga la ricerca se i risultati sono pochi (solo quando il raggio non è scelto a mano)
const MIN_RADIUS_MILES = 1;
const MAX_RADIUS_MILES = 10; // limite documentato dall'API di AirROI

// Parole chiave (in inglese, la lingua delle amenities restituite da
// AirROI) usate per riconoscere ciascun nostro servizio nella lista di
// amenities di un annuncio comparabile. Il match è testuale e quindi
// approssimato — AirROI non documenta pubblicamente un elenco chiuso di
// valori possibili — ma è comunque un confronto con dati reali, non un
// numero inventato.
const AMENITY_MATCH_KEYWORDS = {
  pool: ["pool"],
  sauna: ["sauna"],
  jacuzzi: ["hot tub", "jacuzzi", "whirlpool"],
  spa: ["spa"],
  sea_view: ["sea view", "ocean view", "beach view", "beachfront", "waterfront"],
  private_chef_kitchen: ["chef"],
  gym: ["gym", "fitness", "exercise equipment"],
  daily_cleaning: ["cleaning available during stay", "daily cleaning", "housekeeping"],
  breakfast: ["breakfast"],
  air_conditioning: ["air conditioning"],
  free_parking: ["free parking", "parking"],
};

export default async function handler(req, res) {
  const params = req.method === "GET" ? req.query : req.body || {};
  const address = typeof params.address === "string" ? params.address.trim() : "";
  const bedrooms = clampInt(params.bedrooms, 0, 20);
  const bathrooms = clampNumber(params.bathrooms, 0, 20);
  const guests = clampInt(params.guests, 1, 30);
  const propertyType = ["economy", "standard", "luxury"].includes(params.propertyType) ? params.propertyType : "standard";
  const amenities = Array.isArray(params.amenities) ? params.amenities.filter((a) => AMENITY_MATCH_KEYWORDS[a]) : [];
  // Raggio scelto a mano dal proprietario (facoltativo): se presente e
  // valido, sostituisce l'allargamento automatico 3→5→10 miglia.
  const manualRadius = clampInt(params.radius, MIN_RADIUS_MILES, MAX_RADIUS_MILES);

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
  let usedRadius = manualRadius || RADII_MILES[0];
  try {
    if (manualRadius) {
      // Raggio scelto a mano: si cerca solo lì, senza allargare da soli.
      comparables = await fetchComparables({ address, bedrooms, bathrooms, guests, radius: manualRadius, apiKey });
    } else {
      for (const radius of RADII_MILES) {
        usedRadius = radius;
        comparables = await fetchComparables({ address, bedrooms, bathrooms, guests, radius, apiKey });
        if (comparables.length >= MIN_COMPARABLES) break;
      }
    }
  } catch (err) {
    console.error("starting-price:", err);
    return res.status(502).json({
      error: `AirROI non raggiungibile: ${err && err.message ? err.message : err}`,
    });
  }

  // DEBUG TEMPORANEO: da rimuovere dopo aver capito perché i prezzi
  // suggeriti risultano troppo bassi. Logga i parametri inviati ad AirROI
  // e un estratto grezzo delle prime comparabili così com'è ricevuto.
  console.log(
    "starting-price DEBUG params:",
    JSON.stringify({ address, bedrooms, bathrooms, guests, manualRadius, usedRadius, totalComparables: comparables.length })
  );
  console.log(
    "starting-price DEBUG sample listings:",
    JSON.stringify(
      comparables.slice(0, 5).map((c) => ({
        bedrooms: c && c.property_details && c.property_details.bedrooms,
        baths: c && c.property_details && c.property_details.baths,
        guests: c && c.property_details && c.property_details.guests,
        currency: c && c.currency,
        l90d_avg_rate: c && c.performance_metrics && c.performance_metrics.l90d_avg_rate,
        ttm_avg_rate: c && c.performance_metrics && c.performance_metrics.ttm_avg_rate,
      }))
    )
  );

  // Se la struttura ha servizi selezionati, prova a restringere il
  // confronto ai soli annunci in zona che condividono almeno uno di quegli
  // stessi servizi, invece di mescolarli con strutture che non li hanno.
  let comparablesForRates = comparables;
  let matchedOnAmenities = false;
  if (amenities.length > 0) {
    const withMatchingAmenities = comparables.filter((c) => amenityOverlapCount(amenities, c) > 0);
    if (withMatchingAmenities.length >= MIN_COMPARABLES) {
      comparablesForRates = withMatchingAmenities;
      matchedOnAmenities = true;
    }
  }

  const toRate = (c) => {
    const m = (c && c.performance_metrics) || {};
    const r = m.l90d_avg_rate != null ? m.l90d_avg_rate : m.ttm_avg_rate;
    return Number(r);
  };

  let rates = comparablesForRates
    .map(toRate)
    .filter((r) => isFinite(r) && r > 0)
    .sort((a, b) => a - b);

  // Il confronto ristretto ai servizi può avere annunci con tariffa non
  // disponibile: se restano troppo pochi campioni per fidarsi, si ricade
  // sull'intera zona invece di dare un prezzo poco affidabile.
  if (matchedOnAmenities && rates.length < MIN_COMPARABLES) {
    matchedOnAmenities = false;
    rates = comparables
      .map(toRate)
      .filter((r) => isFinite(r) && r > 0)
      .sort((a, b) => a - b);
  }

  if (rates.length === 0) {
    return res.status(502).json({
      error: manualRadius
        ? `Nessuna struttura simile trovata entro ${manualRadius} miglia con questi criteri: prova ad aumentare il raggio di ricerca o a rivedere camere/bagni/ospiti/indirizzo.`
        : "Nessuna struttura simile trovata in zona con questi criteri: prova a rivedere camere/bagni/ospiti o l'indirizzo.",
    });
  }

  const stats = {
    count: rates.length,
    totalNearby: comparables.length,
    matchedOnAmenities,
    radiusMiles: usedRadius,
    manualRadius: Boolean(manualRadius),
    // Pochi campioni non bloccano il risultato, ma con un raggio scelto a
    // mano non c'è più l'allargamento automatico che compensava: lo
    // segnaliamo così l'interfaccia può suggerire di allargare il raggio.
    lowSample: rates.length < MIN_COMPARABLES,
    min: rates[0],
    max: rates[rates.length - 1],
    p25: percentile(rates, 25),
    median: percentile(rates, 50),
    p75: percentile(rates, 75),
    average: rates.reduce((s, n) => s + n, 0) / rates.length,
  };

  const suggested = propertyType === "economy" ? stats.p25 : propertyType === "luxury" ? stats.p75 : stats.median;

  // DEBUG TEMPORANEO (vedi sopra).
  console.log(
    "starting-price DEBUG result:",
    JSON.stringify({ propertyType, suggested, rates, stats })
  );

  return res.status(200).json({
    suggestedPrice: Math.round(suggested),
    stats,
    propertyType,
  });
}

// Estrae la lista di amenities di un annuncio comparabile restituito da
// AirROI. La posizione esatta nella risposta (property_details.amenities)
// è quella documentata, ma si controllano anche un paio di alternative
// plausibili per non rompersi silenziosamente se cambia leggermente.
function comparableAmenitiesText(c) {
  const list =
    (c && c.property_details && c.property_details.amenities) || (c && c.amenities) || [];
  if (!Array.isArray(list)) return "";
  return list.join(" | ").toLowerCase();
}

// Quanti dei servizi selezionati per la struttura (le nostre chiavi, es.
// "pool", "jacuzzi") compaiono — per match testuale, non esatto — nella
// lista di amenities di questo annuncio comparabile.
function amenityOverlapCount(targetAmenityKeys, comparable) {
  const text = comparableAmenitiesText(comparable);
  if (!text) return 0;
  let count = 0;
  for (const key of targetAmenityKeys) {
    const keywords = AMENITY_MATCH_KEYWORDS[key] || [];
    if (keywords.some((kw) => text.includes(kw))) count++;
  }
  return count;
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
