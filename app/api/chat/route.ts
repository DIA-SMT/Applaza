import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Provider, SpaceRecord, SpaceType } from "@/types/domain";

type ChatHistoryItem = {
  role: "assistant" | "user";
  content: string;
};

type ControlValue = "si" | "no" | null;
type ControlRecord = {
  provider_id: string;
  green_space_id: string;
  period_month: string;
  control_1: ControlValue;
  control_2: ControlValue;
  control_3: ControlValue;
  control_1_date?: string | null;
  control_2_date?: string | null;
  control_3_date?: string | null;
  updated_at?: string | null;
};

type AuditObservation = {
  green_space_id: string;
  provider_id: string | null;
  period_month: string;
  observation: string;
  created_at: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.history) ? sanitizeHistory(body.history) : [];
    if (!message) return NextResponse.json({ answer: "Escribi una consulta para poder ayudarte." }, { status: 400 });

    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ answer: "Necesitas iniciar sesion para usar el asistente." }, { status: 401 });

    const month = detectRequestedMonth(message) ?? currentMonth();
    const [{ spaces, providers, error }, recordsResult, observationsResult] = await Promise.all([
      getDashboardData(supabase),
      supabase.from("control_records").select("provider_id,green_space_id,period_month,control_1,control_1_date,control_2,control_2_date,control_3,control_3_date,updated_at").eq("period_month", `${month}-01`),
      supabase.from("audit_observations").select("green_space_id,provider_id,period_month,observation,created_at").eq("period_month", `${month}-01`).order("created_at", { ascending: false }),
    ]);

    const records = (recordsResult.data ?? []) as ControlRecord[];
    const observations = (observationsResult.data ?? []) as AuditObservation[];
    const requestedProvider = findRequestedProvider(message, providers);
    const context = buildAssistantContext({
      message,
      month,
      spaces,
      providers,
      records,
      observations,
      requestedProviderId: requestedProvider?.id,
      dataError: error,
      recordsError: recordsResult.error?.message,
      observationsError: observationsResult.error?.message,
    });

    const localAnswer = buildLocalAnswer(message, context);
    const shouldAttachReport = isReportRequest(message) || shouldAttachProviderReport(context);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      const reportContent = `${localAnswer}\n\nRecomendaciones operativas:\n- Priorizar cooperativas con pendientes altos.\n- Revisar espacios sin evidencia reciente.\n- Validar observaciones cargadas por supervision antes del cierre del periodo.`;
      return NextResponse.json({
        answer: shouldAttachReport ? buildReportChatAnswer(context) : localAnswer,
        mode: "local",
        report: shouldAttachReport ? buildReportPayload(reportContent, context) : null,
      });
    }

    const aiAnswer = await askOpenRouter({ apiKey, message, history, context, reportMode: shouldAttachReport });
    return NextResponse.json({
      answer: shouldAttachReport ? buildReportChatAnswer(context) : aiAnswer,
      mode: "openrouter",
      report: shouldAttachReport ? buildReportPayload(aiAnswer, context) : null,
    });
  } catch (error) {
    console.error("Assistant chat error:", error);
    return NextResponse.json({ answer: "No pude procesar la consulta. Revisa la configuracion del asistente e intenta nuevamente." }, { status: 500 });
  }
}

function isReportRequest(message: string) {
  if (["auditor", "ubicacion", "ubicaciones", "ubicados", "ubicar", "sin ubicar", "observacion", "observaciones", "notas", "pasame"].some((word) => message.toLocaleLowerCase("es").includes(word))) return true;
  const lower = message.toLocaleLowerCase("es");
  return ["informe", "auditoria", "auditoría", "pdf", "reporte", "descargar", "ultimo mes", "último mes", "mes pasado"].some((word) => lower.includes(word));
}

