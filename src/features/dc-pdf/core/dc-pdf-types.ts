export interface PdfMetadata {
  title?: string;
  author?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  pagesCount: number;
}

export interface PdfExtractResult {
  path: string;
  sha256: string;
  byteSize: number;
  metadata: PdfMetadata;
  text: string;
  textCharsCount: number;
  truncated: boolean;
}

export interface PdfExtractOptions {
  path: string;
  textCharsLimit?: number;
  cwd?: string;
}
