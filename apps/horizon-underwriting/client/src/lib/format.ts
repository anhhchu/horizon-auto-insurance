const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatCurrency = (value: number | null | undefined) => currency.format(Number(value ?? 0));
export const formatInteger = (value: number | null | undefined) => integer.format(Number(value ?? 0));
export const formatProbability = (value: number | null | undefined) => Number(value ?? 0).toFixed(3);
export const formatPercent = (value: number | null | undefined) => `${Math.round(Number(value ?? 0) * 100)}%`;

function parse(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const formatDate = (value: string | null | undefined) => {
  const parsed = parse(value);
  return parsed ? date.format(parsed) : 'Unknown';
};

export const formatDateTime = (value: string | null | undefined) => {
  const parsed = parse(value);
  return parsed ? dateTime.format(parsed) : 'Unknown';
};

export function daysUntil(value: string | null | undefined) {
  const parsed = parse(value);
  if (!parsed) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
}

export function hoursSince(value: string | null | undefined) {
  const parsed = parse(value);
  return parsed ? (Date.now() - parsed.getTime()) / 3_600_000 : null;
}
