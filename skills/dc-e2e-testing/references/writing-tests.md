# Guía de Autoría y Aserciones en e2e

## 1. Fixtures Principales

Cada prueba recibe un conjunto tipado de fixtures inyectadas por el runner:

| Fixture | Tipo | Propósito |
| :--- | :--- | :--- |
| `app` | Helper de navegación | `app.open('/ruta')`, `app.url()`. |
| `screen` | Locator factory | Búsqueda accesible: `screen.getByRole`, `screen.getByText`, `screen.getByTestId`. |
| `agent` | Executor con IA | `agent.act('instrucción')`, `agent.assert('condición semántica')`. |
| `browser` | Control de navegador | Disponible cuando se importa desde `@e2e-dev/web`. Permite `browser.reload()`, cookies, viewport. |
| `device` | Control de móvil | Disponible en `@e2e-dev/mobile`. Permite `device.shake()`, `device.setOrientation()`. |

---

## 2. Locators Semánticos (Prioridad Recomendada)

Seguir siempre las directivas de accesibilidad (ARIA):

1. **Por Rol y Nombre Accesible (Máxima prioridad):**
   ```ts
   screen.getByRole('button', { name: 'Guardar Cambios' })
   screen.getByRole('textbox', { name: 'Correo Electrónico' })
   screen.getByRole('heading', { level: 2, name: 'Mi Cuenta' })
   screen.getByRole('checkbox', { name: 'Acepto los términos' })
   ```

2. **Por Texto Exacto o Coincidencia:**
   ```ts
   screen.getByText('Operación completada con éxito')
   ```

3. **Por Test ID (Solo cuando no haya rol semántico unívoco):**
   ```ts
   screen.getByTestId('billing-summary-widget')
   ```

---

## 3. Aserciones Deterministas con `expect`

`expect` de `e2e` hace polling y auto-retry hasta el timeout configurado. Nunca usar `sleep` manual:

```ts
// Visibilidad y habilitación
await expect(screen.getByRole('button', { name: 'Confirmar' })).toBeVisible();
await expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();

// Textos y contenido
await expect(screen.getByRole('alert')).toContainText('Pago procesado');
await expect(screen.getByRole('textbox', { name: 'Cupón' })).toHaveValue('DESCUENTO10');

// URL y estado del navegador
await expect(browser).toHaveURL(/\/dashboard/);
```

---

## 4. Cuándo Usar `agent.act` vs `screen`

- **Usar `screen` directo:** Cuando el paso es atómico y directo (ej: click en un botón específico, rellenar un input de formulario con un valor fijo, comprobar un texto).
- **Usar `agent.act`:** Cuando el flujo involucra pasos exploratorios, decisiones de interfaz dependientes de estado dinámico o cuando se desea validar la resiliencia del flujo ante variaciones cosméticas.