function buildReportChatAnswer(context: ReturnType<typeof buildAssistantContext>) {
  if (context.focusedProvider) {
    return `Listo. Prepare el detalle de ${context.focusedProvider.provider} para ${context.summary.periodLabel} y te dejo el PDF listo para descargar.`;
  }
  return `Listo. Prepare el resumen de ${context.summary.periodLabel} con el formato de auditoria y te dejo el PDF listo para descargar.`;
}

function buildReportPayload(answer: string, context: ReturnType<typeof buildAssistantContext>) {
  return {
    title: context.focusedProvider
      ? `Informe de ${context.focusedProvider.provider} - ${context.summary.periodLabel}`
      : `Informe de auditoria - ${context.summary.periodLabel}`,
    period: context.summary.period,
    periodLabel: context.summary.periodLabel,
    generatedAt: new Date().toISOString(),
    content: answer,
    summary: context.summary,
    focusedProvider: context.focusedProvider,
    providerRows: context.focusedProvider ? [context.focusedProvider.row] : context.providerRows,
    pendingSpaces: context.pendingSpaces,
    recentObservations: context.focusedProvider ? context.focusedProvider.recentObservations : context.recentObservations,
  };
}

function sanitizeHistory(items: unknown[]): ChatHistoryItem[] {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = "role" in item ? item.role : null;
      const content = "content" in item ? item.content : null;
      if ((role !== "assistant" && role !== "user") || typeof content !== "string") return null;
      return { role, content: content.slice(0, 700) };
    })
    .filter((item): item is ChatHistoryItem => Boolean(item))
    .slice(-8);
}

function buildAssistantContext({
  message,
  month,
  spaces,
  providers,
  records,
  observations,
  requestedProviderId,
  dataError,
  recordsError,
  observationsError,
}: {
  message: string;
  month: string;
  spaces: SpaceRecord[];
  providers: Provider[];
  records: ControlRecord[];
  observations: AuditObservation[];
  requestedProviderId?: string;
  dataError: string | null;
  recordsError?: string;
  observationsError?: string;
}) {
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const recordsBySpace = new Map(records.map((record) => [record.green_space_id, record]));
  const activeProviders = providers.filter((provider) => provider.active);
  const located = spaces.filter((space) => space.latitude != null && space.longitude != null).length;
  const photosInMonth = spaces.flatMap((space) => space.photos.filter((photo) => photo.created_at.slice(0, 7) === month));

  const providerRows = activeProviders.map((provider) => {
    const assignedSpaces = spaces.filter((space) => space.provider?.id === provider.id);
    const providerRecords = records.filter((record) => record.provider_id === provider.id);
    const reviewed = assignedSpaces.filter((space) => {
      const record = recordsBySpace.get(space.id);
      return hasReviewedRecord(record);
    }).length;
    const negative = providerRecords.filter((record) => [record.control_1, record.control_2, record.control_3].includes("no")).length;
    const providerObservations = observations.filter((observation) => {
      const space = spaceById.get(observation.green_space_id);
      return observation.provider_id === provider.id || space?.provider?.id === provider.id;
    });
    const providerPhotos = assignedSpaces.reduce((total, space) => total + space.photos.filter((photo) => photo.created_at.slice(0, 7) === month).length, 0);
    return {
      provider: provider.name,
      assigned: assignedSpaces.length,
      reviewed,
      pending: Math.max(assignedSpaces.length - reviewed, 0),
      coverage: assignedSpaces.length ? Math.round((reviewed / assignedSpaces.length) * 100) : 0,
      observedControls: negative,
      observations: providerObservations.length,
      photos: providerPhotos,
    };
  }).sort((left, right) => right.pending - left.pending || left.provider.localeCompare(right.provider, "es"));

  const focusedProvider = requestedProviderId ? buildFocusedProvider({
    provider: activeProviders.find((provider) => provider.id === requestedProviderId),
    providerRows,
    spaces,
    observations,
    recordsBySpace,
    month,
  }) : null;

  const pendingSpaces = focusedProvider
    ? focusedProvider.pendingSpaces
    : spaces
      .filter((space) => !hasReviewedRecord(recordsBySpace.get(space.id)))
      .slice(0, 30)
      .map(mapPendingSpace);

  const recentObservations = observations.slice(0, 10).map((observation) => {
    const space = spaceById.get(observation.green_space_id);
    return {
      space: space?.name ?? "Espacio sin identificar",
      provider: space?.provider?.name ?? "Sin cooperativa",
      observation: observation.observation,
      date: observation.created_at,
    };
  });

  const summary = {
    period: month,
    periodLabel: formatMonth(month),
    totalSpaces: spaces.length,
    locatedSpaces: located,
    unlocatedSpaces: Math.max(spaces.length - located, 0),
    activeProviders: activeProviders.length,
    controlRecords: records.length,
    reviewedSpaces: spaces.filter((space) => {
      const record = recordsBySpace.get(space.id);
      return hasReviewedRecord(record);
    }).length,
    observations: observations.length,
    evidencePhotos: photosInMonth.length,
    spacesByType: countSpacesByType(spaces),
    dataWarnings: [dataError, recordsError, observationsError].filter(Boolean),
  };

  const mentionedSpaces = findRequestedSpaces(message, spaces, recordsBySpace, month);

  const evidenceActivity = focusedProvider
    ? focusedProvider.evidenceActivity
    : buildEvidenceActivity(spaces, month);
  const reviewCadence = focusedProvider
    ? focusedProvider.reviewCadence
    : buildReviewCadence(records);

  return { summary, providerRows, pendingSpaces, recentObservations, focusedProvider, mentionedSpaces, evidenceActivity, reviewCadence };
}

