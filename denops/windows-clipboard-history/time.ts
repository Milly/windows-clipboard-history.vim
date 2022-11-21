export function toDuration(ms: number): string {
  const d = Math.abs(ms) / 1000;
  let res: string;
  if (d < 60) {
    res = `${Math.floor(d)}s`;
  } else if (d < 3600) {
    res = `${Math.floor(d / 60)}m`;
  } else if (d < 86400) {
    res = `${Math.floor(d / 3600)}h`;
  } else {
    res = `${Math.floor(d / 86400)}d`;
  }
  return res;
}
