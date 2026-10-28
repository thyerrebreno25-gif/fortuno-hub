"use client";

export type PdfTextLine = {
  page: number;
  y: number;
  text: string;
  parts: Array<{ x: number; text: string }>;
};

export async function extractPdfTextLines(file: File, password?: string, maxPages = Infinity): Promise<PdfTextLine[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  let pdf;
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      password: password || undefined,
    });
    pdf = await loadingTask.promise;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("O PDF é protegido. Informe a senha correta para continuar.");
    }
    throw error;
  }

  if (pdf.numPages > maxPages) { await loadingTask.destroy(); throw new Error(`O PDF ultrapassa o limite de ${maxPages} páginas.`); }
  const lines: PdfTextLine[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const grouped = new Map<number, Array<{ x: number; text: string }>>();

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      const row = grouped.get(y) ?? [];
      row.push({ x, text: item.str.trim() });
      grouped.set(y, row);
    }

    [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([y, row]) => {
        const parts = row.sort((a, b) => a.x - b.x);
        const text = parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
        if (text) lines.push({ page: pageNumber, y, text, parts });
      });
  }
  await loadingTask.destroy();
  return lines;
}

export async function extractPdfLines(file: File, password?: string): Promise<string[]> {
  return (await extractPdfTextLines(file, password)).map((line) => line.text);
}
