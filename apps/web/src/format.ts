const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatInt = (value: number): string => integer.format(value);
export const formatMs = (value: number): string => `${oneDecimal.format(value)} ms`;

export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${integer.format(ms)} ms` : `${oneDecimal.format(ms / 1_000)} s`;
}
