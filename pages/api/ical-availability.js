import ical from "node-ical";

// Legge un feed iCal esterno (Booking.com, Airbnb, ecc.) e restituisce i soli
// periodi occupato/libero. Deve girare lato server: i feed iCal spesso non
// hanno gli header CORS necessari per essere letti direttamente dal browser.
//
// Importante: iCal trasmette solo occupato/libero, mai il prezzo — questo
// endpoint non tocca in alcun modo il listino prezzi dell'app.
export default async function handler(req, res) {
  const url = req.method === "GET" ? req.query.url : req.body && req.body.url;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Parametro 'url' mancante." });
  }
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Il link del calendario deve iniziare con http:// o https://" });
  }

  try {
    const data = await ical.async.fromURL(url);
    const busy = [];

    for (const key in data) {
      const ev = data[key];
      if (!ev || ev.type !== "VEVENT") continue;

      const start = toDate(ev.start);
      const end = toDate(ev.end);
      if (!start || !end) continue;

      busy.push({
        start: toIsoDate(start),
        end: toIsoDate(end),
        summary: typeof ev.summary === "string" ? ev.summary : "",
      });
    }

    busy.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    return res.status(200).json({ busy });
  } catch (err) {
    console.error("ical-availability:", err);
    return res.status(502).json({
      error: "Impossibile leggere il calendario iCal collegato.",
      detail: err && err.message ? err.message : String(err),
    });
  }
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}
