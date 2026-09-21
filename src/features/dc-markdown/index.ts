export {
  CARD_OPACITY,
  DEFAULT_BG,
  DEFAULT_BORDER,
  DEFAULT_TAG,
  LANG_ICONS,
  blendWithBackground,
  getHeadingPrefix,
  getLangIcon,
  prettifyErrorContent,
} from "./dc-markdown-tokens.ts";

export {
  ORIG_RENDER_TOKEN,
  ORIG_ASSISTANT_UPDATE,
  ORIG_ASSISTANT_RENDER,
  ORIG_ASSISTANT_MOUSE,
  isCodeBoxEnabled,
  setCodeBoxEnabled,
  installMarkdownPatch,
  installAssistantCopyPatch,
  type DcMarkdownConfig,
} from "./dc-markdown-patch.ts";

export { default as dcMarkdownExtension } from "./dc-markdown.ts";
