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
