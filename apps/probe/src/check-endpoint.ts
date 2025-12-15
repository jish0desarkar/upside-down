import http from "http";
import https from "https";
import { URL } from "url";
import zlib from "zlib";
import fsPromises from "fs/promises";

// ============================================================================
// Configuration
// ============================================================================

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

export const DEFAULT_CONFIG: MonitorConfig = {
  concurrency: 50,
  requestTimeoutMs: 30_000,
  connectTimeoutMs: 5000,
  maxBodySize: 2 * 1024 * 1024,
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

let CONFIG = DEFAULT_CONFIG;

// ============================================================================
// Types
// ============================================================================

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

interface HostMetrics {
  count: number;
  firstSeen: number;
}

// ============================================================================
// Time Utilities
// ============================================================================

function getCurrentTimeMs(): number {
  return Date.now();
}

function calculateDurationMs(startNanoseconds: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startNanoseconds;
  return Number(elapsedNanoseconds / 1000000n);
}

function safeJsonStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

// ============================================================================
// Agent Manager - Manages HTTP/HTTPS agents with connection pooling
// ============================================================================

class AgentManager {
  private httpAgents = new Map<string, http.Agent>();
  private httpsAgents = new Map<string, https.Agent>();
  private hostMetrics = new Map<string, HostMetrics>();

  getAgentForUrl(url: URL): http.Agent | https.Agent | undefined {
    const requestCount = this.trackHostRequest(url.hostname);

    if (this.shouldUseConnectionPool(requestCount)) {
      return this.getOrCreateAgent(url);
    }

    return undefined;
  }

  async destroyAllAgents(): Promise<void> {
    this.destroyAgents(this.httpAgents);
    this.destroyAgents(this.httpsAgents);
    this.httpAgents.clear();
    this.httpsAgents.clear();
  }

  private trackHostRequest(hostname: string): number {
    const now = getCurrentTimeMs();
    const metrics = this.getOrCreateHostMetrics(hostname, now);

    if (this.isMetricsWindowExpired(metrics, now)) {
      this.resetHostMetrics(metrics, now);
    } else {
      metrics.count++;
    }

    this.hostMetrics.set(hostname, metrics);
    return metrics.count;
  }

  private getOrCreateHostMetrics(hostname: string, now: number): HostMetrics {
    return this.hostMetrics.get(hostname) ?? { count: 0, firstSeen: now };
  }

  private isMetricsWindowExpired(metrics: HostMetrics, now: number): boolean {
    return now - metrics.firstSeen > CONFIG.hostHotCountWindowMs;
  }

  private resetHostMetrics(metrics: HostMetrics, now: number): void {
    metrics.count = 1;
    metrics.firstSeen = now;
  }

  private shouldUseConnectionPool(requestCount: number): boolean {
    return requestCount >= CONFIG.hostHotCountThreshold;
  }

  private getOrCreateAgent(url: URL): http.Agent | https.Agent {
    const isHttps = url.protocol === "https:";
    const agentMap = isHttps ? this.httpsAgents : this.httpAgents;

    let agent = agentMap.get(url.hostname);
    if (!agent) {
      agent = this.createAgent(isHttps);
      agentMap.set(url.hostname, agent as any);
    }

    return agent;
  }

  private createAgent(isHttps: boolean): http.Agent | https.Agent {
    const options = { ...CONFIG.keepAliveOptions };
    return isHttps ? new https.Agent(options) : new http.Agent(options);
  }

  private destroyAgents(agentMap: Map<string, any>): void {
    for (const agent of agentMap.values()) {
      agent.destroy();
    }
  }
}

export const agentManager = new AgentManager();

// ============================================================================
// HTTP Request Builder
// ============================================================================

class HttpRequestBuilder {
  private url: URL;
  private method: string;
  private headers: Record<string, string>;
  private agent?: http.Agent | https.Agent;

  constructor(url: string, method: string, headers: Record<string, string>) {
    this.url = new URL(url);
    this.method = method.toUpperCase();
    this.headers = this.buildHeaders(headers);
    this.agent = agentManager.getAgentForUrl(this.url);
  }

  build(): http.RequestOptions {
    return {
      protocol: this.url.protocol,
      hostname: this.url.hostname,
      port: this.getPort(),
      path: this.url.pathname + this.url.search,
      method: this.method,
      headers: this.headers,
      agent: this.agent as any,
    };
  }

  isHttps(): boolean {
    return this.url.protocol === "https:";
  }

  private getPort(): number {
    if (this.url.port) return parseInt(this.url.port);
    return this.isHttps() ? 443 : 80;
  }

  private buildHeaders(
    customHeaders: Record<string, string>
  ): Record<string, string> {
    return {
      "accept-encoding": "gzip,deflate",
      "user-agent": "downtime-monitor/1.0",
      ...customHeaders,
    };
  }
}

// ============================================================================
// Response Stream Handler
// ============================================================================

class ResponseStreamHandler {
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  handleChunk(
    chunk: Buffer,
    request: http.ClientRequest,
    stream: NodeJS.ReadableStream
  ): void {
    this.totalBytes += chunk.length;

    if (this.exceedsMaxSize()) {
      this.abortStreams(request, stream);
    } else {
      this.chunks.push(chunk);
    }
  }

  getBody(contentType: string): unknown {
    const rawBody = Buffer.concat(this.chunks);
    return this.parseBody(rawBody, contentType);
  }

  private exceedsMaxSize(): boolean {
    return this.totalBytes > CONFIG.maxBodySize;
  }

  private abortStreams(
    request: http.ClientRequest,
    stream: NodeJS.ReadableStream
  ): void {
    request.destroy(new Error("EMAX_BODY_SIZE"));
    this.destroyStream(stream);
  }

  private destroyStream(stream: any): void {
    if (typeof stream.destroy === "function") {
      stream.destroy();
    } else if (typeof stream.cancel === "function") {
      stream.cancel();
    }
  }

  private parseBody(rawBody: Buffer, contentType: string): unknown {
    const bodyText = rawBody.toString("utf8");

    if (this.isJsonContent(contentType)) {
      return this.tryParseJson(bodyText);
    }

    return bodyText;
  }

  private isJsonContent(contentType: string): boolean {
    return contentType.toLowerCase().includes("application/json");
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

// ============================================================================
// Timeout Manager
// ============================================================================

class TimeoutManager {
  private overallTimeout: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private responseTimeout: NodeJS.Timeout | null = null;

  setOverallTimeout(ms: number, abortController: AbortController): void {
    this.overallTimeout = setTimeout(() => {
      try {
        abortController.abort();
      } catch {}
    }, ms);
  }

  setConnectTimeout(ms: number, abortController: AbortController): void {
    this.connectTimeout = setTimeout(() => {
      try {
        abortController.abort();
      } catch {}
    }, ms);
  }

  setResponseTimeout(ms: number, request: http.ClientRequest): void {
    this.responseTimeout = setTimeout(() => {
      request.destroy(new Error("ERESPONSE_TIMEOUT"));
    }, ms);
  }

  clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  clearResponseTimeout(): void {
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = null;
    }
  }

  clearAllTimeouts(): void {
    this.clearConnectTimeout();
    this.clearResponseTimeout();

    if (this.overallTimeout) {
      clearTimeout(this.overallTimeout);
      this.overallTimeout = null;
    }
  }
}

// ============================================================================
// Error Mapper
// ============================================================================

function mapErrorCode(error: any): string {
  const code = error.code || error.message || "UNKNOWN";

  const errorMap: Record<string, string> = {
    ECONNREFUSED: "ECONNREFUSED",
    ENOTFOUND: "DNS_NOT_FOUND",
    ERESPONSE_TIMEOUT: "TIMEOUT",
    ESOCKET_TIMEOUT: "TIMEOUT",
    EMAX_BODY_SIZE: "MAX_BODY_EXCEEDED",
    ABORTED: "ABORTED",
  };

  const tcpErrorMap: Record<string, string> = {
    DNS_ERROR: "DNS_ERROR",
    ETIMEDOUT: "TCP_TIMEOUT",
    EHOSTUNREACH: "HOST_UNREACHABLE",
    TLS_ERROR: "TLS_ERROR",
    HTTP_ERROR: "HTTP_ERROR",
  };

  return errorMap[code] || tcpErrorMap[code] || code;
}

// ============================================================================
// Response Handler
// ============================================================================

function createDecompressionStream(
  response: http.IncomingMessage
): NodeJS.ReadableStream {
  const encoding = (response.headers["content-encoding"] || "").toLowerCase();

  if (encoding === "gzip" || encoding === "x-gzip") {
    return response.pipe(zlib.createGunzip());
  }

  if (encoding === "deflate") {
    return response.pipe(zlib.createInflate());
  }

  return response;
}

function isSuccessStatus(statusCode?: number): boolean {
  return statusCode !== undefined && statusCode >= 200 && statusCode < 400;
}

// ============================================================================
// Main Measurement Function
// ============================================================================

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

  if (!url) {
    throw new Error("url required");
  }

  const requestBuilder = new HttpRequestBuilder(url, method, headers);
  const requestOptions = requestBuilder.build();
  const httpLib = requestBuilder.isHttps() ? https : http;

  const abortController = createAbortController(externalSignal);
  const startTime = process.hrtime.bigint();

  return new Promise<MeasureResult>((resolve) => {
    const timeoutManager = new TimeoutManager();
    timeoutManager.setOverallTimeout(timeoutMs, abortController);
    timeoutManager.setConnectTimeout(CONFIG.connectTimeoutMs, abortController);
    const request = httpLib.request(requestOptions, (response) => {
      handleResponse(
        response,
        request,
        url,
        startTime,
        timeoutMs,
        timeoutManager,
        resolve
      );
    });

    setupRequestHandlers(
      request,
      url,
      startTime,
      timeoutMs,
      abortController,
      timeoutManager,
      resolve
    );
    request.end();
  });
}

function createAbortController(externalSignal?: AbortSignal): AbortController {
  const controller = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return controller;
}

function handleResponse(
  response: http.IncomingMessage,
  request: http.ClientRequest,
  url: string,
  startTime: bigint,
  timeoutMs: number,
  timeoutManager: TimeoutManager,
  resolve: (result: MeasureResult) => void
): void {
  timeoutManager.clearConnectTimeout();
  timeoutManager.setResponseTimeout(timeoutMs, request);

  const stream = createDecompressionStream(response);
  const streamHandler = new ResponseStreamHandler();

  stream.on("data", (chunk: Buffer) => {
    streamHandler.handleChunk(chunk, request, stream);
  });

  stream.on("end", () => {
    timeoutManager.clearAllTimeouts();
    const result = createSuccessResult(response, url, startTime, streamHandler);
    resolve(result);
  });

  stream.on("error", (error) => {
    timeoutManager.clearAllTimeouts();
    const result = createErrorResult(url, startTime, error);
    resolve(result);
  });
}

function setupRequestHandlers(
  request: http.ClientRequest,
  url: string,
  startTime: bigint,
  timeoutMs: number,
  abortController: AbortController,
  timeoutManager: TimeoutManager,
  resolve: (result: MeasureResult) => void
): void {
  request.on("socket", (socket: any) => {
    // TODO: Measure connect timeout
    socket.once("connect", () => timeoutManager.clearConnectTimeout());
    socket.setTimeout(timeoutMs, () =>
      request.destroy(new Error("ESOCKET_TIMEOUT"))
    );
  });

  abortController.signal.addEventListener("abort", () => {
    request.destroy(new Error("ABORTED"));
  });

  request.on("error", (error) => {
    timeoutManager.clearAllTimeouts();
    const result = createErrorResult(url, startTime, error);
    resolve(result);
  });
}

function createSuccessResult(
  response: http.IncomingMessage,
  url: string,
  startTime: bigint,
  streamHandler: ResponseStreamHandler
): MeasureResult {
  const contentType = (response.headers["content-type"] || "") as string;

  return {
    ok: isSuccessStatus(response.statusCode),
    url,
    timestamp: getCurrentTimeMs(),
    duration_ms: calculateDurationMs(startTime),
    status: response.statusCode,
    statusText: response.statusMessage,
    headers: response.headers,
  };
}

function createErrorResult(
  url: string,
  startTime: bigint,
  error: any
): MeasureResult {
  return {
    ok: false,
    url,
    timestamp: getCurrentTimeMs(),
    duration_ms: calculateDurationMs(startTime),
    error: mapErrorCode(error),
    rawError: error,
    status: 599, // Mapped fake http error code
  };
}

// ============================================================================
// Result Sink
// ============================================================================

export async function writeResult(result: MeasureResult): Promise<void> {
  const jsonLine = safeJsonStringify(result);

  if (CONFIG.logFile) {
    await fsPromises.appendFile(CONFIG.logFile, jsonLine + "\n");
  } else {
    console.log(jsonLine);
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  measureOnce,
  agentManager,
  CONFIG,
};
