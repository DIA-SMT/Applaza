import type { SpaceRecord, UserProfile } from "@/types/domain";

const OPERATING_TIME_ZONE = "America/Argentina/Buenos_Aires";
const EARTH_RADIUS_KM = 6371;

type VisitEvent = {
  id: string;
  userId: string;
  day: string;
  createdAt: string;
  spaceId: string;
  spaceName: string;
  latitude: number;
  longitude: number;
};

export type EstimatedDistanceLeg = {
  id: string;
  fromSpaceName: string;
  toSpaceName: string;
  distanceKm: number;
};

export type EstimatedDistanceRoute = {
  id: string;
  userId: string;
  userName: string;
  day: string;
  distanceKm: number;
  stops: number;
  legs: EstimatedDistanceLeg[];
};

export type EstimatedDistanceReport = {
  periodMonth: string;
  totalKm: number;
  peopleCount: number;
  routeCount: number;
  routes: EstimatedDistanceRoute[];
};

export type EstimatedDistanceDaySummary = {
  day: string;
  distanceKm: number;
  peopleCount: number;
  routeCount: number;
  stops: number;
};

export function buildEstimatedDistanceReport(
  spaces: SpaceRecord[],
  profiles: Pick<UserProfile, "id" | "full_name">[],
  currentUser: UserProfile,
  periodMonth: string,
): EstimatedDistanceReport {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const events: VisitEvent[] = [];

  for (const space of spaces) {
    if (space.latitude == null || space.longitude == null) continue;

    for (const photo of space.photos) {
      if (!photo.uploaded_by) continue;
      if (currentUser.role !== "admin" && photo.uploaded_by !== currentUser.id) continue;

      const day = dateKeyInOperatingTimeZone(photo.created_at);
      if (!day.startsWith(periodMonth)) continue;

      events.push({
        id: photo.id,
        userId: photo.uploaded_by,
        day,
        createdAt: photo.created_at,
        spaceId: space.id,
        spaceName: space.name,
        latitude: space.latitude,
        longitude: space.longitude,
      });
    }
  }

  const eventsByRoute = new Map<string, VisitEvent[]>();
  for (const event of events) {
    const key = `${event.userId}:${event.day}`;
    const routeEvents = eventsByRoute.get(key) ?? [];
    routeEvents.push(event);
    eventsByRoute.set(key, routeEvents);
  }

  const routes: EstimatedDistanceRoute[] = [];
  for (const [routeId, routeEvents] of eventsByRoute) {
    routeEvents.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

    const visits = routeEvents.filter((event, index) => index === 0 || event.spaceId !== routeEvents[index - 1].spaceId);
    const legs: EstimatedDistanceLeg[] = [];
    for (let index = 1; index < visits.length; index += 1) {
      const from = visits[index - 1];
      const to = visits[index];
      legs.push({
        id: `${from.id}:${to.id}`,
        fromSpaceName: from.spaceName,
        toSpaceName: to.spaceName,
        distanceKm: haversineKm(from.latitude, from.longitude, to.latitude, to.longitude),
      });
    }

    const userId = visits[0].userId;
    routes.push({
      id: routeId,
      userId,
      userName: profileById.get(userId) ?? (userId === currentUser.id ? currentUser.full_name : `Usuario ${userId.slice(0, 8)}`),
      day: visits[0].day,
      distanceKm: legs.reduce((total, leg) => total + leg.distanceKm, 0),
      stops: visits.length,
      legs,
    });
  }

  routes.sort((left, right) => right.day.localeCompare(left.day) || right.distanceKm - left.distanceKm);

  return {
    periodMonth,
    totalKm: routes.reduce((total, route) => total + route.distanceKm, 0),
    peopleCount: new Set(routes.map((route) => route.userId)).size,
    routeCount: routes.length,
    routes,
  };
}

export function summarizeEstimatedDistanceDays(report: EstimatedDistanceReport) {
  const summaries = new Map<string, { distanceKm: number; people: Set<string>; routeCount: number; stops: number }>();

  for (const route of report.routes) {
    const summary = summaries.get(route.day) ?? { distanceKm: 0, people: new Set<string>(), routeCount: 0, stops: 0 };
    summary.distanceKm += route.distanceKm;
    summary.people.add(route.userId);
    summary.routeCount += 1;
    summary.stops += route.stops;
    summaries.set(route.day, summary);
  }

  return Array.from(summaries, ([day, summary]): EstimatedDistanceDaySummary => ({
    day,
    distanceKm: summary.distanceKm,
    peopleCount: summary.people.size,
    routeCount: summary.routeCount,
    stops: summary.stops,
  })).sort((left, right) => right.day.localeCompare(left.day));
}

export function findMostProductiveDistanceDay(report: EstimatedDistanceReport) {
  return [...summarizeEstimatedDistanceDays(report)]
    .sort((left, right) => right.stops - left.stops || right.routeCount - left.routeCount || right.distanceKm - left.distanceKm)[0];
}

export function filterEstimatedDistanceReport(report: EstimatedDistanceReport, day: string) {
  if (day === "all") return report;
  const routes = report.routes.filter((route) => route.day === day);

  return {
    ...report,
    routes,
    totalKm: routes.reduce((total, route) => total + route.distanceKm, 0),
    peopleCount: new Set(routes.map((route) => route.userId)).size,
    routeCount: routes.length,
  };
}

export function formatEstimatedKm(value: number) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: value > 0 && value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function dateKeyInOperatingTimeZone(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function haversineKm(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const fromLatitudeRadians = toRadians(fromLatitude);
  const toLatitudeRadians = toRadians(toLatitude);
  const halfLatitude = Math.sin(latitudeDelta / 2);
  const halfLongitude = Math.sin(longitudeDelta / 2);
  const arc = halfLatitude * halfLatitude
    + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians) * halfLongitude * halfLongitude;
  const clampedArc = Math.min(1, Math.max(0, arc));

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(clampedArc), Math.sqrt(1 - clampedArc));
}
