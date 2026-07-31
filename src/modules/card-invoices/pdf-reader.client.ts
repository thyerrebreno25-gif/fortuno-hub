"use client";

export type PdfTextLine = { page: number; y: number; x?: number; text: string; parts?: Array<{ x: number; text: string }> };

export async function extractPdfLines(file: File, password?: string): Promise<PdfTextLine[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Configuração obrigatória do worker do PDF.js no navegador/Next.js.
  // A versão anterior usava disableWorker, mas o PDF.js ainda exigia workerSrc.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password: password || undefined,
  }).promise;

  const lines: PdfTextLine[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map<number, Array<{ x: number; text: string }>>();

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);
      const row = rows.get(y) ?? [];
      row.push({ x, text: item.str.trim() });
      rows.set(y, row);
    }

    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([y, parts]) => {
        const text = parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
        if (text) {
          const orderedParts = parts.sort((a, b) => a.x - b.x);
          lines.push({ page: pageNumber, y, x: orderedParts[0]?.x, text, parts: orderedParts });
        }
      });
  }
  return lines;
}
