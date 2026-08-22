import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Non blocchiamo il build (le variabili possono mancare quando si esegue
  // `npm run build` in locale senza .env.local, o durante la raccolta dati
  // delle pagine): createClient() richiede comunque un URL sintatticamente
  // valido, quindi usiamo un placeholder che fallirà solo se davvero
  // interpellato a runtime senza le vere variabili d'ambiente impostate.
  console.warn(
    "Variabili Supabase mancanti: imposta NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);
