// --- Code.gs ---

const SCRIPT_PROPERTIES_KEY = 'lastRunTimestamp';
const SHEET_NAME = "EMITIDO";
const AUDIT_LOG_SHEET = "Audit Log";

/**
 * Creates the custom menu on the Google Sheet interface.
/**
 * Creates the custom menu on the Google Sheet interface.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Review Factoring Invoices')
    .addItem('▶️ Ejecutar Manual (Elegir Horas)', 'mainReviewFactoring') 
    .addSeparator() // Línea visual para separar las acciones
    .addItem('🛡️ Revisar/Corregir (Audit Log)', 'auditLastRunModifications')
    .addToUi();
}
/**
 * PUNTO DE ENTRADA 1: Ejecución Manual.
 * Pregunta al usuario cuántas horas quiere revisar.
 */
function mainReviewFactoring() {
  const ui = SpreadsheetApp.getUi();
  
  // Preguntar al usuario por las horas
  const result = ui.prompt(
    'Configuración de búsqueda',
    'Introduce el número de horas hacia atrás que quieres revisar (ej: 24, 48, 72):\nDejar vacío usa el defecto (24h).',
    ui.ButtonSet.OK_CANCEL
  );

  // Si el usuario cancela, paramos el script
  if (result.getSelectedButton() == ui.Button.CANCEL) {
    ui.alert('Operación cancelada.');
    return;
  }

  // Obtenemos el texto y tratamos de convertirlo a número
  const inputText = result.getResponseText();
  let customHours = null;

  if (inputText && inputText.trim() !== "") {
    const parsed = parseFloat(inputText);
    if (!isNaN(parsed) && parsed > 0) {
      customHours = parsed;
    } else {
      ui.alert('Error', 'Por favor, introduce un número válido de horas.', ui.ButtonSet.OK);
      return;
    }
  }

  // Llamamos a la lógica interactiva pasando las horas personalizadas
  executeFactoringProcess(true, customHours);
}

/**
 * PUNTO DE ENTRADA 2: Ejecución Automática (Trigger).
 * Mantiene la lógica intacta: isInteractive = false, customHours = null.
 */
function dailyTriggerExecution() {
  executeFactoringProcess(false, null);
}

/**
 * Lógica central unificada.
 * @param {boolean} isInteractive - Si es true, usa ui.alert.
 * @param {number|null} customHours - Número de horas a revisar. Si es null, usa lógica por defecto.
 */
function executeFactoringProcess(isInteractive, customHours) {
  const startTime = new Date();
  let ui = null;

  if (isInteractive) {
    try { ui = SpreadsheetApp.getUi(); } catch (e) { isInteractive = false; }
  }

  try {
    // 1. Calcular rango de fechas (Pasamos customHours al helper)
    const lastRunTime = getStoredLastRunTimestamp();
    // CAMBIO IMPORTANTE AQUÍ: Pasamos el tercer argumento
    const { gmailQuery, uiStart } = calculateSearchDateRange(lastRunTime, startTime, customHours);

    const alertStartTime = uiStart instanceof Date ? uiStart.toLocaleString() : startTime.toLocaleString();
    const hoursMsg = customHours ? `${customHours} horas` : `24 horas`;
    const startMsg = `Starting Review. Searching emails newer than ${hoursMsg} ago (approx ${alertStartTime}).`;
    
    if (isInteractive && ui) {
      ui.alert(startMsg); // Alerta inicial informativa
    } else {
      Logger.log(startMsg);
    }

    // 2. Search emails and process attachments
    const { anticipoData, cobrosData, emailCounts } = processBankEmails(gmailQuery);

    // 3. Load target sheet data
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error(`Target sheet "${SHEET_NAME}" not found.`);

    const sheetData = getSheetData(sheet); 

    // 4. Merge and calculate updates
    const { updatedData, updatedInvoiceCount, modifiedInvoices, invoicesFromAnticipo, invoicesFromCobros } = mergeAndCalculateUpdates(sheetData, anticipoData, cobrosData);

    // 5. Write updates back to the sheet
    applyUpdatesToSheet(sheet, updatedData);

    // 6. Finalize and Log
    storeCurrentRunTimestamp(startTime);
    
    let currentUser = Session.getActiveUser().getEmail();
    if (!currentUser) currentUser = "Auto-Trigger"; 

    // Añadimos una nota en el log si fue manual con horas personalizadas
    if (customHours) {
        currentUser += ` (Manual: ${customHours}h)`;
    }

    logAudit(AUDIT_LOG_SHEET, startTime, currentUser, emailCounts, updatedInvoiceCount, modifiedInvoices, invoicesFromAnticipo, invoicesFromCobros);

    const successTitle = '✅ Success!';
    const successMsg = `Factoring review complete. ${updatedInvoiceCount} unique invoices updated. See Audit Log for details.`;

    if (isInteractive && ui) {
      ui.alert(successTitle, successMsg, ui.ButtonSet.OK);
    } else {
      Logger.log(`${successTitle} - ${successMsg}`);
    }

  } catch (e) {
    const errorMsg = `⚠️ An error occurred during the Factoring Review: ${e.message}`;
    Logger.log(errorMsg);
    if (isInteractive && ui) {
      ui.alert('Error', errorMsg, ui.ButtonSet.OK);
    }
  }
}

// --- Funciones de utilidad y test ---
function forzar_permisos_drive() { Drive.About.get({ fields: "user" }); }

function test_conversion_directa() {
 const fileId = "1XADIjXzgJ2RQj5PmYFh-OVC43ct1u3wW"; 
 try {
   const tempSpreadsheet = SpreadsheetApp.openById(fileId);
   const sheet = tempSpreadsheet.getSheets()[0];
   Logger.log("¡ÉXITO! Hoja: " + sheet.getName());
 } catch (e) {
   Logger.log("¡FALLÓ! " + e.message);
 }
}