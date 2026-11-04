import * as path from "node:path";

export interface FileReservation {
  path: string; // ruta relativa al repoRoot
  taskId: string;
  taskTitle: string;
  acquiredAt: number;
}

/**
 * Guardián de Conflictos de Archivos (File Conflict Guard).
 * Lleva un registro en memoria de qué archivos están siendo modificados por subagentes
 * en segundo plano (para resolver issues) y previene colisiones accidentales con el trabajo del usuario.
 */
export class DcConflictGuard {
  private static instance?: DcConflictGuard;
  private reservations = new Map<string, FileReservation>(); // normalizedPath -> FileReservation

  public static getInstance(): DcConflictGuard {
    if (!DcConflictGuard.instance) {
      DcConflictGuard.instance = new DcConflictGuard();
    }
    return DcConflictGuard.instance;
  }

  private normalize(filePath: string): string {
    const cwd = process.cwd();
    let rel = filePath;
    if (path.isAbsolute(filePath)) {
      rel = path.relative(cwd, filePath);
    }
    return path.normalize(rel).replace(/^[/\\]+/, "").toLowerCase();
  }

  /**
   * Intenta reservar una lista de archivos para una tarea en segundo plano.
   * Retorna { ok: true } o la lista de conflictos detectados.
   */
  public reserveFiles(
    files: string[],
    taskId: string,
    taskTitle: string,
  ): { ok: boolean; conflicts?: FileReservation[] } {
    const conflicts: FileReservation[] = [];

    for (const f of files) {
      const norm = this.normalize(f);
      const existing = this.reservations.get(norm);
      if (existing && existing.taskId !== taskId) {
        conflicts.push(existing);
      }
    }

    if (conflicts.length > 0) {
      return { ok: false, conflicts };
    }

    const now = Date.now();
    for (const f of files) {
      const norm = this.normalize(f);
      this.reservations.set(norm, {
        path: f,
        taskId,
        taskTitle,
        acquiredAt: now,
      });
    }

    return { ok: true };
  }

  /**
   * Libera todas las reservas asociadas a una tarea cuando finaliza.
   */
  public releaseTask(taskId: string): void {
    for (const [norm, res] of this.reservations.entries()) {
      if (res.taskId === taskId) {
        this.reservations.delete(norm);
      }
    }
  }

  /**
   * Comprueba si un archivo específico está reservado por un subagente.
   */
  public checkFileConflict(filePath: string): FileReservation | undefined {
    const norm = this.normalize(filePath);
    return this.reservations.get(norm);
  }

  /**
   * Lista todas las reservas activas.
   */
  public listReservations(): FileReservation[] {
    return Array.from(this.reservations.values());
  }

  /**
   * Limpia todo el registro (ej: en reinicio o testing).
   */
  public clear(): void {
    this.reservations.clear();
  }
}

export const dcConflictGuard = DcConflictGuard.getInstance();
