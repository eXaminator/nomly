/**
 * Server-side HTTP fetcher used by recipe URL import. Sets a friendly
 * User-Agent, enforces a timeout, and caps the response body to keep memory
 * predictable when someone points us at a 100 MB asset by accident.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const USER_AGENT =
  "nomly-recipe-importer/1.0 (+https://github.com/eXaminator/nomly)";

export type FetchResult = {
  url: string; // final URL after redirects
  status: number;
  contentType: string | null;
  body: Buffer;
};

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export async function fetchUrl(
  rawUrl: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    accept?: string;
  } = {},
): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("Ungültige URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("Nur http(s)-URLs werden unterstützt");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const accept = options.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept,
        "accept-language": "de,en;q=0.8",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new FetchError(`Zeitüberschreitung nach ${timeoutMs} ms`);
    }
    throw new FetchError(
      `Verbindung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new FetchError(`HTTP ${res.status}`, res.status);
  }

  // Stream the body and cap at maxBytes to avoid OOM on huge responses.
  const reader = res.body?.getReader();
  if (!reader) {
    throw new FetchError("Antwort enthielt keinen Body");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FetchError(
          `Antwort überschreitet ${(maxBytes / (1024 * 1024)).toFixed(0)} MB`,
        );
      }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  return {
    url: res.url,
    status: res.status,
    contentType: res.headers.get("content-type"),
    body,
  };
}