function buildLocalAnswer(message: string, context: ReturnType<typeof buildAssistantContext>) {
  const lower = message.toLocaleLowerCase("es");
  const normalized = normalizeText(message);
  const { summary, providerRows, focusedProvider, mentionedSpaces, evidenceActivity, reviewCadence } = context;
  const topPending = providerRows.filter((row) => row.pending > 0).slice(0, 5);

  if (mentionedSpaces.length) {
    return mentionedSpaces
      .map((space) => [
        `${space.name} (${space.type}) esta en ${space.address}, barrio ${space.neighborhood}, seccion ${space.section}.`,
        `Cooperativa: ${space.provider}. ${space.located ? "Tiene ubicacion cargada" : "Todavia no tiene ubicacion"}. ${space.reviewed ? "Registra control en el periodo" : "Sin control registrado en el periodo"}.`,
        space.controlDates.length ? `Fechas de control: ${space.controlDates.join(", ")}.` : "No tiene fechas de control cargadas.",
        `Evidencias: ${space.photosInMonth} en ${summary.periodLabel} y ${space.photosTotal} en total.`,
      ].join(" "))
      .join("\n\n");
  }

  if (["produccion", "dias fuertes", "dia fuerte", "mas fotos", "carga de evidencia"].some((word) => normalized.includes(word))) {
    const top = evidenceActivity.topDays.slice(0, 3).map((day) => `${day.label} (${day.total})`).join(", ");
    return [
      `Produccion de evidencias en ${summary.periodLabel}: ${evidenceActivity.totalInMonth} fotos cargadas en ${evidenceActivity.activeDays} dias con actividad.`,
      top ? `Dias de mayor produccion: ${top}.` : "Todavia no hay evidencias cargadas en el periodo.",
      evidenceActivity.byWeekday.length ? `El dia de semana mas activo es ${evidenceActivity.byWeekday[0].weekday} con ${evidenceActivity.byWeekday[0].total} evidencias.` : "",
    ].filter(Boolean).join("\n");
  }

  if (["cada cuanto", "frecuencia", "periodicidad", "cada cuantos dias", "revision", "revisiones"].some((word) => normalized.includes(word))) {
    return [
      `Revisiones de ${summary.periodLabel}: ${reviewCadence.datedVisits} controles con fecha sobre ${summary.controlRecords} registros cargados.`,
      reviewCadence.averageDaysBetweenVisits != null
        ? `Entre visitas al mismo espacio pasan en promedio ${reviewCadence.averageDaysBetweenVisits} dias.`
        : "No hay suficientes visitas fechadas al mismo espacio para calcular un promedio.",
      reviewCadence.firstVisit && reviewCadence.lastVisit ? `La actividad va del ${reviewCadence.firstVisit} al ${reviewCadence.lastVisit}.` : "",
      `Por vuelta: ${reviewCadence.visitsByRound.control1} en el primer control, ${reviewCadence.visitsByRound.control2} en el segundo y ${reviewCadence.visitsByRound.control3} en el tercero.`,
      reviewCadence.undatedControls ? `Atencion: ${reviewCadence.undatedControls} controles estan cargados sin fecha.` : "",
    ].filter(Boolean).join("\n");
  }

  if (focusedProvider) {
    const sample = focusedProvider.pendingSpaces.slice(0, 6).map((space) => space.name).join(", ");
    return [
      `Informacion sobre ${focusedProvider.provider} en ${summary.periodLabel}: ${focusedProvider.assigned} espacios asignados, ${focusedProvider.reviewed} revisados y ${focusedProvider.pending} pendientes.`,
      focusedProvider.pending > 6
        ? `El listado completo tiene ${focusedProvider.pending} espacios pendientes, por eso lo preparo en PDF para descargar.`
        : focusedProvider.pending > 0
          ? `Pendientes: ${sample}.`
          : "No registra espacios pendientes con los datos actuales.",
      `Observaciones: ${focusedProvider.observations}. Fotos de evidencia: ${focusedProvider.photos}.`,
    ].join("\n");
  }

  if (lower.includes("ubicacion") || lower.includes("ubicaciones") || lower.includes("ubicados") || lower.includes("ubicar")) {
    return `Estado de ubicaciones de ${summary.periodLabel}: ${summary.locatedSpaces} espacios con ubicacion y ${summary.unlocatedSpaces} pendientes de ubicar sobre ${summary.totalSpaces} espacios cargados.`;
  }

  if (lower.includes("observacion") || lower.includes("observaciones") || lower.includes("notas")) {
    return `Observaciones de ${summary.periodLabel}: hay ${summary.observations} observaciones operativas registradas para seguimiento de supervision y auditoria.`;
  }

  if (lower.includes("informe") || lower.includes("auditoria") || lower.includes("ultimo mes") || lower.includes("mes")) {
    return [
      `Informe de ${summary.periodLabel}: ${summary.totalSpaces} espacios cargados, ${summary.reviewedSpaces} con controles registrados y ${summary.evidencePhotos} evidencias del periodo.`,
      `Hay ${summary.observations} observaciones operativas y ${summary.unlocatedSpaces} espacios pendientes de ubicar.`,
      topPending.length ? `Cooperativas con mas pendientes: ${topPending.map((row) => `${row.provider} (${row.pending})`).join(", ")}.` : "No se detectan pendientes por cooperativa con los datos actuales.",
    ].join("\n");
  }

  if (lower.includes("pendiente")) {
    return topPending.length
      ? `Pendientes principales de ${summary.periodLabel}: ${topPending.map((row) => `${row.provider}: ${row.pending} pendientes, ${row.coverage}% cobertura`).join("; ")}.`
      : `No encontre pendientes relevantes para ${summary.periodLabel}.`;
  }

  if (lower.includes("evidencia") || lower.includes("foto")) {
    return `En ${summary.periodLabel} hay ${summary.evidencePhotos} evidencias cargadas. Las cooperativas con mas fotos son ${providerRows.slice().sort((a, b) => b.photos - a.photos).slice(0, 4).map((row) => `${row.provider} (${row.photos})`).join(", ") || "sin registros"}.`;
  }

  return `Resumen operativo de ${summary.periodLabel}: ${summary.totalSpaces} espacios, ${summary.activeProviders} cooperativas activas, ${summary.reviewedSpaces} espacios controlados, ${summary.observations} observaciones y ${summary.evidencePhotos} evidencias.`;
}

