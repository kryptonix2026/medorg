import { storage } from "../storage";
// @ts-ignore
import pdfParse from "pdf-parse/lib/pdf-parse.js";

interface CacheEntry {
  size: number;
  text: string;
}

// In-memory cache for extracted PDF text (never written to disk or logs)
const pdfTextCache = new Map<string, CacheEntry>();

export function invalidatePdfCache(recordId: string): void {
  pdfTextCache.delete(recordId);
}

export function clearPdfCache(): void {
  pdfTextCache.clear();
}

export interface ExtractedPdfResult {
  recordId: string;
  title: string;
  extractable: boolean;
  text: string;
  reason?: string;
}

/**
 * Clean extracted PDF text: collapse whitespace, strip common header/footer artifacts
 */
export function cleanPdfText(rawText: string): string {
  if (!rawText) return "";

  let text = rawText
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // non-printable ASCII
    .replace(/[ \t]+/g, " ");

  // Remove common page numbering artifacts
  text = text.replace(/Page\s+\d+\s+of\s+\d+/gi, "");
  text = text.replace(/Confidential Medical Record[^\n]*/gi, "");

  // Collapse multiple blank lines
  text = text.replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return text;
}

/**
 * Extract raw text from PDF buffer using pdfjs-dist legacy with fallback to pdf-parse
 */
async function extractRawTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    // Primary: pdfjs-dist legacy build (handles modern Flate / Object streams)
    // @ts-ignore
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const uint8 = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8, disableFontFace: true });
    const doc = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const strings = textContent.items.map((item: any) => item.str || "");
      fullText += strings.join(" ") + "\n";
    }
    if (fullText.trim().length > 0) return fullText;
  } catch (err) {
    // Fall back to pdf-parse
  }

  try {
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  } catch {
    return "";
  }
}

/**
 * Extract text from an authorized record's PDF file safely across storage drivers
 */
export async function extractRecordPdfText(record: {
  id: string;
  title: string;
  filePath: string;
}): Promise<ExtractedPdfResult> {
  const { id, title, filePath } = record;

  if (!filePath) {
    return {
      recordId: id,
      title,
      extractable: false,
      text: "",
      reason: "Document file path is missing",
    };
  }

  try {
    const fileExists = await storage.exists(filePath);
    if (!fileExists) {
      return {
        recordId: id,
        title,
        extractable: false,
        text: "",
        reason: "Document file not found in storage",
      };
    }

    const buffer = await storage.getBuffer(filePath);
    if (buffer.length === 0) {
      return {
        recordId: id,
        title,
        extractable: false,
        text: "",
        reason: "Document file is empty (0 bytes)",
      };
    }

    // Check in-memory cache
    const cached = pdfTextCache.get(id);
    if (cached && cached.size === buffer.length) {
      return {
        recordId: id,
        title,
        extractable: cached.text.length >= 25,
        text: cached.text,
        reason: cached.text.length < 25 ? "No extractable text in PDF" : undefined,
      };
    }

    const rawText = await extractRawTextFromPdf(buffer);
    const cleaned = cleanPdfText(rawText || "");

    // Update in-memory cache
    pdfTextCache.set(id, {
      size: buffer.length,
      text: cleaned,
    });

    if (cleaned.length < 25) {
      return {
        recordId: id,
        title,
        extractable: false,
        text: "",
        reason: "No extractable text in PDF (scanned or image-only document)",
      };
    }

    return {
      recordId: id,
      title,
      extractable: true,
      text: cleaned,
    };
  } catch (err: any) {
    return {
      recordId: id,
      title,
      extractable: false,
      text: "",
      reason: `Failed to parse PDF: ${err.message || "Unknown error"}`,
    };
  }
}
