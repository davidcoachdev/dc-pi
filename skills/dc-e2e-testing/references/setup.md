# Setup y Configuración Avanzada de e2e

## 1. Estructura de Proyectos Soportados

`e2e` se integra tanto en monorepos como en proyectos independientes (Next.js, Vite, Remix, Expo, React Native).

### Instalación de Dependencias

```bash
# Para Web:
pnpm add -D e2e @e2e-dev/web

# Para Mobile (iOS Simulator / Android Emulator):
pnpm add -D e2e @e2e-dev/mobile
```

## 2. Gestión de Puertos Dinámicos y Procesos de App

En entornos de integración continua o cuando el puerto local puede estar ocupado, `e2e` puede auto-asignar puertos y arrancar tu servidor local:

```ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  targets: [
    {
      name: 'web',
      engine: web({
        browser: 'chromium', // 'chromium' | 'firefox' | 'webkit'
      }),
      app: {
        // Al especificar puerto 0 o loopback, el runner puede gestionar el bind
        url: 'http://127.0.0.1:3000',
        command: {
          executable: 'pnpm',
          args: ['dev', '--port', '3000'],
          log: '.e2e/logs/dev-server.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
```

## 3. Manejo Seguro de Credenciales y Secretos

Nunca escribir contraseñas en código duro. `e2e` soporta un sistema estricto de secretos en `e2e.config.ts`:

```ts
export default {
  // ...
  credentials: {
    admin: {
      username: 'admin@dcstudio.dev',
      password: process.env.E2E_ADMIN_PASSWORD || 'secret-placeholder',
    },
  },
} satisfies E2EConfig;
```

En el test, el valor se accede mediante el handle opaco:
```ts
import { test, credentials } from 'e2e';

test('login administrativo seguro', async ({ app, screen }) => {
  const creds = credentials.admin;
  await app.open('/login');
  await screen.getByRole('textbox', { name: 'Email' }).fill(creds.username);
  await screen.getByRole('textbox', { name: 'Password' }).fill(creds.password);
  await screen.getByRole('button', { name: 'Ingresar' }).click();
});
```
*Invariante de seguridad:* El runner detecta automáticamente los valores de `credentials` y los redacta en logs, trazas y capturas.
