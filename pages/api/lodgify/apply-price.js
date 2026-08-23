// Applica UN prezzo per notte a un intervallo di date (o la tariffa di
// base/default) sulla struttura Lodgify collegata. Non viene mai chiamato
// in automatico: parte solo quando il proprietario clicca esplicitamente
// un pulsante "Applica"/"Imposta" dopo aver visto il suggerimento (nessuna
// modifica di prezzo avviene senza un'azione manuale della persona).
//
// Endpoint Lodgify usato: POST /v1/rates/savewithoutavailability
// (https://docs.lodgify.com/reference/savetiny). end_date è ESCLUSIVO in
// Lodgify (il prezzo si applica alle notti da start_date fino a, ma non
// includendo, end_date) — la stessa convenzione già usata in questa app
// per check_in/check_out, quindi le date si passano senza alcuna modifica.
//
// Lodgify rifiuta le tariffe per data specifica finché la camera non ha
// già una tariffa di base ("default rate", quella usata per le notti senza
// un prezzo specifico) — da qui setDefault: true, per crearla/aggiornarla
// una volta sola dall'app invece di dover passare dall'interfaccia di
// Lodgify. Una tariffa di default non ha start_date/end_date.
export default async function handler(req, res) {
  const { apiKey, propertyId, roomTypeId, startDate, endDate, pricePerDay, setDefault } = req.body || {};

  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: "Struttura non collegata a Lodgify (chiave API mancante)." });
  }
  const propId = Number(propertyId);
  const roomId = Number(roomTypeId);
  if (!isFinite(propId) || !isFinite(roomId)) {
    return res.status(400).json({ error: "Struttura non collegata a Lodgify (identificativi mancanti)." });
  }
  const price = Number(pricePerDay);
  if (!isFinite(price) || price < 1) {
    return res.status(400).json({ error: "Prezzo non valido." });
  }

  let rate;
  if (setDefault) {
    rate = { is_default: true, price_per_day: price };
  } else {
    if (
      !startDate ||
      !endDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      endDate <= startDate
    ) {
      return res.status(400).json({ error: "Intervallo di date non valido." });
    }
    rate = { is_default: false, start_date: startDate, end_date: endDate, price_per_day: price };
  }

  try {
    const resp = await fetch("https://api.lodgify.com/v1/rates/savewithoutavailability", {
      method: "POST",
      headers: {
        "X-ApiKey": apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        property_id: propId,
        room_type_id: roomId,
        rates: [rate],
      }),
    });

    if (resp.status === 401) {
      return res.status(401).json({ error: "Chiave API di Lodgify non valida o senza permessi." });
    }

    const body = await resp.json().catch(() => null);
    if (!resp.ok || body !== true) {
      // Lodgify di solito spiega il motivo del rifiuto nel corpo della
      // risposta (es. intervalli di date sovrapposti, min/max stay in
      // conflitto, room_type_id sbagliato): lo si include nel messaggio
      // stesso, non solo in "detail", così è visibile anche senza aprire
      // gli strumenti sviluppatore del browser.
      const reason =
        body && typeof body === "object"
          ? body.message || body.error || body.title || JSON.stringify(body)
          : typeof body === "string" && body
          ? body
          : `risposta HTTP ${resp.status}`;
      return res.status(502).json({
        error: `Lodgify ha rifiutato l'aggiornamento del prezzo: ${reason}`,
        detail: body,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("lodgify/apply-price:", err);
    return res.status(502).json({
      error: "Impossibile contattare Lodgify.",
      detail: err && err.message ? err.message : String(err),
    });
  }
}
