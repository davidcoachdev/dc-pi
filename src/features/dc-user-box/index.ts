export {
  ORIG_RENDER,
  ORIG_HANDLE_MOUSE,
  LAST_COPY_REGION,
  isUserBoxEnabled,
  setUserBoxEnabled,
  isUserBoxVerticalPadding,
  setUserBoxVerticalPadding,
  resolveCurrentUserName,
  installUserBoxPatch,
  type DcUserBoxConfig,
} from "./dc-user-box-patch.ts";

export { default as dcUserBoxExtension } from "./dc-user-box.ts";
