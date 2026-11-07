/**
 * src/features/dc-ice/types.ts — Tipos y esquemas para IDSD (Intent, Context & Expectations).
 * Directiva: Kapil Viren Ahuja & Google Cloud AI SDLC.
 */

export interface IceManualBrake {
  /**
   * ¿Quién necesita esto y qué se rompe en el mundo real si nunca existe?
   * Si la respuesta honesta es "nadie", se rechaza como build de producción y se clasifica como experimento.
   */
  whoNeedsThis: string;

  /**
   * ¿Construiríamos esto si costara una semana completa de trabajo de desarrolladores
   * senior en lugar de una tarde de tokens baratos?
   */
  costIfOneWeekDevs: boolean | string;

  /**
   * ¿Quién es la persona o rol responsable con la autoridad de decir "NO"?
   * Un proyecto o tarea sin dueño de la negativa es una trampa.
   */
  refusalOwner: string;
}

export interface IceIntent {
  /**
   * El objetivo en una sola oración.
   * Invariante: No debe tener conjunciones ("and", "y") ni pre-bloquear tecnologías (test de 2 implementaciones).
   */
  goal: string;

  /**
   * Cualidades no funcionales obligatorias en lenguaje de negocio / SLO (3 a 5, máx 7).
   * Ej: p99 < 200ms, 99.99% uptime, WCAG 2.1 AA.
   * No deben nombrar librerías, clases ni rutas de código.
   */
  constraints: string[];

  /**
   * Comprobaciones binarias post-output ejecutadas por evaluadores deterministas (3 a 5, máx 7).
   * Ej: build fails, unit coverage drops, secret appears in code, lint errors.
   */
  failureConditions: string[];

  /**
   * El freno manual innegociable de Ahuja antes de gastar tokens.
   */
  manualBrake: IceManualBrake;
}

export interface IceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  intent?: IceIntent;
  suggestedRemediation?: string[];
}
