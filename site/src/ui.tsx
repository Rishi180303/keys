import { useState } from "react";
import type { Tier } from "./lib/rating";
import { badge, initials } from "./lib/teams";
import type { Photos } from "./lib/types";

/** A player's free licensed photo, or a badge in his team's color with his initials when there is none or it fails. */
export function Avatar({ id, name, team, photos, size = 36, square = false }: {
  id: number;
  name: string;
  team: string;
  photos: Photos | null;
  size?: number;
  square?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const photo = photos?.[String(id)];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  const cls = `avatar${square ? " square" : ""}`;
  if (photo && !broken)
    return <img className={cls} style={style} src={`/data/photos/${photo.file}`} alt="" loading="lazy" onError={() => setBroken(true)} />;
  const { bg, fg } = badge(team);
  return (
    <span className={`${cls} badge`} style={{ ...style, background: bg, color: fg }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function TierChip({ tier }: { tier: Tier }) {
  return <span className={`chip ${tier}`}>{tier === "average" ? "average" : `${tier} average`}</span>;
}

/** The rating with its interval, rating plus or minus two standard errors, on a fixed scale from -1 to +1. */
export function Meter({ rating, se }: { rating: number; se: number }) {
  const x = (v: number) => Math.min(100, Math.max(0, (v + 1) * 50));
  const lo = x(rating - 2 * se);
  return (
    <span className="meter" aria-hidden="true">
      <span className="zero" />
      <span className="interval" style={{ left: `${lo}%`, width: `${x(rating + 2 * se) - lo}%` }} />
      <span className="point" style={{ left: `${x(rating)}%` }} />
    </span>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Stands in for a replay while its play loads, or says what failed with a way to try again. */
export function ReplayWait({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <div className="rp-wait" role={error ? "alert" : "status"}>
      {error ? (
        <>
          <p>{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          )}
        </>
      ) : (
        <p>Loading the play</p>
      )}
    </div>
  );
}
