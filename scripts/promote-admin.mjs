/**
 * Promueve a administrador al usuario con el correo indicado.
 *
 *   npm run admin:promote -- tu@correo.com
 *
 * Existe porque `set_user_role` exige que quien llama ya sea admin: el primero
 * tiene que crearse con la service role key, que ignora RLS.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Sin .env.local se esperan las variables ya exportadas.
  }
}

loadEnv(".env.local");

const email = process.argv[2];
if (!email) {
  console.error("Uso: npm run admin:promote -- tu@correo.com");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (revisa .env.local)",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (error) {
  console.error("No se pudo listar usuarios:", error.message);
  process.exit(1);
}

const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No existe un usuario con el correo ${email}. Regístralo primero en /registro.`);
  process.exit(1);
}

const { error: updateError } = await supabase
  .from("profiles")
  .update({ role: "admin" })
  .eq("id", user.id);

if (updateError) {
  console.error("No se pudo actualizar el perfil:", updateError.message);
  process.exit(1);
}

console.log(`✓ ${email} ahora es administrador.`);
