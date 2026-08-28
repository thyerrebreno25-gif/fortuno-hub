"use client";

type OcrWord = {
  text: string;
  x: number;
  y: number;
};

function clean(value: string) {
  return String(value ?? "")
    .replace(/[|]/g, " ")
    .replace(/[—–−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function groupWords(words: OcrWord[]) {
  const ordered = words
    .filter((word) => clean(word.text))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const rows: Array<{ y: number; words: OcrWord[] }> = [];

  for (const word of ordered) {
    const current = rows.at(-1);
    if (current && Math.abs(current.y - word.y) <= 0.006) {
      current.words.push(word);
      current.y = current.words.reduce((sum, item) => sum + item.y, 0) / current.words.length;
    } else {
      rows.push({ y: word.y, words: [word] });
    }
  }

  return rows
    .map((row) => row.words
      .sort((left, right) => left.x - right.x)
      .map((word) => clean(word.text))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

export async function extractCaixaPdfOcrLines(file: File, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      password: password || undefined,
    }).promise;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("O PDF é protegido. Informe a senha correta para continuar.");
    }
    throw error;
  }

  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("por");
  const lines: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 3 });
      const rendered = document.createElement("canvas");
      rendered.width = Math.ceil(viewport.width);
      rendered.height = Math.ceil(viewport.height);
      const renderedContext = rendered.getContext("2d", { willReadFrequently: true });
      if (!renderedContext) throw new Error("Não foi possível preparar o PDF da Caixa para leitura.");
      renderedContext.fillStyle = "#ffffff";
      renderedContext.fillRect(0, 0, rendered.width, rendered.height);
      await page.render({ canvas: rendered, canvasContext: renderedContext, viewport }).promise;

      const cropped = document.createElement("canvas");
      cropped.width = rendered.width;
      cropped.height = Math.ceil(rendered.height * 0.68);
      const context = cropped.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Não foi possível preparar o extrato da Caixa para leitura.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, cropped.width, cropped.height);
      context.filter = "grayscale(1) contrast(1.25)";
      context.drawImage(rendered, 0, 0);
      context.filter = "none";
      rendered.width = 1;
      rendered.height = 1;

      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      const result = await worker.recognize(
        cropped,
        { rotateAuto: true },
        { text: true, blocks: true },
      );
      const words = (result.data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.flatMap((line) =>
            line.words.map((word) => ({
              text: word.text,
              x: word.bbox.x0 / cropped.width,
              y: ((word.bbox.y0 + word.bbox.y1) / 2) / cropped.height,
            })),
          ),
        ),
      );
      const pageLines = groupWords(words);
      lines.push(...(pageLines.length
        ? pageLines
        : result.data.text.split(/\r?\n/).map(clean).filter(Boolean)));
      cropped.width = 1;
      cropped.height = 1;
    }
  } finally {
    await worker.terminate();
  }

  if (!lines.length) {
    throw new Error("O OCR abriu o PDF da Caixa, mas não encontrou texto legível.");
  }
  return lines;
}
