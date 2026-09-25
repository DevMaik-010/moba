# SistemasMLBB — torneos de Mobile Legends

Plataforma para organizar torneos **1v1, 3v3 y 5v5** de Mobile Legends: Bang Bang,
con validación de los IDs de juego y un cuadro de eliminación que se llena en vivo
a medida que los equipos se inscriben.

Stack: Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase (Postgres, Auth, RLS, Realtime).

---

## Cómo funciona

**Dos roles.** El *administrador* crea y opera torneos; el *usuario* arma equipos y
los inscribe. El primer admin se crea con un script (ver abajo) porque hace falta un
admin para nombrar al siguiente.

**Equipos reutilizables.** Cada usuario arma sus equipos una vez en *Mis equipos*
(con un modo fijo: 1v1, 3v3 o 5v5) y los inscribe con un clic en cualquier torneo
abierto de ese modo. Al inscribir se copia una *foto* del roster al torneo: editar el
equipo después solo afecta a las próximas inscripciones.

**Ciclo de un torneo.**

```
draft ──abrir──► open ──cerrar──► locked ──iniciar──► running ──final──► finished ──► archivado
        │                  │                  │
   dibuja el cuadro   resuelve byes     se reportan
     vacío completo   (o solo, al        resultados
                      llenarse)
```

Las inscripciones se cierran solas cuando entra el equipo que ocupa el último cupo.
Un torneo finalizado o cancelado se puede **archivar**: sale de la lista pública,
pero su página y sus resultados se conservan.

**El cuadro se apila solo.** Al abrir las inscripciones se crean de una vez todos los
partidos vacíos del cuadro. Cada equipo que se inscribe toma el siguiente cupo libre y
cae en su cuadrito: el 1 y el 2 al primer partido, el 3 y el 4 al segundo, y así. Vía
Supabase Realtime, el cuadrito aparece en la pantalla de todos sin recargar.

**Byes.** Si se inscriben menos equipos que cupos (5 en un cuadro de 8, por ejemplo),
al cerrar las inscripciones los partidos con un solo equipo se resuelven como pase
directo. Un hueco de ronda 2 en adelante solo cuenta como definitivo si el partido que
lo alimenta es una rama muerta — nunca se adjudica un partido que todavía se va a jugar.

---

## Validación de IDs de MLBB

Moonton **no publica una API**. De los servicios comunitarios que se citan por ahí,
`api.isan.eu.org` devuelve HTTP 500 y `yanjiestore.com` responde 403; el único que
funciona es el endpoint de inicio de pago de Codashop, que de paso valida la cuenta
(con un ID inexistente devuelve `errorCode: 1003, Error_Role_Null`).

Por eso la validación es **híbrida** y está detrás de una interfaz de proveedor
(`lib/mlbb/providers/`):

1. Se consulta la caché (`mlbb_account_cache`, 7 días).
2. Se recorre la cadena de proveedores, con timeout de 8s y límite de 20 consultas
   por usuario y hora.
3. Si ninguno da un veredicto, el ID queda **pendiente** y aparece en
   `/admin/validaciones` para que un admin lo apruebe o rechace a mano.

Un ID pendiente **no bloquea** la inscripción; uno inexistente sí. Si Codashop cambia o
bloquea, el torneo sigue operando con validación manual: solo hay que añadir otro
proveedor al array de `lib/mlbb/index.ts`.

> **Pendiente de calibrar:** para saber de qué campo exacto sale el nickname en la
> respuesta de éxito hace falta un ID + zona reales. `extractNickname()` ya prueba
> varias rutas conocidas; con una cuenta real se puede afinar.

---

## Puesta en marcha

### 1. Variables de entorno

```bash
cp .env.example .env.local
```

Rellena `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` desde
Supabase → Settings → API. La service role key es **solo de servidor**: se usa para
la caché de validación y para el script del primer admin.

### 2. Base de datos

Aplica las migraciones en orden, con el MCP de Supabase o pegándolas en el SQL Editor:

```
supabase/migrations/0001_init.sql   tablas, índices, RLS, trigger de perfiles
supabase/migrations/0002_rpc.sql    lógica de torneo (security definer)
supabase/migrations/0003_save_team_roster.sql   guardado atómico del roster
supabase/migrations/0004_admin_tournaments.sql  editar, cancelar, eliminar torneos y quitar equipos
supabase/migrations/0005_saved_teams_archive_autolock.sql  equipos reutilizables, archivo, cierre automático
```

### 3. Primer administrador

```bash
npm run dev            # regístrate en /registro
npm run admin:promote -- tu@correo.com
```

### 4. Listo

```bash
npm run dev
```

---

## Verificación

```bash
npm test          # motor de cuadro: siembra, byes encadenados, avance de ganadores
npm run lint
npm run build
```

Prueba de humo end-to-end:

1. Crea un torneo 5v5 con cuadro de 8 y ábrelo → debe dibujarse el cuadro vacío.
2. Con dos navegadores distintos, arma dos equipos e inscríbelos → los cuadritos
   deben aparecer en ambas pantallas sin recargar.
3. Inscribe 5 equipos y cierra → el quinto debe encadenar byes hasta la final,
   pero la otra semifinal debe seguir *esperando*.
4. Inicia y reporta resultados → los ganadores suben de ronda; al cerrar la final el
   torneo pasa a `finished`.

La lógica SQL se verificó ejecutando las migraciones y el flujo completo contra un
Postgres 17 local, incluidas las políticas RLS (un usuario normal no puede promoverse
a admin, tocar un roster ya inscrito, inscribir el equipo de otro ni reportar
resultados).

---

## Estructura

```
app/(auth)/            login y registro
app/(app)/torneos/     lista, detalle con cuadro en vivo, asistente de inscripción
app/(app)/mis-equipos/ tus equipos reutilizables (crear, editar) e historial de inscripciones
app/admin/             torneos, resultados, cola de validaciones, usuarios
app/api/mlbb/validate/ verificación de un ID (autenticada, con rate-limit)
components/bracket/    cuadro y cuadritos
lib/bracket/           motor de cuadro (funciones puras + tests)
lib/mlbb/              validación de cuentas y proveedores
lib/supabase/          clientes de navegador, servidor y service role
proxy.ts               refresco de sesión (en Next 16 el middleware se llama proxy)
supabase/migrations/   esquema y RPC
```

No afiliado a Moonton ni a Mobile Legends: Bang Bang.
