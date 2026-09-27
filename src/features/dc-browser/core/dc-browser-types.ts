export interface BrowserPageTarget {
  id: string;
  title: string;
  url: string;
  hasWebSocketDebuggerUrl: boolean;
  webSocketDebuggerUrl?: string;
}

export interface BrowserCdpStatus {
  cdpUrl: string;
  connected: boolean;
  browser?: string;
  protocolVersion?: string;
  pageTargetCount: number;
  warnings: string[];
}

export interface BrowserNavigateOptions {
  url: string;
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
  timeoutMs?: number;
}

export interface BrowserNavigateResult {
  targetId: string;
  title: string;
  url: string;
  durationMs: number;
}

export interface BrowserScreenshotOptions {
  cwd?: string;
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
  outputPath?: string;
  fullPage?: boolean;
}

export interface BrowserScreenshotResult {
  targetId: string;
  title: string;
  url: string;
  outputPath: string;
  outputSizeBytes: number;
  width: number;
  height: number;
}
