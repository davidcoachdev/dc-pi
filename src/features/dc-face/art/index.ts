import type { FaceMode, FaceProfile } from "../core/dc-face-types.ts";
import { DCDEV_PROFILE } from "./dcdev.ts";
import { CUBIS_PROFILE } from "./cubis.ts";

export * from "./dcdev.ts";
export * from "./cubis.ts";
export * from "./mini.ts";
export * from "./painter.ts";

const PROFILES = new Map<string, FaceProfile>([
  [DCDEV_PROFILE.id, DCDEV_PROFILE as unknown as FaceProfile],
  [CUBIS_PROFILE.id, CUBIS_PROFILE as unknown as FaceProfile],
]);

/**
 * Registra un nuevo perfil de arte para la carita. Permite agregar nuevos estilos
 * simplemente creando un archivo en art/ y registrándolo.
 */
export function registerFaceProfile(profile: FaceProfile): void {
  PROFILES.set(profile.id, profile);
}

/**
 * Obtiene el perfil de cara por ID, con fallback seguro a "dcdev".
 */
export function getFaceProfile(id?: string): FaceProfile {
  if (id && PROFILES.has(id)) {
    return PROFILES.get(id)!;
  }
  return DCDEV_PROFILE as unknown as FaceProfile;
}

/**
 * Lista todos los perfiles de arte disponibles.
 */
export function listFaceProfiles(): FaceProfile[] {
  return Array.from(PROFILES.values());
}

/**
 * Obtiene la secuencia de frames animados para un perfil y modo específico.
 */
export function bigFramesFor(profileId: string, mode: FaceMode): readonly string[][] | null {
  const profile = getFaceProfile(profileId);
  const frames = profile.frames[mode];
  return frames && frames.length > 0 ? frames : null;
}

/**
 * Obtiene la cara estática por defecto para un perfil.
 */
export function bigDefaultFor(profileId: string): readonly string[] {
  return getFaceProfile(profileId).defaultFace;
}
