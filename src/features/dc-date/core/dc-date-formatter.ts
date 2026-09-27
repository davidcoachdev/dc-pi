/**
 * Formatea una fecha local en formato ISO YYYY-MM-DD.
 */
export function formatLocalDateIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Retorna la fecha actual con día de la semana y mes legible para contexto del LLM.
 */
export function getContextDateString(date: Date = new Date()): string {
  const iso = formatLocalDateIso(date);
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const dayName = days[date.getDay()] ?? "";
  return `${iso} (${dayName})`;
}
