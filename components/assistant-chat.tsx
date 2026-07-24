"use client";

import Image from "next/image";
import { FormEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download, FileText, LoaderCircle, MapPin, Minimize2, Send, Sparkles, X } from "lucide-react";

type ChatRole = "assistant" | "user";
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  report?: AssistantReport | null;
};

type AssistantReport = {
  title: string;
  period: string;
  periodLabel: string;
  generatedAt: string;
  content: string;
  focusedProvider?: {
    provider: string;
    assigned: number;
    reviewed: number;
    pending: number;
    coverage: number;
    observedControls: number;
    observations: number;
    photos: number;
  } | null;
  summary?: {
    totalSpaces?: number;
    reviewedSpaces?: number;
    observations?: number;
    evidencePhotos?: number;
  };
  providerRows?: Array<{
    provider: string;
    assigned: number;
    reviewed: number;
    pending: number;
    coverage: number;
    observedControls: number;
    observations: number;
    photos: number;
  }>;
  pendingSpaces?: Array<{
    name: string;
    provider: string;
    neighborhood: string;
    section: string;
  }>;
  recentObservations?: Array<{
    space: string;
    provider: string;
    observation: string;
    date: string;
  }>;
};

const suggestedMessages = [
  "Dame un resumen del ultimo mes",
  "Que cooperativas tienen pendientes?",
  "Cuantas evidencias se cargaron este mes?",
  "Genera un informe para auditoria",
];

const quickActions = [
  { label: "Informe mensual", icon: FileText, prompt: "Necesito un informe de auditoria del ultimo mes con espacios asignados, controlados, pendientes, observaciones y evidencias." },
  { label: "Pendientes", icon: BarChart3, prompt: "Mostrame los pendientes del periodo actual y las cooperativas con menor cobertura." },
  { label: "Evidencias", icon: Sparkles, prompt: "Resume las evidencias cargadas durante el ultimo mes y marca si faltan fotos." },
  { label: "Ubicaciones", icon: MapPin, prompt: "Dame un resumen de espacios con ubicacion y pendientes de ubicar." },
];

const initialMessage: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "Hola, soy Migue. Puedo ayudarte a consultar datos operativos, preparar informes de auditoria y resumir evidencias, pendientes u observaciones.",
};

