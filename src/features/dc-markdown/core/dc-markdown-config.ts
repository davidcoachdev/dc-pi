export interface DcMarkdownConfig {
  codeBoxEnabled: boolean;
}

const config: DcMarkdownConfig = {
  codeBoxEnabled: true,
};

export function isCodeBoxEnabled(): boolean {
  return config.codeBoxEnabled;
}

export function setCodeBoxEnabled(enabled: boolean): void {
  config.codeBoxEnabled = enabled;
}
