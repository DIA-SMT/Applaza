import type { jsPDF } from "jspdf";

type PdfBrandAssets = {
  logo: string;
  regular: string;
  semibold: string;
};

type PdfHeaderOptions = {
  title: string;
  subtitle: string;
  page: number;
  rightLabel?: string;
};

let assetsPromise: Promise<PdfBrandAssets> | undefined;

export async function createBrandedPdf() {
  const { jsPDF } = await import("jspdf");
  const assets = await loadBrandAssets();
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  doc.addFileToVFS("Poppins-Regular.ttf", assets.regular);
  doc.addFont("Poppins-Regular.ttf", "Poppins", "normal");
  doc.addFileToVFS("Poppins-SemiBold.ttf", assets.semibold);
  doc.addFont("Poppins-SemiBold.ttf", "Poppins", "semibold");
  doc.setFont("Poppins", "normal");

  return { doc, logo: assets.logo };
}

export function drawPdfHeader(
  doc: jsPDF,
  logo: string,
  { title, subtitle, page, rightLabel }: PdfHeaderOptions,
) {
  const width = doc.internal.pageSize.getWidth();

  doc.setFillColor(1, 84, 213);
  doc.rect(0, 0, width, 82, "F");

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(34, 14, 46, 46, 8, 8, "F");
  doc.addImage(logo, "PNG", 39, 19, 36, 36, undefined, "FAST");

  setPdfFont(doc, 8, true, "#ffffff");
  doc.text("MUNICIPALIDAD DE SAN MIGUEL DE TUCUMAN", 94, 25);
  setPdfFont(doc, 7, false, "#dceeff");
  doc.text("DIRECCION DE INTELIGENCIA ARTIFICIAL", 94, 37);
  setPdfFont(doc, 16, true, "#ffffff");
  doc.text(title, 94, 57);
  setPdfFont(doc, 8, false, "#dceeff");
  doc.text(subtitle, 94, 72);

  setPdfFont(doc, 7, false, "#dceeff");
  doc.text(`Pagina ${page}`, width - 35, 24, { align: "right" });
  if (rightLabel) doc.text(rightLabel, width - 35, 39, { align: "right" });
}

export function setPdfFont(
  doc: jsPDF,
  size: number,
  semibold = false,
  color = "#102747",
) {
  doc.setFont("Poppins", semibold ? "semibold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(color);
}

export function drawPdfInfoBox(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string | number,
) {
  doc.setFillColor(245, 249, 255);
  doc.roundedRect(x, y, width, 38, 4, 4, "F");
  setPdfFont(doc, 6.5, false, "#65758b");
  doc.text(label, x + 8, y + 12);
  setPdfFont(doc, 8.5, true);
  doc.text(fitPdfText(doc, String(value), width - 16), x + 8, y + 27);
}

export function fitPdfText(doc: jsPDF, value: string, width: number) {
  if (doc.getTextWidth(value) <= width) return value;
  let text = value;
  while (text.length > 1 && doc.getTextWidth(`${text}...`) > width) {
    text = text.slice(0, -1);
  }
  return `${text.trim()}...`;
}

export function downloadPdfFile(doc: jsPDF, filename: string) {
  const bytes = doc.output("arraybuffer");
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function loadBrandAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      fetchAsDataUrl("/logo-municipal.png", "image/png"),
      fetchAsBase64("/fonts/Poppins-Regular.ttf"),
      fetchAsBase64("/fonts/Poppins-SemiBold.ttf"),
    ]).then(([logo, regular, semibold]) => ({ logo, regular, semibold }));
  }
  return assetsPromise;
}

async function fetchAsDataUrl(path: string, mimeType: string) {
  return `data:${mimeType};base64,${await fetchAsBase64(path)}`;
}

async function fetchAsBase64(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`No se pudo cargar ${path}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }

  return btoa(chunks.join(""));
}