export function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [bubblePosition, setBubblePosition] = useState<{ x: number; y: number }>();
  const [bubbleSnapping, setBubbleSnapping] = useState(false);
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean }>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    try { const saved = localStorage.getItem("migue-bubble-position"); if (saved) setBubblePosition(snapToEdge(clampBubble(JSON.parse(saved)), 120)); } catch { /* posición guardada inválida */ }
  }, []);

  function clampBubble(position: { x: number; y: number }) {
    return { x: Math.min(Math.max(position.x, 8), window.innerWidth - 128), y: Math.min(Math.max(position.y, 8), window.innerHeight - 60) };
  }

  function snapToEdge(position: { x: number; y: number }, width: number) {
    const margin = 12;
    const snappedX = position.x + width / 2 < window.innerWidth / 2 ? margin : window.innerWidth - width - margin;
    return { x: snappedX, y: Math.min(Math.max(position.y, 8), window.innerHeight - 60) };
  }

  function onBubblePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: rect.left, originY: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onBubblePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX; const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 6) return;
    drag.moved = true;
    setBubblePosition(clampBubble({ x: drag.originX + deltaX, y: drag.originY + deltaY }));
  }

  function onBubblePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag?.moved) return;
    justDragged.current = true;
    const bounds = event.currentTarget.getBoundingClientRect();
    const snapped = snapToEdge({ x: bounds.left, y: bounds.top }, bounds.width);
    setBubblePosition(snapped);
    setBubbleSnapping(true);
    window.setTimeout(() => setBubbleSnapping(false), 240);
    try { localStorage.setItem("migue-bubble-position", JSON.stringify(snapped)); } catch { /* almacenamiento no disponible */ }
  }

  function onBubbleClick() {
    if (justDragged.current) { justDragged.current = false; return; }
    openChat();
  }

  const lastUserQuestion = useMemo(() => [...messages].reverse().find((message) => message.role === "user")?.content, [messages]);

  function openChat(prompt?: string) {
    setOpen(true);
    setMinimized(false);
    window.setTimeout(() => inputRef.current?.focus(), 80);
    if (prompt) void sendPrompt(prompt);
  }

  async function sendPrompt(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
        }),
      });
      const payload = await response.json();
      const answer = typeof payload.answer === "string" ? payload.answer : "No pude generar una respuesta en este momento.";
      const report = isAssistantReport(payload.report) ? payload.report : null;
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: answer, report }]);
    } catch {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "No pude conectar con el asistente. Revisa la configuracion de la API o intenta nuevamente.",
      }]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendPrompt(input);
  }

  return <>
    {!open && <button className={`assistant-launcher ${bubbleSnapping ? "snapping" : ""}`} style={bubblePosition ? { left: bubblePosition.x, top: bubblePosition.y, right: "auto", bottom: "auto" } : undefined} onPointerDown={onBubblePointerDown} onPointerMove={onBubblePointerMove} onPointerUp={onBubblePointerUp} onPointerCancel={() => { dragState.current = null; }} onClick={onBubbleClick} aria-label="Abrir Migue">
      <Image src="/migue-avatar.png" alt="" width={42} height={42} />
      <span>Migue</span>
    </button>}

    {open && <section className={`assistant-chat ${minimized ? "minimized" : ""}`} aria-label="Migue">
      <header className="assistant-head">
        <div className="assistant-avatar"><Image src="/migue-avatar.png" alt="" width={44} height={44} /></div>
        <div>
          <strong>Migue</strong>
          <span>{loading ? "Analizando datos..." : "Informes y datos operativos"}</span>
        </div>
        <button onClick={() => setMinimized((value) => !value)} aria-label={minimized ? "Expandir chat" : "Minimizar chat"}><Minimize2 size={16} /></button>
        <button onClick={() => setOpen(false)} aria-label="Cerrar chat"><X size={16} /></button>
      </header>

      {!minimized && <>
        <div className="assistant-actions">
          {quickActions.map(({ label, icon: Icon, prompt }) => <button key={label} onClick={() => openChat(prompt)} disabled={loading}>
            <Icon size={15} />
            <span>{label}</span>
          </button>)}
        </div>

        <div className="assistant-messages">
          {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}>
            <MessageContent content={message.content} />
            {message.report && <button className="assistant-download" onClick={() => downloadReportPdf(message.report!)} type="button">
              <Download size={14} />
              <span>Descargar PDF</span>
            </button>}
          </article>)}
          {loading && <article className="assistant-message assistant typing">
            <LoaderCircle className="spin" size={15} />
            <p>Escribiendo respuesta...</p>
          </article>}
        </div>

        <div className="assistant-suggestions">
          {suggestedMessages.map((suggestion) => <button key={suggestion} onClick={() => openChat(suggestion)} disabled={loading}>
            {suggestion}
          </button>)}
        </div>

        <form className="assistant-form" onSubmit={onSubmit}>
          <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={lastUserQuestion ? "Pedir otro dato o informe..." : "Pregunta por informes, auditoria o espacios..."} />
          <button type="submit" disabled={loading || !input.trim()} aria-label="Enviar mensaje">
            {loading ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
          </button>
        </form>
      </>}
    </section>}
  </>;
}

function MessageContent({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;

  function flushList() {
    if (!listType || !listItems.length) return;
    const ListTag = listType;
    blocks.push(<ListTag key={`list-${blocks.length}`}>{listItems}</ListTag>);
    listItems = [];
    listType = null;
  }

  content.split(/\n+/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(<strong className="assistant-markdown-heading" key={`heading-${index}`}>{renderInlineMarkdown(heading[1])}</strong>);
      return;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(<li key={`item-${index}`}>{renderInlineMarkdown(bullet[1])}</li>);
      return;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(<li key={`item-${index}`}>{renderInlineMarkdown(numbered[1])}</li>);
      return;
    }

    flushList();
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(line)}</p>);
  });

  flushList();
  return <>{blocks.length ? blocks : <p>{content}</p>}</>;
}

function renderInlineMarkdown(value: string) {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) nodes.push(cleanInlineMarkdown(value.slice(lastIndex, match.index)));
    nodes.push(<strong key={`bold-${match.index}`}>{cleanInlineMarkdown(match[1])}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) nodes.push(cleanInlineMarkdown(value.slice(lastIndex)));
  return nodes.length ? nodes : cleanInlineMarkdown(value);
}

