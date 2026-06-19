// --- Audit.gs ---

const AUDIT_SHEET_NAME = "repasoAudit log";
const MAIN_LOG_SHEET_NAME = "Audit Log"; // Nombre de la hoja donde se guarda el log principal
const TARGET_SHEET_NAME = "EMITIDO"; // Nombre de tu hoja de facturas

/**
* AUDITORÍA POST-EJECUCIÓN (AMPLIADA A 10 ÚLTIMOS LOGS)
* 1. Lee las últimas 10 filas de "Audit Log" para acumular todas las facturas tocadas recientemente.
* 2. Busca esas facturas en la hoja "EMITIDO".
* 3. Verifica la coherencia entre "Importe" e "Importe Anticipado".
* 4. Corrige el estado "ANTICIPADA" si es necesario.
*/
function auditLastRunModifications() {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 let ui = null;
 try { ui = SpreadsheetApp.getUi(); } catch(e) {} // Permite que funcione en segundo plano sin dar error

 // 1. OBTENER LISTA DE FACTURAS DE LOS ÚLTIMOS 10 LOGS
 const logSheet = ss.getSheetByName(MAIN_LOG_SHEET_NAME);
 if (!logSheet) {
   const msg = `Error: No se encuentra la hoja "${MAIN_LOG_SHEET_NAME}". Ejecuta el script principal primero.`;
   Logger.log(msg);
   if(ui) ui.alert(msg);
   return;
 }

 const lastRow = logSheet.getLastRow();
 if (lastRow < 2) {
   const msg = "Error: No hay registros en el Audit Log.";
   Logger.log(msg);
   if(ui) ui.alert(msg);
   return;
 }

 // --- CAMBIO: LÓGICA PARA 10 FILAS ---
 const NUM_LOGS_TO_CHECK = 10;
 // Calculamos la fila de inicio. Si hay menos de 10 filas, empezamos en la 2 (después de cabecera).
 const startRow = Math.max(2, lastRow - NUM_LOGS_TO_CHECK + 1);
 
 let rawInvoiceSet = new Set(); // Usamos un Set para evitar duplicados automáticamente

 // Recorremos desde la fila de inicio hasta la última
 for (let r = startRow; r <= lastRow; r++) {
    // Columna 6 es la lista de "Modified Invoices"
    const cellValue = String(logSheet.getRange(r, 6).getValue());
    
    if (cellValue && cellValue.trim() !== "") {
        // Separamos por comas y añadimos al Set
        const ids = cellValue.split(',').map(s => s.trim()).filter(s => s !== "");
        ids.forEach(id => rawInvoiceSet.add(id));
    }
 }

 // Convertimos el Set de vuelta a un Array
 const invoicesToAudit = Array.from(rawInvoiceSet);

 if (invoicesToAudit.length === 0) {
   const msg = `Las últimas ${NUM_LOGS_TO_CHECK} ejecuciones no modificaron ninguna factura. No hay nada que auditar.`;
   Logger.log(msg);
   if(ui) ui.alert(msg);
   return;
 }
 // --- FIN CAMBIO ---

 if(ui) ui.alert(`Iniciando revisión acumulada de ${invoicesToAudit.length} facturas (basado en los últimos ${NUM_LOGS_TO_CHECK} logs)...`);
 Logger.log(`Iniciando revisión de ${invoicesToAudit.length} facturas...`);


 // 2. PREPARAR HOJA DE DESTINO
 const targetSheet = ss.getSheetByName(TARGET_SHEET_NAME);
 if (!targetSheet) {
   const msg = `Error: No se encuentra la hoja "${TARGET_SHEET_NAME}"`;
   Logger.log(msg);
   if(ui) ui.alert(msg);
   return;
 }

 // Leer toda la data para buscar rápido
 const dataRange = targetSheet.getDataRange();
 const values = dataRange.getValues();
 const headers = values[0];

 // Mapeo de columnas
 const colIndices = {
   numeroFactura: headers.indexOf("Número factura"), 
   importe: headers.indexOf("Importe"),             
   importeAnticipado: headers.indexOf("Importe anticipado"), 
   anticipada: headers.indexOf("ANTICIPADA")        
 };

 if (Object.values(colIndices).includes(-1)) {
   const msg = "Error Crítico: Faltan columnas en EMITIDO.";
   Logger.log(msg);
   if(ui) ui.alert(msg);
   return;
 }

 // Mapa para acceso rápido
 const invoiceRowMap = {};
 for (let i = 1; i < values.length; i++) {
   const invNum = String(values[i][colIndices.numeroFactura]).trim();
   if (invNum) {
     invoiceRowMap[invNum] = i;
   }
 }

 const auditLog = [];
 let fixedCount = 0;

 // 3. REVISAR CADA FACTURA DE LA LISTA ACUMULADA
 for (const invoiceId of invoicesToAudit) {
   const rowIndex = invoiceRowMap[invoiceId]; 

   if (rowIndex === undefined) {
     auditLog.push([new Date(), invoiceId, "ERROR", "-", "-", "No encontrada en hoja EMITIDO"]);
     continue;
   }

   const row = values[rowIndex];
  
   const importeTotal = parseEuropeanNumberForAudit(row[colIndices.importe]);
   const importeAnticipado = parseEuropeanNumberForAudit(row[colIndices.importeAnticipado]);
   const currentStatus = String(row[colIndices.anticipada] || "").trim();

   // --- LÓGICA DE ESTADO ---
   let calculatedStatus = "NO ANTICIPADA"; 

   if (importeAnticipado > 0) {
     if (areAmountsEqualForAudit(importeTotal, importeAnticipado)) {
       calculatedStatus = "ANTICIPADA";
     } else {
       calculatedStatus = "ANTICIPO PARCIAL";
     }
   } else {
        calculatedStatus = "NO ANTICIPADA";
   }

   // --- VERIFICACIÓN Y CORRECCIÓN ---
   if (currentStatus !== calculatedStatus) {
     auditLog.push([
       new Date(),
       invoiceId,
       "Estado ANTICIPADA",
       currentStatus || "VACÍO",
       calculatedStatus,
       "CORREGIDO (Post-Check)"
     ]);

     const sheetRow = rowIndex + 1;
     const statusCol = colIndices.anticipada + 1;
    
     targetSheet.getRange(sheetRow, statusCol).setValue(calculatedStatus);
    
     fixedCount++;
   }
 }

 // 4. GUARDAR LOG
 if (fixedCount > 0) {
   saveAuditLog(auditLog);
   const msg = `✅ Revisión finalizada.\nSe corrigieron ${fixedCount} estados incorrectos de las ${invoicesToAudit.length} facturas revisadas (últimos ${NUM_LOGS_TO_CHECK} logs).\nDetalles en '${AUDIT_SHEET_NAME}'.`;
   Logger.log(msg);
   if(ui) ui.alert(msg);
 } else {
   const msg = `✅ Todo correcto. Las ${invoicesToAudit.length} facturas revisadas (de los últimos ${NUM_LOGS_TO_CHECK} logs) tienen el estado coherente.`;
   Logger.log(msg);
   if(ui) ui.alert(msg);
 }
}