function findRequestedSpaces(message: string, spaces: SpaceRecord[], recordsBySpace: Map<string, ControlRecord>, month: string) {
  const normalizedMessage = ` ${normalizeText(message)} `;
  const mentionsWholeTerm = (term: string, minimumLength: number) => term.length >= minimumLength && normalizedMessage.includes(` ${term} `);
  return spaces
    .filter((space) => mentionsWholeTerm(normalizeText(space.name), 6) || mentionsWholeTerm(normalizeText(space.address ?? ""), 8))
    .slice(0, 6)
    .map((space) => {
      const record = recordsBySpace.get(space.id);
      return {
        name: space.name,
        type: spaceTypeLabel(space.type),
        address: space.address || "Sin direccion cargada",
        neighborhood: space.neighborhood || "Sin barrio",
        section: space.section_code ?? "Sin seccion",
        provider: space.provider?.name ?? "Sin cooperativa",
        status: space.status,
        located: space.latitude != null && space.longitude != null,
        surfaceM2: space.surface_m2 ?? null,
        reviewed: hasReviewedRecord(record),
        controlDates: record ? controlDates(record) : [],
        photosInMonth: space.photos.filter((photo) => photo.created_at.slice(0, 7) === month).length,
        photosTotal: space.photos.length,
      };
    });
}

