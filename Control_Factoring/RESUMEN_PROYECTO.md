# Control Factoring — Hoja de Resumen / Estado del Proyecto

**Fecha de análisis:** 18 de junio de 2026  
**Plataforma:** Google Apps Script (Google Sheets + Gmail + Drive API)  
**Archivos del proyecto:** 4 scripts (`.js` / `.gs`)

---

## 1. Propósito del proyecto

Automatizar la **revisión y actualización de facturas de factoring** en la hoja `EMITIDO` de un Google Spreadsheet, usando correos del banco (Santander) que llegan con adjuntos Excel (`.xls`).

El sistema:
1. Busca correos recientes de `fycout@gruposantander.es`.
2. Extrae datos de dos tipos de informes bancarios (anticipos y cobros).
3. Cruza esos datos con las facturas de la hoja `EMITIDO`.
4. Actualiza columnas clave y estados.
5. Registra cada ejecución en `Audit Log`.
6. Ofrece una auditoría post-ejecución para corregir inconsistencias en el estado `ANTICIPADA`.

---

## 2. Arquitectura de archivos

| Archivo | Rol | Responsabilidad principal |
|---------|-----|---------------------------|
| `Code.js` | **Orquestador / Entrada** | Menú, puntos de entrada manual y automático, flujo principal |
| `Helper.js` | **Infraestructura / E/S** | Gmail, conversión XLS, lectura/escritura de hoja, auditoría de ejecución |
| `Logic.js` | **Reglas de negocio** | Fusión de datos bancarios con hoja, cálculo de estados |
| `Audit.js` | **Control de calidad** | Revisión post-ejecución de estados `ANTICIPADA`, log secundario |

### Flujo general

```
[Menú / Trigger]
       ↓
  Code.js → executeFactoringProcess()
       ↓
  Helper.js → calculateSearchDateRange() + processBankEmails()
       ↓
  Helper.js → getSheetData()
       ↓
  Logic.js  → mergeAndCalculateUpdates()
       ↓
  Helper.js → applyUpdatesToSheet() + logAudit()
       ↓
  (Opcional) Audit.js → auditLastRunModifications()
```

---

## 3. Hojas de Google Sheets requeridas

| Hoja | Uso | Creada automáticamente |
|------|-----|------------------------|
| `EMITIDO` | Hoja principal de facturas (debe existir previamente) | No |
| `Audit Log` | Log de cada ejecución del proceso principal | Sí |
| `repasoAudit log` | Log de correcciones de la auditoría | Sí |

### Columnas obligatorias en `EMITIDO`

| Columna | Uso |
|---------|-----|
| `Número factura` | Clave de cruce con datos bancarios |
| `Importe` | Importe total de la factura |
| `Importe anticipado` | Importe anticipado por el banco |
| `Moneda` | Moneda del anticipo |
| `Fecha Anticipo` | Fecha del anticipo |
| `ANTICIPADA` | Estado de anticipo (`ANTICIPADA`, `ANTICIPO PARCIAL`, `NO ANTICIPADA`) |
| `ESTADO` | Estado general (`PAGADA`, `REVIEW INVOICE`, `CANCELADA`, `CAIDA FINANCIACION`, etc.) |

---

## 4. Fuentes de datos (correos Gmail)

**Remitente:** `fycout@gruposantander.es`

| Tipo | Asunto del correo | Datos extraídos |
|------|-------------------|-----------------|
| **Anticipo** | `Factoring - Detalle anticipo` | Nº factura, moneda, importe anticipo, fecha anticipo |
| **Cobros** | `Factoring - Cobros y Expiración de Financiación` | Nº factura, indicador de cobro (`COBRO` o valor numérico) |

Los adjuntos `.xls` se convierten temporalmente a Google Sheets vía Drive API, se leen y se eliminan.

---

## 5. Puntos de entrada

| Función | Archivo | Modo | Descripción |
|---------|---------|------|-------------|
| `onOpen()` | Code.js | Automático | Crea menú **"Review Factoring Invoices"** |
| `mainReviewFactoring()` | Code.js | Manual | Pide horas a revisar y ejecuta el proceso |
| `dailyTriggerExecution()` | Code.js | Trigger | Ejecución automática (24h por defecto) |
| `auditLastRunModifications()` | Audit.js | Manual / Trigger | Revisa y corrige estados `ANTICIPADA` |
| `crearTriggerDiario()` | Audit.js | Setup (una vez) | Crea trigger diario a las 2:00 AM para la auditoría |
| `forzar_permisos_drive()` | Code.js | Setup | Fuerza permisos de Drive API |
| `test_conversion_directa()` | Code.js | Test | Prueba conversión de un XLS por ID |

---

## 6. Reglas de negocio implementadas

### 6.1 Actualización por datos de anticipo
- Actualiza `Importe anticipado` si difiere del valor bancario.
- Rellena `Moneda` solo si la celda está vacía.
- Rellena `Fecha Anticipo` solo si la celda está vacía y el banco trae fecha válida.

