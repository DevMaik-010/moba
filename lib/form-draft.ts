"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Borradores de formularios en localStorage: lo que el usuario escribe
 * sobrevive a una recarga, a cerrar la pestaña o a irse y volver. Cada
 * borrador caduca a la semana y se borra al enviar el formulario con éxito.
 *
 * Las claves llevan el id del usuario para que, en un equipo compartido, la
 * siguiente cuenta no vea lo que escribió la anterior. Nunca se guardan
 * contraseñas, archivos ni campos ocultos.
 */

const PREFIX = "draft:v1:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 300;

type Values = Record<string, string | boolean>;

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw) as { t: number; v: T };
    if (Date.now() - t > TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): el formulario sigue igual.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Igual que arriba.
  }
}

/** Campos que entran al borrador: con nombre o id, visibles y sin datos sensibles. */
function draftable(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLSelectElement)
  ) {
    return false;
  }
  if (el.disabled || !(el.name || el.id)) return false;
  if (el instanceof HTMLInputElement) {
    return !["password", "file", "hidden", "submit", "button", "reset", "image"].includes(el.type);
  }
  return true;
}

const fieldKey = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) =>
  el.name || el.id;

/** Solo lo que difiere del valor inicial: así no se pisan datos frescos del servidor. */
function snapshot(form: HTMLFormElement): Values {
  const values: Values = {};
  for (const el of Array.from(form.elements)) {
    if (!draftable(el)) continue;
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
      if (el.checked === el.defaultChecked) continue;
      if (el.type === "radio") {
        if (el.checked) values[fieldKey(el)] = el.value;
      } else {
        values[fieldKey(el)] = el.checked;
      }
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions[0];
      if (!option || option.defaultSelected) continue;
      values[fieldKey(el)] = el.value;
      continue;
    }
    if (el.value !== el.defaultValue) values[fieldKey(el)] = el.value;
  }
  return values;
}

/**
 * Escribe el valor con el setter nativo y avisa con eventos: los componentes
 * que escuchan onChange (como LocalDateTimeInput) se enteran del cambio.
 */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function apply(form: HTMLFormElement, values: Values) {
  for (const el of Array.from(form.elements)) {
    if (!draftable(el)) continue;
    const key = fieldKey(el);
    if (!(key in values)) continue;
    const value = values[key];
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (el.value === value && !el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
      if (el.checked !== value) {
        el.checked = Boolean(value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (typeof value === "string" && el.value !== value) {
      setFieldValue(el, value);
    }
  }
}

/**
 * Conserva lo escrito en un formulario no controlado.
 *
 * - `key`: con clave, el borrador va a localStorage; con `null` vive solo en
 *   memoria (para campos que no deben quedar en el navegador, como códigos).
 * - `result`: el estado que devuelve la acción. React 19 vacía los formularios
 *   con `action` al terminar, incluso si la acción falló; con un error nuevo se
 *   vuelve a poner lo que había escrito. Si el formulario se desmonta después
 *   de enviarse sin error (redirección, éxito), el borrador se borra.
 */
export function useFormDraft(
  formRef: RefObject<HTMLFormElement | null>,
  key: string | null,
  result?: { error?: string } | null,
) {
  const resultRef = useRef(result);
  useLayoutEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    let memory: Values = (key ? readDraft<Values>(key) : null) ?? {};
    if (Object.keys(memory).length > 0) apply(form, memory);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let submitted = false;
    let resultAtSubmit: typeof result;

    const save = () => {
      clearTimeout(timer);
      pending = false;
      memory = snapshot(form);
      if (!key) return;
      if (Object.keys(memory).length > 0) writeDraft(key, memory);
      else clearDraft(key);
    };
    const onInput = () => {
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    };
    const onSubmit = () => {
      save();
      submitted = true;
      resultAtSubmit = resultRef.current;
    };
    // El evento llega antes de que el formulario se vacíe; se decide después,
    // cuando React ya dejó el nuevo resultado en resultRef.
    const onReset = () => {
      const kept = memory;
      setTimeout(() => {
        const now = resultRef.current;
        if (now === resultAtSubmit) return;
        if (now?.error) {
          if (form.isConnected) apply(form, kept);
        } else {
          // Éxito sin salir de la página: lo enviado ya no es borrador.
          memory = {};
          submitted = false;
          if (key) clearDraft(key);
        }
      }, 0);
    };

    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.addEventListener("submit", onSubmit);
    form.addEventListener("reset", onReset);

    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("reset", onReset);

      const now = resultRef.current;
      const failed = now !== resultAtSubmit && Boolean(now?.error);
      if (key && submitted && !failed) clearDraft(key);
      // Sin envío, lo pendiente se guarda ya (navegar antes de los 300 ms).
      else if (key && !submitted && pending) {
        const values = snapshot(form);
        if (Object.keys(values).length > 0) writeDraft(key, values);
      }
    };
  }, [formRef, key]);

  return {
    /** Borra el borrador guardado (para formularios que no se desmontan al terminar). */
    clear: () => {
      if (key) clearDraft(key);
    },
  };
}
