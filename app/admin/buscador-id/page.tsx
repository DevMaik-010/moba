import { DiagnoseForm } from "./diagnose-form";

export default function BuscadorIdPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Buscador de ID</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Consulta cada proveedor por separado, sin caché y sin guardar nada, para ver por
          qué un ID no se resuelve.
        </p>
      </div>
      <DiagnoseForm />
    </div>
  );
}
