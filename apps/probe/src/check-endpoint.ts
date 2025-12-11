import http from "http";
import https from "https";
import { URL, fileURLToPath } from "url";
import zlib from "zlib";
import fsPromises from "fs/promises";

export interface MonitorConfig {
  concurrency: number;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  maxBodySize: number;
  hostHotCountThreshold: number;
  hostHotCountWindowMs: number;
  keepAliveOptions: http.AgentOptions;
  logFile?: string | null;
}

export interface Message {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface MeasureResult {
  ok: boolean;
  url: string;
  timestamp: number;
  duration_ms: number | null;
  status?: number;
  statusText?: string;
  headers?: http.IncomingHttpHeaders;
  body?: unknown;
  error?: string;
  rawError?: unknown;
  processing_latency_ms?: number;
}

export const CONFIG: MonitorConfig = {
  concurrency: 50,
  requestTimeoutMs: 5000,
  connectTimeoutMs: 2000,
  maxBodySize: 2 * 1024 * 1024, // 2MB
  hostHotCountThreshold: 5,
  hostHotCountWindowMs: 30_000,
  keepAliveOptions: {
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
  },
  logFile: null,
};

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1000000n);
}
function hrDurationMs(startNanoseconds: bigint): number {
  return Number((process.hrtime.bigint() - startNanoseconds) / 1000000n);
}
function safeJson(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj);
  }
}

class AgentManager {
  private httpAgents = new Map<string, http.Agent>();
  private httpsAgents = new Map<string, https.Agent>();
  private hostCounts = new Map<string, { count: number; firstSeen: number }>();

  markHost(hostname: string): number {
    const now = Date.now();
    const rec = this.hostCounts.get(hostname) ?? { count: 0, firstSeen: now };
    if (now - rec.firstSeen > CONFIG.hostHotCountWindowMs) {
      rec.count = 1;
      rec.firstSeen = now;
    } else {
      rec.count++;
    }
    this.hostCounts.set(hostname, rec);
    return rec.count;
  }

  getAgentForUrl(urlObj: URL): http.Agent | https.Agent | undefined {
    const hostname = urlObj.hostname;
    const seen = this.markHost(hostname);

    if (seen >= CONFIG.hostHotCountThreshold) {
      const isHttps = urlObj.protocol === "https:";
      const map = isHttps ? this.httpsAgents : this.httpAgents;
      let agent = map.get(hostname);
      if (!agent) {
        agent = isHttps
          ? new https.Agent(Object.assign({}, CONFIG.keepAliveOptions))
          : new http.Agent(Object.assign({}, CONFIG.keepAliveOptions));
        map.set(hostname, agent as any);
      }
      return agent;
    }

    return undefined;
  }

  async destroyAll(): Promise<void> {
    try {
      for (const a of this.httpAgents.values()) a.destroy();
      for (const a of this.httpsAgents.values()) a.destroy();
    } finally {
      this.httpAgents.clear();
      this.httpsAgents.clear();
    }
  }
}
export const agentManager = new AgentManager();

