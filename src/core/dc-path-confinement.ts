import * as fs from "node:fs";
import * as path from "node:path";

const MAX_SYMLINK_HOPS = 40;

/**
 * Verifica léxicamente si `candidatePath` queda contenido dentro de `rootPath`
 * (incluyendo coincidencia exacta con `rootPath`).
 */
export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

interface SymlinkResolutionState {
  hops: number;
  visited: Set<string>;
}

function resolveExistingAncestorRealpathInternal(
  targetPath: string,
  state: SymlinkResolutionState,
): string {
  let current = path.resolve(targetPath);
  let tail: string[] = [];

  while (true) {
    if (fs.existsSync(current)) {
      const realBase = fs.realpathSync(current);
      return tail.length > 0 ? path.join(realBase, ...tail) : realBase;
    }

    // Detectar symlinks colgantes (cuyo destino aún no existe en disco)
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        const parentDir = path.dirname(current);
        const parentReal = fs.existsSync(parentDir)
          ? fs.realpathSync(parentDir)
          : resolveExistingAncestorRealpathInternal(parentDir, state);
        const canonicalLinkPath = path.join(parentReal, path.basename(current));

        state.hops += 1;
        if (state.hops > MAX_SYMLINK_HOPS || state.visited.has(canonicalLinkPath)) {
          throw new Error(`Demasiados niveles de enlaces simbólicos al resolver: ${targetPath}`);
        }
        state.visited.add(canonicalLinkPath);

        const linkTarget = fs.readlinkSync(current);
        const resolvedLink = path.resolve(parentReal, linkTarget);
        current = tail.length > 0 ? path.join(resolvedLink, ...tail) : resolvedLink;
        tail = [];
        continue;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return tail.length > 0 ? path.join(current, ...tail) : current;
    }
    tail.unshift(path.basename(current));
    current = parent;
  }
}

/**
 * Resuelve la ruta real (siguiendo symlinks, incluso symlinks colgantes) del
 * ancestro existente más profundo y reconstruye el sufijo no existente.
 */
export function resolveExistingAncestorRealpath(targetPath: string): string {
  return resolveExistingAncestorRealpathInternal(targetPath, {
    hops: 0,
    visited: new Set<string>(),
  });
}

/**
 * Garantiza que `targetPath` permanece confinado dentro de al menos uno de los
 * directorios en `allowedRoots`, verificando tanto la ruta léxica como la ruta
 * real tras resolver symlinks y ancestros existentes.
 */
export function assertPathWithinRoots(
  targetPath: string,
  allowedRoots: readonly string[],
  label = "ruta",
): string {
  if (!allowedRoots || allowedRoots.length === 0) {
    throw new Error(`Acceso denegado: no hay directorios permitidos configurados para ${label}`);
  }

  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoots = allowedRoots.map((root) => path.resolve(root));

  if (!resolvedRoots.some((root) => isPathWithinRoot(root, resolvedTarget))) {
    throw new Error(
      `Acceso denegado: ${label} fuera de los directorios permitidos (${resolvedTarget})`,
    );
  }

  const realTarget = resolveExistingAncestorRealpath(resolvedTarget);
  const realRoots = resolvedRoots.map((root) => resolveExistingAncestorRealpath(root));

  if (!realRoots.some((root) => isPathWithinRoot(root, realTarget))) {
    throw new Error(
      `Acceso denegado tras resolver symlinks: ${label} fuera de los directorios permitidos (${resolvedTarget})`,
    );
  }

  return resolvedTarget;
}
