import { getDcControlPaths } from "../../../core/dc-paths.ts";

/**
 * Rutas canónicas del supervisor multisesión delegadas a la jerarquía oficial de DC Studio.
 * Ubicación: ~/.pi/agent/dc-studio/control/supervisor.{sock,pid}
 */
export function getCanonicalDcSupervisorPaths(): { runtimeDir: string; socketPath: string; pidPath: string } {
  const paths = getDcControlPaths();
  return {
    runtimeDir: paths.dir,
    socketPath: paths.socket,
    pidPath: paths.pid,
  };
}
