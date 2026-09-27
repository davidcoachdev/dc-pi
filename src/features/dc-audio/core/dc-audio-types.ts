export type AudioTtsEngine = "auto" | "piper" | "espeak-ng";

export interface AudioSynthesisOptions {
  text: string;
  outputPath?: string;
  engine?: AudioTtsEngine;
  language?: string; // default "es"
  speed?: number; // words per minute (default 160)
  cwd?: string;
}

export interface AudioSynthesisResult {
  outputPath: string;
  engineUsed: "piper" | "espeak-ng";
  language: string;
  byteSize: number;
  durationEstimateSeconds: number;
  textCharCount: number;
}
