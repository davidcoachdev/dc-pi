/**
 * Pure parser for `uiautomator dump` XML (S3).
 *
 * No third-party XML dependency: uiautomator emits a flat list of `<node>`
 * tags and the attributes we need are always quoted.
 */

export interface DcMobileBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DcMobilePoint {
  x: number;
  y: number;
}

export interface DcMobileElement {
  id: string;
  text: string;
  resourceId: string;
  bounds: DcMobileBounds;
  center: DcMobilePoint;
  clickable: boolean;
}

const BOUNDS_PATTERN = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Extracts `<node ...>` tags while respecting quoted attribute values, so text
 * containing `>` does not truncate the tag.
 */
function extractNodeTags(xml: string): string[] {
  const tags: string[] = [];
  const lower = xml.toLowerCase();
  let cursor = 0;

  while (cursor < xml.length) {
    const start = lower.indexOf("<node", cursor);
    if (start === -1) break;

    const boundary = xml[start + "<node".length];
    if (boundary && !/[\s/>]/.test(boundary)) {
      cursor = start + "<node".length;
      continue;
    }

    let index = start + "<node".length;
    let quote: string | null = null;

    for (; index < xml.length; index++) {
      const char = xml[index];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }

    if (index >= xml.length) break;
    tags.push(xml.slice(start, index + 1));
    cursor = index + 1;
  }

  return tags;
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }

  return attributes;
}

function parseBounds(value: string | undefined): DcMobileBounds | undefined {
  if (!value) return undefined;
  const match = BOUNDS_PATTERN.exec(value.trim());
  if (!match) return undefined;

  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);

  if (![x1, y1, x2, y2].every((coordinate) => Number.isFinite(coordinate))) {
    return undefined;
  }

  return { x1, y1, x2, y2 };
}

/**
 * Parses a uiautomator hierarchy into the semantic element map consumed by the
 * `dc_mobile_*` tools. Numbering follows document order: `@e1`…`@eN`.
 *
 * Nodes without text, without content-desc and without `clickable="true"` are
 * omitted. Nodes with malformed bounds are skipped.
 */
export function parseUiHierarchy(xml: string): DcMobileElement[] {
  if (typeof xml !== "string" || xml.length === 0) return [];

  const elements: DcMobileElement[] = [];

  for (const tag of extractNodeTags(xml)) {
    const attributes = readAttributes(tag);

    const text = (attributes["text"] ?? "").trim();
    const contentDescription = (attributes["content-desc"] ?? "").trim();
    const clickable = (attributes["clickable"] ?? "").trim().toLowerCase() === "true";

    if (!text && !contentDescription && !clickable) continue;

    const bounds = parseBounds(attributes["bounds"]);
    if (!bounds) continue;

    elements.push({
      id: `@e${elements.length + 1}`,
      text: text || contentDescription,
      resourceId: (attributes["resource-id"] ?? "").trim(),
      bounds,
      center: {
        x: Math.round((bounds.x1 + bounds.x2) / 2),
        y: Math.round((bounds.y1 + bounds.y2) / 2),
      },
      clickable,
    });
  }

  return elements;
}

/** Formats one semantic line per element (S3). */
export function formatElementMap(elements: DcMobileElement[]): string {
  if (elements.length === 0) {
    return "No se encontraron elementos accionables.";
  }

  return elements
    .map((element) => {
      const text = element.text ? JSON.stringify(element.text) : '""';
      const resourceId = element.resourceId || "-";
      const { x1, y1, x2, y2 } = element.bounds;
      return `${element.id} ${text} resource-id=${resourceId} bounds=[${x1},${y1}][${x2},${y2}] center=(${element.center.x}, ${element.center.y}) clickable=${element.clickable}`;
    })
    .join("\n");
}
