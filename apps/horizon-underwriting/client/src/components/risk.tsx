import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@databricks/appkit-ui/react';
import { BAND_THRESHOLDS, type RiskBand } from '@/lib/risk';
import { formatProbability } from '@/lib/format';

export function RiskBadge({ band }: { band: RiskBand }) {
  return (
    <Badge variant="outline" className="gap-1.5 bg-card font-medium text-foreground">
      <span className="hz-swatch" data-band={band} aria-hidden="true" />
      {band}
    </Badge>
  );
}

// Scale shown on the meter; probabilities cluster near the band thresholds.
const SCALE_MIN = 0.3;
const SCALE_MAX = 0.55;
const position = (value: number) => Math.min(1, Math.max(0, (value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));

export function RiskMeter({ probability, band }: { probability: number; band: RiskBand }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="hz-eyebrow">Claim risk probability</span>
        <span className="hz-num text-2xl font-medium">{formatProbability(probability)}</span>
      </div>
      <div
        className="hz-meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={probability}
        aria-valuetext={`${formatProbability(probability)}, ${band} risk`}
        aria-label="Claim risk probability"
      >
        <div className="hz-meter-fill" data-band={band} style={{ transform: `scaleX(${position(probability)})` }} />
        {BAND_THRESHOLDS.map((threshold) => (
          <span key={threshold.band} className="hz-meter-tick" style={{ insetInlineStart: `${position(threshold.min) * 100}%` }} />
        ))}
      </div>
      <div className="relative h-5 text-xs text-muted-foreground" aria-hidden="true">
        {BAND_THRESHOLDS.slice().reverse().map((threshold) => (
          <Tooltip key={threshold.band}>
            <TooltipTrigger asChild>
              <span className="hz-num absolute -translate-x-1/2" style={{ insetInlineStart: `${position(threshold.min) * 100}%` }}>
                {threshold.min.toFixed(2)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{threshold.band} at {threshold.min.toFixed(2)} or above</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export function BandDistribution({ rows }: { rows: { band: RiskBand; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <dl className="space-y-4">
      {rows.map((row) => (
        <div key={row.band} className="grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] items-center gap-3">
          <dt className="flex items-center gap-2 text-sm">
            <span className="hz-swatch" data-band={row.band} aria-hidden="true" />
            {row.band}
          </dt>
          <div aria-hidden="true">
            <div className="hz-bar" data-band={row.band} style={{ transform: `scaleX(${row.count / max})` }} />
          </div>
          <dd className="hz-num text-right text-sm">{row.count}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t pt-3 text-sm text-muted-foreground">
        <span>Active West policies</span>
        <span className="hz-num">{total}</span>
      </div>
    </dl>
  );
}
