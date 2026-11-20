const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo",
});
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const fullDateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/** Data completa com ano (dd/mm/aaaa), para registros que ficam por anos, como a data de cadastro de um usuário. */
export function formatFullDate(value: string): string {
  return fullDateFmt.format(new Date(value));
}

export function formatDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00-03:00` : value;
  return dateFmt.format(new Date(iso)).replace(".", "");
}

export function formatDateTime(value: string): string {
  return dateTimeFmt.format(new Date(value)).replace(".", "");
}

export function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1).replace(".", ",")} h`;
  return `${(hours / 24).toFixed(1).replace(".", ",")} dias`;
}
