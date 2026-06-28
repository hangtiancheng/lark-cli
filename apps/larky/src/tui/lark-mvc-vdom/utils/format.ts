export function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function formatAgo(timestamp: string): string {
  const diff = performance.now() - new Date(timestamp).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) {
    return `${String(secs)}s ago`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${String(mins)}m ago`;
  }
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h ago`;
}

export function formatElapsed(startTime: number): string {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  if (secs < 60) {
    return `${String(secs)}s`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${String(mins)}m${String(secs % 60)}s`;
  }
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h${String(mins % 60)}m`;
}
