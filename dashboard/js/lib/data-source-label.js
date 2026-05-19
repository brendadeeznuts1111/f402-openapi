/** Human label for Worker response `source` (live / d1 / archive / cached live). */

export function formatDataSourceLabel(data) {
  if (data?.cached) return 'cached live';
  const source = data?.source;
  if (source === 'archive') return 'archive (R2)';
  if (source === 'd1') return 'D1';
  if (source === 'live') return 'live';
  return source ? String(source) : 'live';
}