function findRequestedProvider(message: string, providers: Provider[]) {
  const normalizedMessage = normalizeText(message);
  return providers
    .filter((provider) => normalizeText(provider.name).length > 2)
    .find((provider) => normalizedMessage.includes(normalizeText(provider.name)));
}

function shouldAttachProviderReport(context: ReturnType<typeof buildAssistantContext>) {
  return Boolean(context.focusedProvider && context.focusedProvider.pending > 6);
}

function buildFocusedProvider({
  provider,
  providerRows,
  spaces,
  observations,
  recordsBySpace,
  month,
}: {
  provider?: Provider;
  providerRows: Array<{
    provider: string;
    assigned: number;
    reviewed: number;
    pending: number;
    coverage: number;
    observedControls: number;
    observations: number;
    photos: number;
  }>;
  spaces: SpaceRecord[];
  observations: AuditObservation[];
  recordsBySpace: Map<string, ControlRecord>;
  month: string;
}) {
  if (!provider) return null;

  const assignedSpaces = spaces.filter((space) => space.provider?.id === provider.id);
  const row = providerRows.find((item) => item.provider === provider.name) ?? {
    provider: provider.name,
    assigned: assignedSpaces.length,
    reviewed: assignedSpaces.filter((space) => hasReviewedRecord(recordsBySpace.get(space.id))).length,
    pending: assignedSpaces.filter((space) => !hasReviewedRecord(recordsBySpace.get(space.id))).length,
    coverage: 0,
    observedControls: 0,
    observations: 0,
    photos: assignedSpaces.reduce((total, space) => total + space.photos.filter((photo) => photo.created_at.slice(0, 7) === month).length, 0),
  };
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const pendingSpaces = assignedSpaces
    .filter((space) => !hasReviewedRecord(recordsBySpace.get(space.id)))
    .map(mapPendingSpace);
  const recentObservations = observations
    .filter((observation) => {
      const space = spaceById.get(observation.green_space_id);
      return observation.provider_id === provider.id || space?.provider?.id === provider.id;
    })
    .slice(0, 12)
    .map((observation) => {
      const space = spaceById.get(observation.green_space_id);
      return {
        space: space?.name ?? "Espacio sin identificar",
        provider: provider.name,
        observation: observation.observation,
        date: observation.created_at,
      };
    });

  return {
    provider: provider.name,
    assigned: row.assigned,
    reviewed: row.reviewed,
    pending: row.pending,
    coverage: row.coverage,
    observedControls: row.observedControls,
    observations: row.observations,
    photos: row.photos,
    row,
    pendingSpaces,
    recentObservations,
    evidenceActivity: buildEvidenceActivity(assignedSpaces, month),
    reviewCadence: buildReviewCadence(assignedSpaces
      .map((space) => recordsBySpace.get(space.id))
      .filter((record): record is ControlRecord => Boolean(record))),
  };
}

