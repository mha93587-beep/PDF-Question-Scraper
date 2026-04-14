import { setTimeout as delay } from "node:timers/promises";

const MARKER_BASE_URL = "https://www.datalab.to/api/v1";

type MarkerStartResponse = {
  request_id?: string;
  request_check_url?: string;
  success?: boolean;
  error?: string | null;
};

type MarkerResultResponse = {
  status?: string;
  output_format?: string;
  markdown?: string | null;
  html?: string | null;
  json?: unknown;
  success?: boolean | null;
  error?: string | null;
  page_count?: number | null;
  parse_quality_score?: number | null;
  runtime?: number | null;
};

export type MarkerConversionResult = {
  markdown: string;
  pageCount: number | null;
  parseQualityScore: number | null;
  runtime: number | null;
};

function getMarkerApiKey(): string {
  const apiKey = process.env.MARKER_API_KEY || process.env.DATALAB_API_KEY;
  if (!apiKey) {
    throw new Error("MARKER_API_KEY is not configured. Add it as a Replit secret to use Marker extraction.");
  }
  return apiKey;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Marker API returned a non-JSON response (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data ? String((data as { error?: unknown }).error) : text;
    throw new Error(`Marker API request failed (${response.status}): ${message}`);
  }

  return data as T;
}

export async function checkMarkerHealth(): Promise<{ status: string }> {
  const response = await fetch(`${MARKER_BASE_URL}/health`, {
    headers: {
      "X-API-Key": getMarkerApiKey(),
    },
  });

  return readJsonResponse<{ status: string }>(response);
}

export async function convertPdfWithMarker(
  pdfBuffer: Buffer,
  fileName: string,
  options: {
    mode?: "fast" | "balanced" | "accurate";
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<MarkerConversionResult> {
  const apiKey = getMarkerApiKey();
  const formData = new FormData();

  formData.append("file", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), fileName);
  formData.append("output_format", "markdown");
  formData.append("mode", options.mode ?? "balanced");
  formData.append("paginate", "true");

  const startResponse = await fetch(`${MARKER_BASE_URL}/convert`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: formData,
  });

  const startData = await readJsonResponse<MarkerStartResponse>(startResponse);
  if (!startData.success || !startData.request_check_url) {
    throw new Error(startData.error || "Marker conversion request was not accepted.");
  }

  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;

  while (Date.now() - startedAt < timeoutMs) {
    const resultResponse = await fetch(startData.request_check_url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    const result = await readJsonResponse<MarkerResultResponse>(resultResponse);

    if (result.status === "complete") {
      if (result.success === false) {
        throw new Error(result.error || "Marker conversion failed.");
      }

      if (!result.markdown?.trim()) {
        throw new Error("Marker conversion completed but returned no markdown text.");
      }

      return {
        markdown: result.markdown,
        pageCount: result.page_count ?? null,
        parseQualityScore: result.parse_quality_score ?? null,
        runtime: result.runtime ?? null,
      };
    }

    if (result.status === "failed" || result.success === false) {
      throw new Error(result.error || "Marker conversion failed.");
    }

    await delay(pollIntervalMs);
  }

  throw new Error("Marker conversion timed out before the document was ready.");
}