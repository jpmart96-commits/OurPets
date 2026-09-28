import { useState } from 'react'
import { fmtDate, monthShort, parseISO } from '../lib/dates'

interface Point { date: string; kg: number }

const W = 340, H = 180, L = 34, R = 14, T = 26, B = 26

export default function WeightChart({ points }: { points: Point[] }) {
  const [sel, setSel] = useState<number | null>(null)
  if (points.length < 2) return null
  const ts = points.map((p) => parseISO(p.date).getTime())
  const t0 = ts[0], t1 = ts[ts.length - 1]
  const vals = points.map((p) => p.kg)
  const span = Math.max(...vals) - Math.min(...vals)
  const unit = span > 6 ? 2 : span > 1.5 ? 1 : 0.5
  let lo = Math.floor((Math.min(...vals) - unit / 4) / unit) * unit
  let hi = Math.ceil((Math.max(...vals) + unit / 4) / unit) * unit
  if (Math.round((hi - lo) / unit) % 2 === 1) hi += unit
  if (lo < 0) lo = 0
  const x = (t: number) => L + (t1 === t0 ? (W - L - R) / 2 : ((t - t0) / (t1 - t0)) * (W - L - R))
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B)
  const xy = points.map((p, i) => ({ x: x(ts[i]), y: y(p.kg) }))
  const path = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const ticks = [hi, (hi + lo) / 2, lo]
  const s = sel ?? points.length - 1

  // month labels, at most ~6, no duplicates
  const labels: { x: number; text: string }[] = []
  const step = Math.max(1, Math.ceil(points.length / 6))
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return
    const text = monthShort(p.date)
    if (labels.some((l) => l.text === text || Math.abs(l.x - xy[i].x) < 30)) return
    labels.push({ x: xy[i].x, text })
  })

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight from ${fmtDate(points[0].date)} to ${fmtDate(points[points.length - 1].date)}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#ECE8DF" />
            <text x={0} y={y(v) + 4} fontSize="11" fill="#5E6660">{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#2F5D50" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {xy.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === s ? 6 : 4.5} fill="#2F5D50" stroke="#fff" strokeWidth="2" />
        ))}
        {labels.map((l) => <text key={l.x} x={l.x} y={H - 6} fontSize="11" fill="#5E6660" textAnchor="middle">{l.text}</text>)}
      </svg>
      {xy.map((p, i) => (
        <button key={i} type="button" onClick={() => setSel(i)} aria-label={`${fmtDate(points[i].date)}: ${points[i].kg} kg`}
          style={{ position: 'absolute', left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, width: 32, height: 32, transform: 'translate(-50%, -50%)', border: 0, background: 'transparent', padding: 0 }} />
      ))}
      <div className="tip" style={{ left: `${Math.min(84, Math.max(16, (xy[s].x / W) * 100))}%`, top: `calc(${(xy[s].y / H) * 100}% - 12px)` }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{points[s].kg.toFixed(1)} kg</div>
        <div style={{ opacity: 0.8 }}>{fmtDate(points[s].date)}</div>
      </div>
    </div>
  )
}