export async function measureOnce(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  externalSignal?: AbortSignal;
}): Promise<MeasureResult> {
  const {
    url,
    method = "GET",
    headers = {},
    timeoutMs = CONFIG.requestTimeoutMs,
    externalSignal,
  } = opts;
  if (!url) throw new Error("url required");

  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const lib = isHttps ? https : http;

  const agent = agentManager.getAgentForUrl(urlObj);

  const reqOpts: http.RequestOptions = {
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: method.toUpperCase(),
    headers: Object.assign(
      {
        "accept-encoding": "gzip,deflate",
        "user-agent": "downtime-monitor/1.0",
      },
      headers
    ),
    agent: agent as any | undefined,
  };

  // local controller to combine externalSignal + local timeouts
  const localController = new AbortController();
  const controller = localController;
  const signal = controller.signal;

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  const startNs = process.hrtime.bigint();

  return await new Promise<MeasureResult>((resolve) => {
    let overallTimeout: NodeJS.Timeout | null = null;
    let connectTimeout: NodeJS.Timeout | null = null;
    let responseTimer: NodeJS.Timeout | null = null;

    overallTimeout = setTimeout(() => {
      try {
        controller.abort();
      } catch (e) {}
    }, timeoutMs);

    connectTimeout = setTimeout(() => {
      try {
        controller.abort();
      } catch (e) {}
    }, CONFIG.connectTimeoutMs);

    const req = lib.request(reqOpts, (res) => {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }

      responseTimer = setTimeout(() => {
        req.destroy(new Error("ERESPONSE_TIMEOUT"));
      }, timeoutMs);

      let stream: NodeJS.ReadableStream = res;
      const encoding = (
        (res.headers["content-encoding"] || "") as string
      ).toLowerCase();
      if (encoding === "gzip" || encoding === "x-gzip")
        stream = stream.pipe(zlib.createGunzip());
      else if (encoding === "deflate")
        stream = stream.pipe(zlib.createInflate());

      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > CONFIG.maxBodySize) {
          req.destroy(new Error("EMAX_BODY_SIZE"));
          if (typeof (stream as any).destroy === "function") {
            (stream as any).destroy();
          } else if (typeof (stream as any).cancel === "function") {
            (stream as any).cancel();
          }
        } else {
          chunks.push(chunk);
        }
      });

      stream.on("end", () => {
        if (responseTimer) {
          clearTimeout(responseTimer);
          responseTimer = null;
        }
        if (overallTimeout) {
          clearTimeout(overallTimeout);
          overallTimeout = null;
        }
        const duration = hrDurationMs(startNs);
        const rawBody = Buffer.concat(chunks);
        let body: unknown = undefined;
        const ctype = (
          (res.headers["content-type"] || "") as string
        ).toLowerCase();
        if (ctype.includes("application/json")) {
          try {
            body = JSON.parse(rawBody.toString("utf8"));
          } catch (e) {
            body = rawBody.toString("utf8");
          }
        } else {
          body = rawBody.toString("utf8");
        }

        const result: MeasureResult = {
          ok:
            res.statusCode !== undefined &&
            res.statusCode >= 200 &&
            res.statusCode < 300,
          url,
          timestamp: Date.now(),
          duration_ms: duration,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          body,
        };
        resolve(result);
      });

      stream.on("error", (err) => {
        if (responseTimer) {
          clearTimeout(responseTimer);
          responseTimer = null;
        }
        if (overallTimeout) {
          clearTimeout(overallTimeout);
          overallTimeout = null;
        }
        const duration = hrDurationMs(startNs);
        resolve({
          ok: false,
          url,
          timestamp: Date.now(),
          duration_ms: duration,
          error: (err as any).code || (err as Error).message || "STREAM_ERROR",
          rawError: err,
        });
      });
    });

    req.on("socket", (socket: any) => {
      socket.once("connect", () => {
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
      });
      socket.setTimeout(timeoutMs, () =>
        req.destroy(new Error("ESOCKET_TIMEOUT"))
      );
    });

    signal.addEventListener("abort", () => {
      req.destroy(new Error("ABORTED"));
    });

    req.on("error", (err) => {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      if (overallTimeout) {
        clearTimeout(overallTimeout);
        overallTimeout = null;
      }
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      const duration = hrDurationMs(startNs);

      const code = (err as any).code || (err as Error).message || "UNKNOWN";
      let mapped = code as string;
      if (code === "ECONNREFUSED") mapped = "ECONNREFUSED";
      else if (code === "ENOTFOUND") mapped = "DNS_NOT_FOUND";
      else if (code === "ERESPONSE_TIMEOUT" || code === "ESOCKET_TIMEOUT")
        mapped = "TIMEOUT";
      else if (code === "EMAX_BODY_SIZE") mapped = "MAX_BODY_EXCEEDED";
      else if (code === "ABORTED") mapped = "ABORTED";

      resolve({
        ok: false,
        url,
        timestamp: Date.now(),
        duration_ms: duration,
        error: mapped,
        rawError: err,
      });
    });

    req.end();
  });
}

export class WorkerPool {
  private concurrency: number;
  private running = new Set<Promise<void>>();
  private stopping = false;
  private inFlightControllers = new Set<AbortController>();

  constructor(concurrency = CONFIG.concurrency) {
    this.concurrency = concurrency;
  }

  async run(sourceAsyncIterable: AsyncIterable<Message>): Promise<void> {
    const iter = sourceAsyncIterable[Symbol.asyncIterator]();
    const launchers: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) {
      launchers.push(this._workerLoop(iter));
    }
    await Promise.all(launchers);
  }

  private async _workerLoop(iter: AsyncIterator<Message>): Promise<void> {
    while (!this.stopping) {
      let next: IteratorResult<Message>;
      try {
        next = await iter.next();
      } catch (err) {
        console.error("Source iterator error:", err);
        break;
      }
      if (next.done) break;
      const msg = next.value;
      const p = this._processMessage(msg)
        .catch((e) => console.error("Processing error", e))
        .finally(() => this.running.delete(p));
      this.running.add(p);
    }
    await Promise.all(Array.from(this.running));
  }

  private async _processMessage(msg: Message): Promise<void> {
    if (!msg || !msg.url) return;
    const start = nowMs();
    const externalController = new AbortController();
    this.inFlightControllers.add(externalController);

    try {
      const result = await measureOnce({
        url: msg.url,
        method: msg.method || "GET",
        headers: msg.headers || {},
        timeoutMs: msg.timeoutMs || CONFIG.requestTimeoutMs,
        externalSignal: externalController.signal,
      });
      result.processing_latency_ms = nowMs() - start;
      await sinkResult(result);
    } finally {
      this.inFlightControllers.delete(externalController);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const c of Array.from(this.inFlightControllers)) {
      try {
        c.abort();
      } catch {
        /* ignore */
      }
    }
    await Promise.all(Array.from(this.running));
  }
}

export async function sinkResult(result: MeasureResult): Promise<void> {
  const line = safeJson(result);
  if (CONFIG.logFile) {
    await fsPromises.appendFile(CONFIG.logFile, line + "\n");
  } else {
    console.log(line);
  }
}

export default {
  measureOnce,
  WorkerPool,
  agentManager,
  CONFIG,
};
