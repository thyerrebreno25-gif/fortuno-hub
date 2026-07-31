"use client";

export async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;

  const lines: string[] = [];
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
      .forEach(([, row]) => {
        const text = row.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
      });
  }
  return lines;
}
