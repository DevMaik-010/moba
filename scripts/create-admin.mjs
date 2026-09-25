/**
 * Crea (o reutiliza) un usuario y lo deja como administrador de una vez,
 * sin pasar por /registro.
 *
 *   npm run admin:create -- correo@dominio.com "contraseña" ["Nombre a mostrar"]
 *
 * Usa la service role key porque `auth.admin.createUser` e ignorar RLS en
 * `profiles` requieren saltarse las políticas normales.
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

const [email, password, displayName] = process.argv.slice(2);
if (!email || !password) {
  console.error('Uso: npm run admin:create -- correo@dominio.com "contraseña" ["Nombre"]');
  process.exit(1);
}
if (password.length < 6) {
  console.error("La contraseña debe tener al menos 6 caracteres (mínimo de Supabase Auth).");
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

// Si ya existe (por ejemplo porque se registró desde /registro), se reutiliza
// en vez de fallar, y solo se promueve a admin.
const { data: existing, error: listError } = await supabase.auth.admin.listUsers({
  perPage: 1000,
});
if (listError) {
  console.error("No se pudo listar usuarios:", listError.message);
  process.exit(1);
}

let userId = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;

if (userId) {
  console.log(`El usuario ${email} ya existía; se promueve a admin.`);
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no necesita revisar correo para entrar
    user_metadata: displayName ? { display_name: displayName } : undefined,
  });

  if (error || !data.user) {
    console.error("No se pudo crear el usuario:", error?.message);
    process.exit(1);
  }
  userId = data.user.id;
}

// El trigger handle_new_user() crea el profile al crear el usuario, pero por
// si acaso hay una carrera con el trigger, se espera un poco y se reintenta.
async function setAdminRole(id, attempt = 1) {
  const { error, count } = await supabase
    .from("profiles")
    .update({ role: "admin" }, { count: "exact" })
    .eq("id", id);

  if (error) {
    console.error("No se pudo actualizar el perfil:", error.message);
    process.exit(1);
  }
  if (count === 0 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 300));
    return setAdminRole(id, attempt + 1);
  }
  if (count === 0) {
    console.error("El perfil nunca apareció (¿se aplicó la migración 0001_init.sql?).");
    process.exit(1);
  }
}

await setAdminRole(userId);

if (displayName) {
  await supabase.from("profiles").update({ display_name: displayName }).eq("id", userId);
}

console.log(`✓ ${email} es administrador. Ya puedes entrar en /login con esa contraseña.`);
