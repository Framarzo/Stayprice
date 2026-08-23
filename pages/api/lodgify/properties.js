// Elenca le strutture (e le relative tipologie di camera) presenti
// sull'account Lodgify del proprietario, a partire dalla sua chiave API
// pubblica. Usato solo per popolare le tendine di collegamento nell'app:
// non salva né memorizza nulla, la chiave viene inoltrata a Lodgify e basta.
//
// Nota: legge solo la prima pagina (fino a 50 strutture), più che
// sufficiente per un singolo proprietario B&B/villa.
export default async function handler(req, res) {
  const { apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: "Chiave API di Lodgify mancante." });
  }

  try {
    const resp = await fetch("https://api.lodgify.com/v2/properties?size=50", {
      headers: { "X-ApiKey": apiKey, Accept: "application/json" },
    });
    if (resp.status === 401) {
      return res.status(401).json({ error: "Chiave API di Lodgify non valida o senza permessi." });
    }
    if (!resp.ok) {
      throw new Error(`Lodgify ha risposto ${resp.status}`);
    }
    const data = await resp.json();
    const properties = (data.items || []).map((p) => ({
      id: p.id,
      name: p.name || `Struttura #${p.id}`,
      rooms: (p.rooms || []).map((r) => ({ id: r.id, name: r.name || `Camera #${r.id}` })),
    }));
    return res.status(200).json({ properties });
  } catch (err) {
    console.error("lodgify/properties:", err);
    return res.status(502).json({
      error: "Impossibile leggere le strutture da Lodgify.",
      detail: err && err.message ? err.message : String(err),
    });
  }
}
