"use client";

import { useState } from "react";

type Point = { key: string; label: string; bookings: number; bookingValue: number; newCustomers: number };
type Metric = "bookings" | "bookingValue" | "newCustomers";
type View = "bar" | "trend" | "data";
const choices: { key: Metric; label: string }[] = [
  { key: "bookings", label: "Bookings" }, { key: "bookingValue", label: "Booking value" },
  { key: "newCustomers", label: "New customers" },
];
export function BasicReportChart({ points, currency }: { points: Point[]; currency: string }) {
  const [metric, setMetric] = useState<Metric>("bookings");
  const [view, setView] = useState<View>("bar");
  const values = points.map(point => point[metric]);
  const max = Math.max(1, ...values);
  const format = (value: number) => metric === "bookingValue" ? new Intl.NumberFormat("en-MY", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100) : String(value);
  const line = values.map((value, index) => `${points.length === 1 ? 500 : 20 + index * 960 / (points.length - 1)},${190 - value / max * 165}`).join(" ");
  return <section className="foundation-card starter-chart-card" aria-label="Basic report chart">
    <div className="starter-chart-head"><div><p className="eyebrow">ACTIVITY</p><h2>{choices.find(choice => choice.key === metric)?.label} over time</h2><p>{metric === "newCustomers" ? "New customer records created in this period." : metric === "bookingValue" ? "Value of bookings scheduled in this period, excluding cancelled and expired." : "Bookings scheduled in this period."}</p></div><div className="starter-chart-controls"><label>Show<select value={metric} onChange={event => setMetric(event.target.value as Metric)}>{choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select></label><div className="starter-chart-view" role="group" aria-label="Chart view">{([ ["bar", "Bars"], ["trend", "Trend"], ["data", "Data"] ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div></div></div>
    {view === "data" ? <div className="starter-chart-table-wrap"><table className="starter-chart-table"><thead><tr><th>Period</th><th>Bookings</th><th>Booking value</th><th>New customers</th></tr></thead><tbody>{points.map(point => <tr key={point.key}><td>{point.label}</td><td>{point.bookings}</td><td>{new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(point.bookingValue / 100)}</td><td>{point.newCustomers}</td></tr>)}</tbody></table></div> : view === "bar" ? <div className="starter-chart-bars" role="img" aria-label={`${choices.find(choice => choice.key === metric)?.label} bar chart`}>
      {points.map((point, index) => <div className="starter-chart-bar-item" key={point.key} title={`${point.label}: ${format(values[index])}`}><span className="starter-chart-bar-value">{values[index] ? format(values[index]) : ""}</span><span className="starter-chart-bar-track"><span style={{ height: `${Math.max(values[index] ? 3 : 0, values[index] / max * 100)}%` }} /></span><small>{point.label}</small></div>)}
    </div> : <div className="starter-chart-trend"><svg viewBox="0 0 1000 210" role="img" aria-label={`${choices.find(choice => choice.key === metric)?.label} trend chart`} preserveAspectRatio="none"><line x1="20" y1="190" x2="980" y2="190" stroke="#d8e1da" /><polyline fill="none" stroke="#176b5b" strokeWidth="3" strokeLinejoin="round" points={line} />{values.map((value, index) => <circle key={points[index].key} cx={points.length === 1 ? 500 : 20 + index * 960 / (points.length - 1)} cy={190 - value / max * 165} r="4" fill="#176b5b"><title>{points[index].label}: {format(value)}</title></circle>)}</svg><div className="starter-chart-trend-labels"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length / 2)]?.label}</span><span>{points.at(-1)?.label}</span></div></div>}
    <p className="starter-chart-footnote">{points.length} {points.length === 1 ? "period" : "periods"} shown · Use Data for exact values.</p>
  </section>;
}
