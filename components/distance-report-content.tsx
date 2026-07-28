"use client";

import { CalendarDays, ChevronRight, Trophy } from "lucide-react";
import {
  filterEstimatedDistanceReport,
  findMostProductiveDistanceDay,
  formatEstimatedKm,
  type EstimatedDistanceReport,
} from "@/lib/estimated-distance";

export function DistanceReportContent({
  report,
  selectedDay,
  onDayChange,
}: {
  report: EstimatedDistanceReport;
  selectedDay: string;
  onDayChange: (day: string) => void;
}) {
  const productiveDay = findMostProductiveDistanceDay(report);
  const visibleReport = filterEstimatedDistanceReport(report, selectedDay);
  const [periodYear, periodMonth] = report.periodMonth.split("-").map(Number);
  const lastPeriodDay = new Date(periodYear, periodMonth, 0).getDate();
  const minimumDay = `${report.periodMonth}-01`;
  const maximumDay = `${report.periodMonth}-${String(lastPeriodDay).padStart(2, "0")}`;

  return <>
    <div className="distance-filter-bar">
      <div className="distance-date-control">
        <button className={selectedDay === "all" ? "active" : ""} onClick={() => onDayChange("all")}>Todo el mes</button>
        <label className={selectedDay !== "all" ? "active" : ""}>
          <CalendarDays size={16} />
          <span>Elegir día</span>
          <input
            type="date"
            min={minimumDay}
            max={maximumDay}
            value={selectedDay === "all" ? "" : selectedDay}
            onChange={(event) => onDayChange(event.target.value || "all")}
            aria-label="Filtrar recorrido por fecha"
          />
        </label>
      </div>
      {productiveDay && <button className={selectedDay === productiveDay.day ? "active" : ""} onClick={() => onDayChange(productiveDay.day)}>
        <Trophy size={16} />
        <span>Día más productivo</span>
        <strong>{formatDistanceDay(productiveDay.day)} · {productiveDay.stops} visitas</strong>
      </button>}
    </div>

    <div className="distance-overview">
      <div><span>Distancia estimada</span><strong>{formatEstimatedKm(visibleReport.totalKm)} km</strong></div>
      <div><span>Jornadas registradas</span><strong>{visibleReport.routeCount}</strong></div>
      <div><span>Personas registradas</span><strong>{visibleReport.peopleCount}</strong></div>
    </div>

    {visibleReport.routes.length ? <div className="distance-route-list">
      {visibleReport.routes.map((route) => <article key={route.id}>
        <header>
          <div><strong>{route.userName}</strong><span>{formatDistanceDay(route.day)} · {route.stops} {route.stops === 1 ? "espacio" : "espacios"}</span></div>
          <b>{formatEstimatedKm(route.distanceKm)} km</b>
        </header>
        {route.legs.length ? <div className="distance-leg-list">
          {route.legs.map((leg) => <div key={leg.id}>
            <span>{leg.fromSpaceName}</span><ChevronRight size={14} /><span>{leg.toSpaceName}</span><strong>{formatEstimatedKm(leg.distanceKm)} km</strong>
          </div>)}
        </div> : <p className="distance-single-stop">Una visita registrada, todavía sin un segundo espacio para calcular el tramo.</p>}
      </article>)}
    </div> : <p className="dashboard-empty compact">No hay evidencias con espacios ubicados para este período.</p>}

    <p className="distance-note">Distancia lineal estimada entre las ubicaciones del padrón. Varias fotos consecutivas del mismo espacio cuentan como una sola visita.</p>
  </>;
}

export function formatDistanceDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(year, month - 1, date));
}