function cleanInlineMarkdown(value: string) {
  return value.replace(/\*\*/g, "").replace(/^#+\s*/, "");
}

function isAssistantReport(value: unknown): value is AssistantReport {
  if (!value || typeof value !== "object") return false;
  return "title" in value && typeof value.title === "string"
    && "period" in value && typeof value.period === "string"
    && "periodLabel" in value && typeof value.periodLabel === "string"
    && "generatedAt" in value && typeof value.generatedAt === "string"
    && "content" in value && typeof value.content === "string";
}

function downloadReportPdf(report: AssistantReport) {
  const width = 842;
  const height = 595;
  const margin = 36;
  const lineHeight = 12;
  const pages: string[][] = [];
  let content: string[] = [];
  let y = 0;
  let page = 0;

  function startPage() {
    page += 1;
    content = [];
    pages.push(content);
    y = height - margin;
    addRect(content, 0, height - 78, width, 78, "0.02 0.25 0.55");
    addText(content, "MUNICIPALIDAD DE SAN MIGUEL DE TUCUMAN", margin, height - 22, 8, true, "1 1 1");
    addText(content, "DIRECCION DE INTELIGENCIA ARTIFICIAL", margin, height - 34, 8, true, "0.86 0.93 1");
    addText(content, clean(report.title), margin, height - 54, 16, true, "1 1 1");
    addText(content, `Periodo: ${report.periodLabel} | Pagina ${page}`, margin, height - 69, 9, false, "0.86 0.93 1");
    y = height - 102;
  }

  function ensureSpace(required: number) {
    if (y - required < margin) startPage();
  }

  startPage();
  if (report.focusedProvider) {
    addInfoRow([
      ["Cooperativa", report.focusedProvider.provider],
      ["Periodo", report.periodLabel],
      ["Asignados", String(report.focusedProvider.assigned)],
      ["Revisados", String(report.focusedProvider.reviewed)],
    ]);
    addInfoRow([
      ["Pendientes", String(report.focusedProvider.pending)],
      ["Cobertura", `${report.focusedProvider.coverage}%`],
      ["Observaciones", String(report.focusedProvider.observations)],
      ["Evidencias", String(report.focusedProvider.photos)],
    ]);
  } else {
    addInfoRow([
      ["Fecha de emision", formatDate(report.generatedAt)],
      ["Periodo", report.periodLabel],
      ["Espacios", String(report.summary?.totalSpaces ?? "-")],
      ["Controlados", String(report.summary?.reviewedSpaces ?? "-")],
    ]);
    addInfoRow([
      ["Observaciones", String(report.summary?.observations ?? "-")],
      ["Evidencias", String(report.summary?.evidencePhotos ?? "-")],
      ["Sistema", "Applaza"],
      ["Emite", "Direccion de Inteligencia Artificial"],
    ]);
  }
  y -= 4;

  if (report.providerRows?.length) {
    addSectionTitle("Detalle por cooperativa");
    addProviderTable(report.providerRows);
    y -= 8;
  }

  if (report.pendingSpaces?.length) {
    addSectionTitle(report.focusedProvider ? `Espacios pendientes - ${report.focusedProvider.provider}` : "Espacios pendientes");
    addPendingSpacesTable(report.pendingSpaces);
    y -= 8;
  }

  if (report.recentObservations?.length) {
    addSectionTitle("Observaciones recientes");
    addObservationsTable(report.recentObservations);
    y -= 8;
  }

  addSectionTitle("Resumen ejecutivo");
  [
    `El periodo ${report.periodLabel} registra ${report.summary?.totalSpaces ?? "-"} espacios verdes relevados, con ${report.summary?.reviewedSpaces ?? "-"} espacios controlados y ${report.summary?.evidencePhotos ?? "-"} evidencias fotograficas asociadas.`,
    `Se informan ${report.summary?.observations ?? "-"} observaciones operativas para seguimiento de auditoria y supervision.`,
  ].forEach((paragraph) => addParagraph(paragraph));

  addSectionTitle("Recomendaciones operativas");
  addBulletList(buildRecommendations(report));

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  const pageRefs: string[] = [];

  pages.forEach((pageContent) => {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    const stream = pageContent.join("\n");
    pageRefs.push(`${pageObject} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(report.title)}.pdf`;
  link.click();
  URL.revokeObjectURL(url);

  function addInfoRow(items: Array<[string, string]>) {
    ensureSpace(46);
    const boxWidth = (width - margin * 2 - 18) / 4;
    items.forEach(([label, value], index) => {
      const x = margin + index * (boxWidth + 6);
      addRect(content, x, y - 36, boxWidth, 38, "0.96 0.98 1");
      addText(content, clean(label), x + 8, y - 13, 7, false, "0.37 0.45 0.55");
      addText(content, clean(value), x + 8, y - 27, 9, true, "0.06 0.15 0.28");
    });
    y -= 48;
  }

  function addSectionTitle(title: string) {
    ensureSpace(28);
    addText(content, clean(title), margin, y, 12, true, "0.06 0.15 0.28");
    y -= 17;
  }

  function addParagraph(paragraph: string) {
    const lines = wrapText(paragraph, 126);
    ensureSpace(lines.length * lineHeight + 16);
    lines.forEach((line, index) => {
      addText(content, clean(line), margin, y - index * lineHeight, 10, false, "0.08 0.15 0.26");
    });
    y -= lines.length * lineHeight + 10;
  }

  function addBulletList(items: string[]) {
    items.forEach((item) => {
      const lines = wrapText(item, 118);
      ensureSpace(lines.length * lineHeight + 10);
      addText(content, "-", margin, y, 10, true, "0.06 0.15 0.28");
      lines.forEach((line, index) => {
        addText(content, clean(line), margin + 14, y - index * lineHeight, 10, false, "0.08 0.15 0.26");
      });
      y -= lines.length * lineHeight + 8;
    });
  }

  function addProviderTable(rows: NonNullable<AssistantReport["providerRows"]>) {
    const visibleRows = rows.slice(0, 18);
    const columns = [
      { label: "Cooperativa", x: margin + 8, width: 258 },
      { label: "Asign.", x: margin + 294, width: 46 },
      { label: "Control.", x: margin + 350, width: 52 },
      { label: "Pend.", x: margin + 414, width: 45 },
      { label: "Cob.", x: margin + 470, width: 44 },
      { label: "Obs.", x: margin + 528, width: 45 },
      { label: "Fotos", x: margin + 585, width: 46 },
    ];
    const rowHeight = 19;
    ensureSpace(visibleRows.length * rowHeight + 36);
    addRect(content, margin, y - 17, width - margin * 2, 20, "0.08 0.18 0.32");
    columns.forEach((column) => addText(content, column.label, column.x, y - 10, 7, true, "1 1 1"));
    y -= 25;
    visibleRows.forEach((row, index) => {
      if (index % 2 === 0) addRect(content, margin, y - 13, width - margin * 2, 18, "0.96 0.98 1");
      addText(content, truncate(row.provider, 46), margin + 8, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, String(row.assigned), margin + 302, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, String(row.reviewed), margin + 360, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, String(row.pending), margin + 424, y - 7, 8, true, row.pending > 0 ? "0.72 0.11 0.11" : "0.09 0.50 0.24");
      addText(content, `${row.coverage}%`, margin + 478, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, String(row.observations + row.observedControls), margin + 538, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, String(row.photos), margin + 594, y - 7, 8, false, "0.06 0.15 0.28");
      y -= rowHeight;
    });
    if (rows.length > visibleRows.length) {
      addText(content, `Se muestran ${visibleRows.length} de ${rows.length} cooperativas.`, margin + 8, y - 6, 8, false, "0.37 0.45 0.55");
      y -= 15;
    }
  }

  function addPendingSpacesTable(rows: NonNullable<AssistantReport["pendingSpaces"]>) {
    const visibleRows = rows.slice(0, 18);
    const rowHeight = 19;
    ensureSpace(visibleRows.length * rowHeight + 36);
    addRect(content, margin, y - 17, width - margin * 2, 20, "0.08 0.18 0.32");
    addText(content, "Espacio verde", margin + 8, y - 10, 7, true, "1 1 1");
    addText(content, "Cooperativa", margin + 276, y - 10, 7, true, "1 1 1");
    addText(content, "Barrio", margin + 492, y - 10, 7, true, "1 1 1");
    addText(content, "Seccion", margin + 650, y - 10, 7, true, "1 1 1");
    y -= 25;
    visibleRows.forEach((row, index) => {
      ensureSpace(rowHeight + 8);
      if (index % 2 === 0) addRect(content, margin, y - 13, width - margin * 2, 18, "0.96 0.98 1");
      addText(content, truncate(row.name, 42), margin + 8, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, truncate(row.provider, 34), margin + 276, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, truncate(row.neighborhood, 24), margin + 492, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, truncate(row.section, 18), margin + 650, y - 7, 8, false, "0.06 0.15 0.28");
      y -= rowHeight;
    });
    if (rows.length > visibleRows.length) {
      addText(content, `Se muestran ${visibleRows.length} de ${rows.length} espacios pendientes.`, margin + 8, y - 6, 8, false, "0.37 0.45 0.55");
      y -= 15;
    }
  }

  function addObservationsTable(rows: NonNullable<AssistantReport["recentObservations"]>) {
    const visibleRows = rows.slice(0, 12);
    const rowHeight = 30;
    ensureSpace(visibleRows.length * rowHeight + 36);
    addRect(content, margin, y - 17, width - margin * 2, 20, "0.08 0.18 0.32");
    addText(content, "Espacio", margin + 8, y - 10, 7, true, "1 1 1");
    addText(content, "Cooperativa", margin + 208, y - 10, 7, true, "1 1 1");
    addText(content, "Observacion", margin + 390, y - 10, 7, true, "1 1 1");
    addText(content, "Fecha", margin + 706, y - 10, 7, true, "1 1 1");
    y -= 25;
    visibleRows.forEach((row, index) => {
      ensureSpace(rowHeight + 8);
      if (index % 2 === 0) addRect(content, margin, y - 24, width - margin * 2, 29, "0.96 0.98 1");
      addText(content, truncate(row.space, 30), margin + 8, y - 7, 8, false, "0.06 0.15 0.28");
      addText(content, truncate(row.provider, 28), margin + 208, y - 7, 8, false, "0.06 0.15 0.28");
      wrapText(row.observation, 52).slice(0, 2).forEach((line, lineIndex) => {
        addText(content, line, margin + 390, y - 7 - lineIndex * 10, 8, false, "0.06 0.15 0.28");
      });
      addText(content, formatDate(row.date), margin + 706, y - 7, 8, false, "0.06 0.15 0.28");
      y -= rowHeight;
    });
    if (rows.length > visibleRows.length) {
      addText(content, `Se muestran ${visibleRows.length} de ${rows.length} observaciones recientes.`, margin + 8, y - 6, 8, false, "0.37 0.45 0.55");
      y -= 15;
    }
  }

}

function addText(content: string[], text: string, x: number, y: number, size: number, bold = false, color = "0 0 0") {
  content.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(text)}) Tj ET`);
}

function addRect(content: string[], x: number, y: number, width: number, height: number, color: string) {
  content.push(`${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
}

function wrapText(value: string, maxLength: number) {
  const words = clean(stripMarkdown(value)).replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["Sin detalle."];
}

function clean(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\|/g, " ")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRecommendations(report: AssistantReport) {
  const generated = report.content
    .split(/\n+/)
    .map((line) => stripMarkdown(line).replace(/^\d+\.\s*/, "").trim())
    .filter((line) => line.length > 30 && /priorizar|revisar|validar|registrar|mejorar|implementar|coordinar|evaluar/i.test(line))
    .slice(0, 4);

  if (generated.length >= 3) return generated;

  const topPending = report.providerRows?.filter((row) => row.pending > 0).slice(0, 3).map((row) => row.provider).join(", ");
  return [
    topPending ? `Priorizar el seguimiento de cooperativas con mayor cantidad de pendientes: ${topPending}.` : "Mantener el seguimiento mensual de cobertura por cooperativa.",
    "Revisar espacios sin evidencia fotografica reciente antes del cierre del periodo.",
    "Validar observaciones cargadas por supervision y asociarlas a acciones correctivas concretas.",
    "Consolidar los registros de control para sostener trazabilidad mensual de auditoria.",
  ];
}

function pdfText(value: string) {
  return clean(value).replace(/[()\\]/g, "\\$&");
}

function slug(value: string) {
  return clean(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "informe-applaza";
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}.` : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}