### 6.2 Estado `ANTICIPADA`
| Condición | Estado |
|-----------|--------|
| Importe anticipado = 0 | `NO ANTICIPADA` |
| Importe anticipado > 0 e igual al importe total | `ANTICIPADA` |
| Importe anticipado > 0 y distinto del importe total | `ANTICIPO PARCIAL` |

### 6.3 Estado `ESTADO`
- **Bloqueado** (no se modifica) si ya es `CANCELADA` o `CAIDA FINANCIACION`.
- Con datos de cobros:
  - Si el valor es `COBRO` o `0` → `PAGADA`
  - En otro caso → `REVIEW INVOICE` (celda con fondo azul)

### 6.4 Normalización de número de factura
- En hoja `EMITIDO`: se eliminan ceros a la izquierda para la clave interna.
- En archivos bancarios: si el formato tiene más de 2 partes separadas por `-`, se usa la segunda parte.

---

## 7. Sistema de auditoría (doble capa)

### Capa 1 — `Audit Log` (Helper.js)
Registra cada ejecución con:
- Timestamp, usuario, nº correos procesados, facturas modificadas, detalle por origen (anticipo/cobros), duración.

### Capa 2 — `repasoAudit log` (Audit.js)
- Lee las **últimas 10 ejecuciones** del `Audit Log`.
- Acumula todas las facturas modificadas.
- Verifica coherencia entre `Importe` e `Importe anticipado`.
- Corrige `ANTICIPADA` si no coincide con la lógica esperada.

---

## 8. Estado actual del proyecto

| Aspecto | Estado |
|---------|--------|
| Flujo principal (manual + automático) | ✅ Implementado y funcional |
| Conversión XLS → datos | ✅ Implementado (requiere Drive API) |
| Actualización quirúrgica de celdas | ✅ Implementado |
| Log de ejecución | ✅ Implementado |
| Auditoría post-ejecución | ✅ Implementado |
| Menú de usuario | ✅ Implementado |
| Documentación interna | ⚠️ Parcial (comentarios en código) |
| Tests automatizados | ❌ No existen (solo función manual de prueba) |

---

## 9. Observaciones técnicas / puntos de atención

### ⚠️ Posibles mejoras o inconsistencias detectadas

1. **Función duplicada:** `extractInvoiceNumber()` está definida en `Helper.js` (final) y en `Logic.js`. En Apps Script ambas coexisten; conviene dejar una sola copia.

2. **`lastRunTime` no se usa en búsqueda automática:** `getStoredLastRunTimestamp()` se lee en `Code.js`, pero `calculateSearchDateRange()` ignora ese valor en modo automático y siempre busca `newer_than:1d` (24h). El timestamp solo se guarda al final, no influye en el rango de búsqueda incremental.

3. **Desajuste de claves de factura en auditoría:** El proceso principal normaliza quitando ceros iniciales; la auditoría busca por el ID tal como aparece en el log, sin esa normalización. Puede fallar el match si hay ceros a la izquierda.

4. **Trigger `crearTriggerDiario()`:** Programa `auditLastRunModifications`, no `dailyTriggerExecution`. El nombre sugiere el proceso principal, pero ejecuta la auditoría a las 2:00 AM.

5. **Comentario JSDoc malformado en `Code.js`:** Líneas 7-10 tienen un bloque de comentario duplicado/incompleto.

6. **Escritura celda a celda:** `applyUpdatesToSheet()` hace `setValue` individual por celda. Funciona, pero puede ser lento con muchas actualizaciones.

7. **Permisos requeridos:** Gmail, Spreadsheet, Drive (incl. Drive API avanzada para `Drive.Files.copy`), Script Properties, Triggers.

---

## 10. Dependencias y configuración necesaria

- [ ] Google Spreadsheet con hoja `EMITIDO` y columnas requeridas
- [ ] Proyecto Apps Script vinculado al spreadsheet
- [ ] **Drive API** habilitada en el proyecto (Servicios avanzados de Google)
- [ ] Permisos de Gmail concedidos al script
- [ ] (Opcional) Trigger para `dailyTriggerExecution` — **no hay función helper para crearlo**
- [ ] (Opcional) Ejecutar `crearTriggerDiario()` para auditoría automática

---

## 11. Resumen ejecutivo

**Control Factoring** es un sistema maduro de automatización para conciliar facturas de factoring con informes bancarios por correo. Tiene un flujo principal bien estructurado en 4 módulos, reglas de negocio claras, actualización selectiva de celdas y doble sistema de trazabilidad (log de ejecución + auditoría correctiva).

El proyecto está **operativo** para uso en producción con las configuraciones indicadas. Los principales riesgos son inconsistencias menores en matching de facturas, el rango de búsqueda fijo de 24h (sin uso real del timestamp incremental) y la necesidad de alinear qué función dispara cada trigger automático.

---

*Documento generado como hoja de estado del proyecto Control Factoring.*
