import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import type { PdfExtractOptions, PdfExtractResult } from "./dc-pdf-types.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

/**
 * Extrae texto estructurado, metadatos y hash SHA-256 de un archivo PDF local.
 */
export async function extractPdf(options: PdfExtractOptions): Promise<PdfExtractResult> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = path.isAbsolute(options.path) ? options.path : path.resolve(cwd, options.path);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Archivo PDF no encontrado: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`La ruta no es un archivo regular: ${resolvedPath}`);
  }

  const dataBuffer = fs.readFileSync(resolvedPath);
  const sha256 = crypto.createHash("sha256").update(dataBuffer).digest("hex");

  const parser = new PDFParse({ data: dataBuffer });
  let rawText = "";
  let pagesCount = 1;

  try {
    const textResult = await parser.getText();
    rawText = String(textResult?.text ?? "").trim();
    if (typeof (textResult as any)?.total === "number") {
      pagesCount = (textResult as any).total;
    }
  } finally {
    if (typeof (parser as any).destroy === "function") {
      await (parser as any).destroy();
    }
  }

  const limit = options.textCharsLimit ?? 50000;
  const truncated = rawText.length > limit;
  const safeText = truncated ? rawText.slice(0, limit) : rawText;

  return {
    path: resolvedPath,
    sha256,
    byteSize: stat.size,
    metadata: {
      pagesCount,
    },
    text: redactSecrets(safeText.trim()),
    textCharsCount: rawText.length,
    truncated,
  };
}
