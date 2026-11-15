export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "< 0,01 $";
  return `${value.toLocaleString("it-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("it-CH", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("it-CH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