// --- FUNCIONES AUXILIARES ---

function saveAuditLog(logData) {
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 let sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sheet) {
   sheet = ss.insertSheet(AUDIT_SHEET_NAME);
   sheet.appendRow(["Timestamp", "Factura", "Campo", "Valor Anterior", "Valor Nuevo", "Acción"]);
   sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#e0e0e0");
   sheet.setFrozenRows(1);
 }
  if (logData.length > 0) {
   sheet.getRange(sheet.getLastRow() + 1, 1, logData.length, logData[0].length).setValues(logData);
   sheet.autoResizeColumns(1, 6);
 }
}

function parseEuropeanNumberForAudit(euValue) {
 if (typeof euValue === 'number') return euValue;
 let str = String(euValue || '').trim();
 if (!str) return 0;
  if (str.indexOf(',') !== -1) {
    str = str.replace(/\./g, '').replace(/,/g, '.');
 } else if (str.indexOf('.') !== -1) {
    str = str.replace(/\./g, '');
 }
 const num = parseFloat(str);
 return isNaN(num) ? 0 : num;
}

function areAmountsEqualForAudit(amount1, amount2) {
 return Math.abs(amount1 - amount2) < 0.005;
}


// --- FUNCIÓN PARA CREAR EL DISPARADOR (TRIGGER) DIARIO ---

/**
 * Ejecuta esta función UNA SOLA VEZ desde el editor para programar
 * que la revisión se haga de forma automática todos los días.
 */
function crearTriggerDiario() {
  const nombreFuncion = 'auditLastRunModifications';
  
  // 1. Borramos triggers anteriores de esta función para no duplicarlos
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === nombreFuncion) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // 2. Creamos el nuevo trigger (Ej: Todos los días entre las 2 AM y las 3 AM)
  ScriptApp.newTrigger(nombreFuncion)
    .timeBased()
    .everyDays(1)
    .atHour(2) // Puedes cambiar este número (0-23) para elegir a qué hora quieres que se lance
    .create();
    
  Logger.log("✅ Trigger diario creado con éxito. El script se ejecutará todos los días.");
}