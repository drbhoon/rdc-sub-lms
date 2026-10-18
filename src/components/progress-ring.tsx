/**
 * A circular progress meter with the percentage in the middle. Pure SVG, so it
 * draws on the server and needs no scripting.
 */
export function ProgressRing({ percent, size = 64, stroke = 7, label }: { percent: number; size?: number; stroke?: number; label?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return <div className="ring" style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.24)) }} role="img" aria-label={label ?? `${value}% complete`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
      <circle
        className="ring-value" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
    <span>{value}%</span>
  </div>;
}
