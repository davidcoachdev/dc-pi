/**
 * dc-ptc-types.ts — Definiciones de tipos y contratos para Programmatic Tool Calling (PTC).
 * Directiva 1 de DC Studio: Cero dependencias externas o de Pi en el core.
 */

export interface PtcRunOptions {
  /**
   * Código TypeScript o JavaScript que el modelo desea ejecutar.
   * Puede contener llamadas asíncronas con top-level await a los bindings inyectados:
   * ej: `const files = await pi.fs.read('src/index.ts');`
   */
  code: string;

  /**
   * Directorio de trabajo del workspace.
   */
  cwd?: string;

  /**
   * Timeout en milisegundos para la ejecución del subproceso (default: 30000 ms = 30s).
   */
  timeoutMs?: number;

  /**
   * Variables de entorno adicionales pasadas al runner.
   */
  env?: Record<string, string | undefined>;
}

export interface PtcRunResult {
  /**
   * Éxito determinista de la ejecución (true si exit code es 0 y no hubo excepciones no capturadas).
   */
  success: boolean;

  /**
   * Valor de retorno final producido por el script (serializado o resultado de la última expresión/retorno).
   */
  value?: unknown;

  /**
   * Logs capturados de console.log / console.info / stdout.
   */
  stdout: string;

  /**
   * Mensajes de error o advertencias capturados en stderr.
   */
  stderr: string;

  /**
   * Tiempo de ejecución medido en milisegundos.
   */
  executionTimeMs: number;

  /**
   * Detalle del error en caso de fallo.
   */
  error?: string;
}