function hasReviewedRecord(record?: ControlRecord) {
  return Boolean(record && [record.control_1, record.control_2, record.control_3].some(Boolean));
}

function mapPendingSpace(space: SpaceRecord) {
  return {
    name: space.name,
    type: spaceTypeLabel(space.type),
    address: space.address || "Sin direccion cargada",
    provider: space.provider?.name ?? "Sin cooperativa",
    neighborhood: space.neighborhood || "Sin barrio",
    section: space.section_code ?? "Sin seccion",
  };
}

const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  plaza: "Plaza",
  espacio_verde: "Espacio verde",
  platabanda: "Platabanda",
};

function spaceTypeLabel(type?: SpaceType | null) {
  return type ? SPACE_TYPE_LABELS[type] ?? String(type) : "Tipo sin definir";
}

function countSpacesByType(spaces: SpaceRecord[]) {
  const counts = new Map<string, number>();
  for (const space of spaces) {
    const label = spaceTypeLabel(space.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function controlDates(record: ControlRecord) {
  return [record.control_1_date, record.control_2_date, record.control_3_date].filter((date): date is string => Boolean(date));
}

function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function weekdayName(date: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function rankDays(dates: string[], limit: number) {
  const perDay = new Map<string, number>();
  for (const date of dates) perDay.set(date, (perDay.get(date) ?? 0) + 1);
  const perWeekday = new Map<string, number>();
  for (const [date, total] of perDay) perWeekday.set(weekdayName(date), (perWeekday.get(weekdayName(date)) ?? 0) + total);
  const sorted = Array.from(perDay.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return {
    activeDays: perDay.size,
    topDays: sorted.slice(0, limit).map(([date, total]) => ({ date, label: formatDay(date), total })),
    byWeekday: Array.from(perWeekday.entries()).sort((left, right) => right[1] - left[1]).map(([weekday, total]) => ({ weekday, total })),
  };
}

function buildEvidenceActivity(spaces: SpaceRecord[], month: string) {
  const monthDates = spaces.flatMap((space) => space.photos.map((photo) => photo.created_at.slice(0, 10)).filter((date) => date.startsWith(month)));
  const perMonth = new Map<string, number>();
  for (const space of spaces) {
    for (const photo of space.photos) {
      const key = photo.created_at.slice(0, 7);
      perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    }
  }
  return {
    ...rankDays(monthDates, 8),
    totalInMonth: monthDates.length,
    historyByMonth: Array.from(perMonth.entries())
      .sort((left, right) => right[0].localeCompare(left[0]))
      .slice(0, 12)
      .map(([period, total]) => ({ period, label: formatMonth(period), total })),
  };
}

function buildReviewCadence(records: ControlRecord[]) {
  const allDates = records.flatMap(controlDates);
  const gaps: number[] = [];
  for (const record of records) {
    const ordered = Array.from(new Set(controlDates(record))).sort();
    for (let index = 1; index < ordered.length; index += 1) gaps.push(dayDifference(ordered[index - 1], ordered[index]));
  }
  const sortedDates = allDates.slice().sort();
  const roundCounts = {
    control1: records.filter((record) => record.control_1_date).length,
    control2: records.filter((record) => record.control_2_date).length,
    control3: records.filter((record) => record.control_3_date).length,
  };
  return {
    ...rankDays(allDates, 8),
    datedVisits: allDates.length,
    undatedControls: records.filter((record) => [record.control_1, record.control_2, record.control_3].some(Boolean) && !controlDates(record).length).length,
    spacesWithMultipleVisits: records.filter((record) => new Set(controlDates(record)).size > 1).length,
    averageDaysBetweenVisits: gaps.length ? Math.round((gaps.reduce((total, gap) => total + gap, 0) / gaps.length) * 10) / 10 : null,
    firstVisit: sortedDates[0] ?? null,
    lastVisit: sortedDates[sortedDates.length - 1] ?? null,
    visitsByRound: roundCounts,
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function askOpenRouter({
  apiKey,
  message,
  history,
  context,
  reportMode = false,
}: {
  apiKey: string;
  message: string;
  history: ChatHistoryItem[];
  context: ReturnType<typeof buildAssistantContext>;
  reportMode?: boolean;
}) {
  const systemPrompt = [
    "Sos Migue, el asistente de Applaza para gestion municipal de espacios verdes, un servicio de la Direccion de Inteligencia Artificial de la Municipalidad de San Miguel de Tucuman. Los informes que generas se emiten a nombre de la Direccion de Inteligencia Artificial. Si el usuario te llama Migue, responde naturalmente a ese nombre.",
    "Responde en espanol claro, profesional y breve.",
    "Interpreta lenguaje coloquial del usuario y traducilo a consultas operativas, por ejemplo: pasame lo del mes, que onda las ubicaciones, quien viene flojo, hay muchas notas.",
    "Usa solo los datos incluidos en el contexto. Si falta un dato, aclaralo. Si el contexto incluye focusedProvider, prioriza ese bloque y no resumas como listado completo si faltan items.",
    "mentionedSpaces trae el detalle de los espacios nombrados en la consulta: tipo (Plaza, Espacio verde o Platabanda), direccion, barrio, seccion, cooperativa, si esta ubicado y sus fechas de control. Respondé el tipo y la direccion solo desde ahi. Si el espacio no figura en mentionedSpaces, decí que no lo encontraste en los datos del periodo en lugar de suponerlo.",
    "evidenceActivity describe la produccion de evidencias: topDays son los dias con mas fotos cargadas, byWeekday el acumulado por dia de semana e historyByMonth la carga de los ultimos meses. reviewCadence describe la frecuencia real de revisiones: datedVisits son los controles con fecha, averageDaysBetweenVisits el promedio de dias entre visitas al mismo espacio, firstVisit y lastVisit los extremos del periodo, visitsByRound cuantos controles se registraron en cada vuelta y undatedControls los controles cargados sin fecha. Usalos cuando pregunten por produccion, dias fuertes o cada cuanto se revisa.",
    reportMode
      ? "Estas redactando recomendaciones para un PDF de auditoria. No uses Markdown, asteriscos, tablas ni titulos. Escribi 3 a 5 recomendaciones operativas en frases limpias, considerando los dias de mayor produccion de evidencias y la frecuencia de revisiones del periodo. No saludes ni menciones que adjuntas un PDF."
      : "Cuando respondas en el chat podes usar Markdown simple para mejorar lectura: **negrita**, titulos cortos con # y listas. No uses tablas Markdown.",
    "No inventes nombres de cooperativas, cantidades, fechas ni evidencias.",
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Applaza",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      temperature: 0.2,
      max_completion_tokens: 900,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        {
          role: "user",
          content: `Consulta: ${message}\n\nContexto operativo disponible:\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("OpenRouter response error:", details);
    return buildLocalAnswer(message, context);
  }

  const payload = await response.json();
  return extractChatCompletionText(payload) || buildLocalAnswer(message, context);
}

function extractChatCompletionText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choices = "choices" in payload && Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) return "";
  const message = firstChoice.message;
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  return typeof message.content === "string" ? message.content : "";
}

function detectRequestedMonth(message: string) {
  const explicit = message.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (explicit) return explicit[0];

  const lower = message.toLocaleLowerCase("es");
  const now = new Date();
  if (lower.includes("ultimo mes") || lower.includes("mes pasado")) {
    now.setMonth(now.getMonth() - 1);
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`));
}
