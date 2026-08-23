import { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Minus, Info, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

export const DEFAULT_CONFIG = { elasticity: 0.4, capUp: 20, capDown: 15, threshold: 5, zThreshold: 1 };
const WEEKDAYS_IT = ["L", "M", "M", "G", "V", "S", "D"];

// Strategia di prezzo consigliata in base alla fascia della struttura.
// L'idea: chi prenota una struttura economica tende a farlo last-minute,
// cercando l'occasione — è più sensibile al prezzo del volo del momento, e
// il prezzo della camera dovrebbe seguirlo più da vicino e più in fretta.
// Chi prenota una struttura di fascia alta pianifica con largo anticipo,
// indipendentemente da quanto costa il volo in quel momento — il prezzo
// dovrebbe restare più stabile e muoversi solo per scostamenti davvero
// marcati. "Standard" è il punto di equilibrio (= DEFAULT_CONFIG).
//
// Sono valori di partenza, non un vincolo: restano modificabili con i
// cursori in Impostazioni per ogni singola struttura.
export const PROPERTY_TYPES = ["economy", "standard", "luxury"];

export const PROPERTY_TYPE_LABELS = {
  economy: "Economy",
  standard: "Standard",
  luxury: "Luxury",
};

export const PROPERTY_TYPE_DESCRIPTIONS = {
  economy:
    "Ospiti più sensibili al prezzo, prenotazioni spesso last-minute: il prezzo reagisce di più e a scostamenti più piccoli.",
  standard: "Il punto di equilibrio: reattività bilanciata (valori di default dell'app).",
  luxury:
    "Ospiti che prenotano con largo anticipo indipendentemente dal costo del volo: il prezzo reagisce meno, e solo a scostamenti marcati.",
};

export const PROPERTY_TYPE_CONFIGS = {
  economy: { elasticity: 0.6, capUp: 25, capDown: 20, threshold: 3, zThreshold: 0.7 },
  standard: { ...DEFAULT_CONFIG },
  luxury: { elasticity: 0.2, capUp: 12, capDown: 8, threshold: 8, zThreshold: 1.5 },
};

export function configForPropertyType(propertyType) {
  return PROPERTY_TYPE_CONFIGS[propertyType] || DEFAULT_CONFIG;
}

// Servizi e caratteristiche che il mercato associa più spesso a una
// struttura di fascia alta (piscina, SPA, vista mare, ecc.) rispetto a
// servizi più "di base" comuni anche in strutture economy/standard (aria
// condizionata, parcheggio). Servono per calcolare un SUGGERIMENTO di
// fascia — non per deciderla al posto del proprietario: la fascia resta
// sempre una scelta manuale, modificabile in qualunque momento, perché il
// mercato reale ha eccezioni che nessuna lista fissa può catturare del
// tutto.
export const AMENITIES = [
  { key: "pool", label: "Piscina", tier: "luxury" },
  { key: "sauna", label: "Sauna", tier: "luxury" },
  { key: "jacuzzi", label: "Vasca idromassaggio", tier: "luxury" },
  { key: "spa", label: "SPA", tier: "luxury" },
  { key: "sea_view", label: "Vista mare / panoramica", tier: "luxury" },
  { key: "private_chef_kitchen", label: "Cucina attrezzata / chef privato", tier: "luxury" },
  { key: "gym", label: "Palestra", tier: "luxury" },
  { key: "daily_cleaning", label: "Pulizie giornaliere incluse", tier: "basic" },
  { key: "breakfast", label: "Colazione inclusa", tier: "basic" },
  { key: "air_conditioning", label: "Aria condizionata", tier: "basic" },
  { key: "free_parking", label: "Parcheggio privato gratuito", tier: "basic" },
];

export const AMENITY_LABELS = Object.fromEntries(AMENITIES.map((a) => [a.key, a.label]));

// I servizi "luxury" (piscina, SPA, ecc.) pesano più di quelli "basic"
// (aria condizionata, parcheggio — comuni anche fuori dalla fascia alta).
// Una struttura molto spaziosa rispetto al numero di camere è un ulteriore
// indizio di fascia alta, a prescindere dai servizi elencati.
const LUXURY_AMENITY_WEIGHT = 2;
const BASIC_AMENITY_WEIGHT = 1;
const SIZE_PER_BEDROOM_LUXURY_THRESHOLD = 40; // m² a camera, oltre cui la struttura si considera molto spaziosa
const LUXURY_SCORE_THRESHOLD = 6; // es. 3 servizi "luxury", o 2 + spazio abbondante
const STANDARD_SCORE_THRESHOLD = 2; // es. 1 servizio "luxury", o 2 servizi "basic"

// La piscina è un elemento imprescindibile per la fascia luxury: da sola
// non basta (serve comunque raggiungere LUXURY_SCORE_THRESHOLD con altri
// servizi/spazio), ma senza piscina il suggerimento non propone mai
// "luxury", anche con un punteggio altrimenti sufficiente (es. sauna +
// vasca idromassaggio + SPA) — al massimo "standard". Resta comunque solo
// un SUGGERIMENTO: il proprietario può sempre impostare la fascia a mano.
export function suggestPropertyTypeFromAmenities({ amenities, sizeSqm, bedrooms }) {
  const list = Array.isArray(amenities) ? amenities : [];
  let score = 0;
  for (const a of AMENITIES) {
    if (list.includes(a.key)) score += a.tier === "luxury" ? LUXURY_AMENITY_WEIGHT : BASIC_AMENITY_WEIGHT;
  }
  const size = Number(sizeSqm);
  const rooms = Number(bedrooms);
  if (isFinite(size) && size > 0 && isFinite(rooms) && rooms > 0 && size / rooms >= SIZE_PER_BEDROOM_LUXURY_THRESHOLD) {
    score += LUXURY_AMENITY_WEIGHT;
  }
  const hasPool = list.includes("pool");
  if (score >= LUXURY_SCORE_THRESHOLD && hasPool) return "luxury";
  if (score >= STANDARD_SCORE_THRESHOLD) return "standard";
  return "economy";
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function isoFromParts(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

export function isoToLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

export function periodLabelFromDates(checkIn, checkOut) {
  if (!checkIn || !checkOut) return "";
  return `${isoToLabel(checkIn)} → ${isoToLabel(checkOut)}`;
}

export function todayIso() {
  const d = new Date();
  return isoFromParts(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDaysIso(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return isoFromParts(d.getFullYear(), d.getMonth(), d.getDate());
}

// Media dei prezzi voli già registrati per lo stesso periodo, prima di un certo momento.
// Questa media è la "baseline" automatica: nessun valore di riferimento va inserito a mano.
export function baselineFor(checkIn, checkOut, entries, beforeTs = Infinity) {
  const prior = entries.filter((en) => en.check_in === checkIn && en.check_out === checkOut && new Date(en.created_at).getTime() < beforeTs);
  if (prior.length === 0) return null;
  return prior.reduce((s, en) => s + Number(en.flight_price), 0) / prior.length;
}

// stats = { mean, stdDev, count } — media, deviazione standard e numero di
// voli storici usati per calcolarle (vedi pages/api/flight-price.js).
//
// La domanda a cui questo calcolo risponde non è più "il volo di oggi è
// diverso dalla media di più del 5%?" (soglia identica per qualunque rotta,
// quindi arbitraria), ma "il volo di oggi è insolito rispetto a quanto
// normalmente oscillano i prezzi su QUESTA rotta?" — cioè uno z-score:
// quante deviazioni standard separano il prezzo di oggi dalla media
// storica. Una rotta con prezzi che ballano molto (alta deviazione
// standard) avrà così una soglia effettiva più larga, una rotta stabile
// una più stretta, invece di trattare sempre la stessa percentuale come
// significativa per qualunque rotta.
//
// L'affidabilità della media/deviazione standard dipende da quanti voli
// l'hanno generata: con pochi campioni il segnale è più rumoroso, quindi la
// proposta di modifica viene attenuata (non azzerata) invece di essere
// trattata come certa quanto una media calcolata su tanti dati.
const CONFIDENCE_FULL_SAMPLE = 8;
const CONFIDENCE_MIN = 0.35;

export function computeSuggestion(flightNow, stats, roomPrice, config) {
  const now = parseFloat(flightNow);
  const mean = parseFloat(stats && stats.mean);
  const room = parseFloat(roomPrice);
  const sd = Number(stats && stats.stdDev) || 0;
  const n = Number(stats && stats.count) || 0;
  if (!isFinite(now) || !isFinite(mean) || !isFinite(room) || mean <= 0 || room <= 0) return null;

  const varPct = ((now - mean) / mean) * 100;

  // z-score: quante deviazioni standard separano il prezzo di oggi dalla
  // media storica di questa rotta. Richiede almeno 2 campioni storici per
  // essere definito (altrimenti non c'è variabilità da misurare).
  const z = sd > 0 ? (now - mean) / sd : null;
  const zThreshold = config.zThreshold != null ? config.zThreshold : 1;
  // Riserva: se non c'è abbastanza storico per calcolare una deviazione
  // standard, si usa comunque una soglia percentuale fissa e prudente
  // piuttosto che non giudicare mai nulla come significativo.
  const fallbackPctThreshold = config.threshold != null ? config.threshold : 5;

  const significant = z != null ? Math.abs(z) >= zThreshold : Math.abs(varPct) >= fallbackPctThreshold;

  const confidence = clamp(Math.sqrt(Math.min(n, CONFIDENCE_FULL_SAMPLE) / CONFIDENCE_FULL_SAMPLE), CONFIDENCE_MIN, 1);
  const confidenceLevel = n >= CONFIDENCE_FULL_SAMPLE ? "alta" : n >= 3 ? "media" : "bassa";

  let adjPct = 0;
  let action = "mantieni";
  if (significant) {
    adjPct = clamp(varPct * config.elasticity * confidence, -config.capDown, config.capUp);
    if (adjPct > 0.5) action = "aumenta";
    else if (adjPct < -0.5) action = "riduci";
  }

  const newRoom = room * (1 + adjPct / 100);
  return { varPct, adjPct, newRoom, action, z, stdDev: sd, n, confidence, confidenceLevel, significant };
}

export function formatEUR(n) {
  if (!isFinite(n)) return "€ —";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export function formatPct(n) {
  if (!isFinite(n)) return "—";
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

export function formatZ(n) {
  if (n == null || !isFinite(n)) return "—";
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(2)}σ`;
}

export const CONFIDENCE_LABELS = { alta: "Alta", media: "Media", bassa: "Bassa" };

export function FlipDigits({ text }) {
  const [version, setVersion] = useState(0);
  const [prev, setPrev] = useState(text);
  useEffect(() => {
    if (text !== prev) {
      setVersion((v) => v + 1);
      setPrev(text);
    }
  }, [text, prev]);
  const chars = text.split("");
  return (
    <span className="flip-wrap">
      {chars.map((c, i) => (
        <span key={`${i}-${version}`} className="flip-char" style={{ animationDelay: `${i * 22}ms` }}>
          {c === " " ? "\u00A0" : c}
        </span>
      ))}
    </span>
  );
}

export function Badge({ action }) {
  const map = {
    aumenta: { label: "Aumenta", cls: "badge badge-up", Icon: TrendingUp },
    riduci: { label: "Riduci", cls: "badge badge-down", Icon: TrendingDown },
    mantieni: { label: "Mantieni", cls: "badge badge-flat", Icon: Minus },
    riferimento: { label: "Riferimento", cls: "badge badge-flat", Icon: Info },
    libero: { label: "Libero", cls: "badge badge-up", Icon: Minus },
    occupato: { label: "Occupato", cls: "badge badge-down", Icon: Minus },
  };
  const { label, cls, Icon } = map[action] || map.mantieni;
  return (
    <span className={cls}>
      <Icon size={13} strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function SettingsSlider({ label, value, min, max, step, display, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
        <span className="text-dim">{label}</span>
        <strong style={{ color: "var(--ink)" }}>{display}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range"
      />
    </div>
  );
}

export function CalendarPicker({ label, value, onChange, minDate }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value + "T00:00:00") : new Date()));
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // lunedì = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rawLabel = viewDate.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const monthLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = todayIso();

  return (
    <div className="field">
      <span>{label}</span>
      <div className="datepicker" ref={ref}>
        <button type="button" className="input datepicker-trigger" onClick={() => setOpen((o) => !o)}>
          <CalendarIcon size={14} className="text-dim" />
          <span className={value ? "" : "text-dim"}>{value ? isoToLabel(value) : "Seleziona data"}</span>
        </button>
        {open && (
          <div className="datepicker-panel">
            <div className="datepicker-nav">
              <button type="button" className="icon-btn" onClick={() => setViewDate(new Date(year, month - 1, 1))}>
                <ChevronLeft size={15} />
              </button>
              <span>{monthLabel}</span>
              <button type="button" className="icon-btn" onClick={() => setViewDate(new Date(year, month + 1, 1))}>
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="datepicker-weekdays">
              {WEEKDAYS_IT.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="datepicker-grid">
              {cells.map((d, i) => {
                if (d === null) return <span key={i} />;
                const iso = isoFromParts(year, month, d);
                const isSelected = iso === value;
                const isToday = iso === today;
                const disabled = Boolean(minDate) && iso < minDate;
                return (
                  <button
                    type="button"
                    key={i}
                    disabled={disabled}
                    className={`daycell${isSelected ? " selected" : ""}${isToday && !isSelected ? " today" : ""}`}
                    onClick={() => {
                      onChange(iso);
                      setOpen(false);
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
