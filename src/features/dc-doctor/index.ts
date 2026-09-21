export {
  LAYOUT_NODE_SYMBOL,
  SIDEBAR_STATE_SYMBOL,
  DEFAULT_DOCTOR_REPORT_FILE,
  DEFAULT_DOCTOR_SUMMARY_FILE,
  describeNode,
  describeComp,
  probeLayout,
  summarizeProbe,
  runDoctorDiagnostic,
  type DcDoctorProbeResult,
  type DcDoctorOptions,
  type DcDoctorReport,
} from "./dc-doctor-inspector.ts";

export { default as dcDoctorExtension } from "./dc-doctor.ts";
