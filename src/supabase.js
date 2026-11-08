import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
}

const lookingForAuth =
  typeof window !== "undefined" &&
  /access_token|refresh_token|type=recovery|type=signup|code=/.test(`${window.location.hash}${window.location.search}`);

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: lookingForAuth,
  },
});
