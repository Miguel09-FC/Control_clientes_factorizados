// --- Helper.gs ---

// Note: Global constants are assumed to be defined in Code.gs

/**
 * Stores the current execution timestamp for the next run's search.
 */
function storeCurrentRunTimestamp(timestamp) {
  PropertiesService.getScriptProperties().setProperty(SCRIPT_PROPERTIES_KEY, timestamp.toISOString());
}

/**
 * Retrieves the last stored execution timestamp.
 */
function getStoredLastRunTimestamp() {
  const properties = PropertiesService.getScriptProperties();
  const lastRunIso = properties.getProperty(SCRIPT_PROPERTIES_KEY);
  return lastRunIso ? new Date(lastRunIso) : null;
}

/**
 * Calculates the dynamic search date range for Gmail.
 * CAMBIO: Ahora acepta customHours (opcional).
 */
function calculateSearchDateRange(lastRunTime, currentRunTime, customHours) {
  let query = '';
  let uiStart = currentRunTime;
  const commonSender = "from:fycout@gruposantander.es";

  // Lógica A: Si el usuario especificó horas manualmente
  if (customHours && customHours > 0) {
    // Calculamos la fecha de inicio restando las horas en milisegundos
    // (Horas * 60 min * 60 seg * 1000 ms)
    const msToSubtract = customHours * 60 * 60 * 1000;
    uiStart = new Date(currentRunTime.getTime() - msToSubtract);
    
    // Usamos el operador de horas de Gmail 'h'
    // Math.ceil para asegurar que cubrimos el rango completo si hay decimales
    query = `newer_than:${Math.ceil(customHours)}h`;
    
  } else {
    // Lógica B: Lógica original (Defecto / Trigger Diario)
    const twentyFourHoursAgo = new Date(currentRunTime.getTime() - (24 * 60 * 60 * 1000));
    uiStart = twentyFourHoursAgo;
    query = `newer_than:1d`;
  }
  
  // Añadimos el filtro del emisor
  query = `${commonSender} ${query}`;

  Logger.log(`[SEARCH CONFIG] Query: ${query} | Start Time Approx: ${uiStart}`);
  return { gmailQuery: query, uiStart: uiStart };
}

/**
 * Reads all data from the target sheet and returns it as a keyed object.
 */
function getSheetData(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length <= 1) return {};

  const headers = values[0];
  const invoiceIndex = headers.indexOf("Número factura");
  if (invoiceIndex === -1) throw new Error("Crucial column 'Número factura' not found in EMITIDO sheet.");
  const colIndices = {
    invoice: invoiceIndex,
    importeAnticipado: headers.indexOf("Importe anticipado"),
    moneda: headers.indexOf("Moneda"),
    fechaAnticipo: headers.indexOf("Fecha Anticipo"),
    importe: headers.indexOf("Importe"),
    anticipada: headers.indexOf("ANTICIPADA"),
    estado: headers.indexOf("ESTADO"),
  };
  if (Object.values(colIndices).includes(-1)) throw new Error("One or more required columns are missing.");

  const data = {};
  for (let i = 1; i < values.length; i++) {
    const rawInvoice = String(values[i][invoiceIndex] || "").trim();
    const invoiceKey = rawInvoice.replace(/^0+/, '');
    
    if (invoiceKey) {
      data[invoiceKey] = {
        rowData: values[i],
        rowIndex: i + 1,
        colIndices: colIndices
      };
    }
  }
  Logger.log(`[SHEET] Se han cargado ${Object.keys(data).length} facturas del Excel.`);
  return data;
}

/**
 * REESCRITURA QUIRÚRGICA: Solo actualiza las columnas específicas.
 */
function applyUpdatesToSheet(sheet, updatedData) {
  const updates = [];
  const backgrounds = [];
  let rowCount = 0;

  for (const invoiceKey in updatedData) {
    const item = updatedData[invoiceKey];
    if (item.needsUpdate) {
      const row = item.rowIndex;
      const cols = item.colIndices;
      const data = item.rowData; 
      
      // 1. Actualizar Importe Anticipado
      updates.push({
        row: row,
        col: cols.importeAnticipado + 1,
        val: data[cols.importeAnticipado]
      });

      // 2. Actualizar Moneda
      updates.push({
        row: row,
        col: cols.moneda + 1,
        val: data[cols.moneda]
      });

      // 3. Actualizar Fecha Anticipo
      updates.push({
        row: row,
        col: cols.fechaAnticipo + 1,
        val: data[cols.fechaAnticipo]
      });

      // 4. Actualizar Estado ANTICIPADA
      updates.push({
        row: row,
        col: cols.anticipada + 1,
        val: data[cols.anticipada]
      });

      // 5. Actualizar ESTADO General
      updates.push({
        row: row,
        col: cols.estado + 1,
        val: data[cols.estado]
      });

      // Gestionar color de fondo
      if (data[cols.estado] === 'REVIEW INVOICE') {
        backgrounds.push(sheet.getRange(row, cols.estado + 1).getA1Notation());
      }
      
      rowCount++;
    }
  }

  if (rowCount === 0) {
    Logger.log("No updates to apply to the sheet.");
    return;
  }

  const colUpdates = {};
  updates.forEach(u => {
    if (!colUpdates[u.col]) colUpdates[u.col] = [];
    colUpdates[u.col].push({ row: u.row, val: u.val });
 });
 
 for (const colIndex in colUpdates) {
    const cellUpdates = colUpdates[colIndex];
    cellUpdates.forEach(update => {
       sheet.getRange(update.row, parseInt(colIndex)).setValue(update.val);
    });
 }

 if (backgrounds.length > 0) {
   sheet.getRangeList(backgrounds).setBackground('blue');
   Logger.log(`Applied blue background to ${backgrounds.length} cells.`);
 }
 Logger.log(`Successfully updated ${rowCount} invoices (Surgical Mode).`);
}

/**
 * Records the script run details to the Audit Log sheet.
 */
function logAudit(sheetName, startTime, user, emailCounts, updatedInvoiceCount, modifiedInvoices, invoicesFromAnticipo, invoicesFromCobros) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow([
        "Timestamp", 
        "User", 
        "Anticipo Emails", 
        "Cobros Emails", 
        "Invoices Updated", 
        "Modified Invoices List", 
        "Detalle Anticipos", 
        "Detalle Cobros", 
        "Duration (s)"
    ]);
    sheet.getRange("A1:I1").setFontWeight("bold"); 
  }

  const durationSeconds = (new Date().getTime() - startTime.getTime()) / 1000;
  
  sheet.appendRow([
    startTime,
    user,
    emailCounts.anticipo,
    emailCounts.cobros,
    updatedInvoiceCount,
    modifiedInvoices.join(', '),     
    invoicesFromAnticipo.join(', '), 
    invoicesFromCobros.join(', '),    
    durationSeconds.toFixed(2)
  ]);
  
  sheet.getRange(sheet.getLastRow(), 1, 1, sheet.getLastColumn()).setHorizontalAlignment("center");
}

/**
 * Convert XLS Attachment to Data using Drive API
 */
function convertXlsAttachmentToData(attachment) {
  if (attachment.getSize() === 0) {
    throw new Error("Attachment is empty.");
  }

  const blob = attachment.copyBlob();
  let tempFileXls = null;
  let tempFileGsheet = null;

  try {
    tempFileXls = DriveApp.createFile(blob).setName(attachment.getName().replace(/\.xls/i, '') + ' - TEMP_XLS');
    const xlsFileId = tempFileXls.getId();

    const resource = {
      name: attachment.getName().replace(/\.xls/i, '') + ' - TEMP_GSHEET',
      mimeType: 'application/vnd.google-apps.spreadsheet' 
    };
    
    tempFileGsheet = Drive.Files.copy(resource, xlsFileId);
    const gsheetId = tempFileGsheet.id;

    const tempSpreadsheet = SpreadsheetApp.openById(gsheetId);
    
    const sheets = tempSpreadsheet.getSheets();
    let data = null;
    let foundData = false;
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      const dataRange = sheet.getDataRange();
      if (dataRange.getHeight() > 1 || dataRange.getWidth() > 1) {
        data = dataRange.getValues();
        foundData = true;
        break;
      }
    }

    if (!foundData) {
      throw new Error("El archivo convertido no contenía datos en ninguna de sus hojas.");
    }
     
    DriveApp.getFileById(xlsFileId).setTrashed(true);
    DriveApp.getFileById(gsheetId).setTrashed(true);
    
    return data;

  } catch (e) {
    try {
      if (tempFileXls) DriveApp.getFileById(tempFileXls.getId()).setTrashed(true);
      if (tempFileGsheet) DriveApp.getFileById(tempFileGsheet.getId()).setTrashed(true);
    } catch (cleanUpError) {}
    
    throw new Error(`Falló la conversión avanzada de ${attachment.getName()}. Detalles: ${e.message}`);
  }
}

/**
 * Processes bank emails
 */
function processBankEmails(baseQuery) {
  const anticipoData = {};
  const cobrosData = {};
  const emailCounts = { anticipo: 0, cobros: 0 };
  const anticipoQuery = `${baseQuery} subject:"Factoring - Detalle anticipo"`;
  const cobrosQuery = `${baseQuery} subject:"Factoring - Cobros y Expiración de Financiación"`;

  const processThreads = (query, extractor) => {
    const threads = GmailApp.search(query);
    threads.forEach(thread => {
      thread.getMessages().forEach(message => {
        message.getAttachments().forEach(attachment => {
          if (attachment.getName().toLowerCase().endsWith('.xls')) {
            try {
              const data = convertXlsAttachmentToData(attachment);
              extractor(data);
            } catch (e) {
              Logger.log(`Skipping attachment due to error: ${e.message}`);
            }
          }
        });
      });
    });
    return threads.length;
  };

  emailCounts.anticipo = processThreads(anticipoQuery, (data) => extractAnticipoData(data, anticipoData));
  emailCounts.cobros = processThreads(cobrosQuery, (data) => extractCobrosData(data, cobrosData));

  return { anticipoData, cobrosData, emailCounts };
}

function cleanHeader(headerString) {
  const str = String(headerString || '');
  return str.replace(/\u00A0/g, " ").trim();
}

function findHeaderRow(data, keyColumnName) {
  const scanLimit = Math.min(data.length, 10); 

  for (let i = 0; i < scanLimit; i++) {
    const row = data[i];
    const cleanedHeaders = row.map(h => cleanHeader(h));
    
    if (cleanedHeaders.indexOf(keyColumnName) !== -1) {
      return { headers: cleanedHeaders, rowIndex: i };
    }
  }
  throw new Error(`No se pudo encontrar la fila de cabecera con la columna '${keyColumnName}'.`);
}

function extractAnticipoData(data, storage) {
  try {
    const { headers, rowIndex } = findHeaderRow(data, "NUM.FACTURA");
    
    // 1. Búsqueda robusta de columnas (por si el banco cambia espacios)
    let idxFecha = headers.indexOf("FECHA VALOR ANTICIPO");
    // Si no encuentra la exacta, busca una que contenga las palabras clave
    if (idxFecha === -1) {
      idxFecha = headers.findIndex(h => h.includes("FECHA") && h.includes("ANTICIPO"));
    }

    const colMap = {
      invoice: headers.indexOf("NUM.FACTURA"),
      moneda: headers.indexOf("MONEDA"),
      importe: headers.indexOf("IMP. ANTICIPO"),
      fecha: idxFecha
    };
    
    if (colMap.invoice === -1 || colMap.importe === -1 || colMap.fecha === -1) {
       Logger.log("⚠️ Saltando archivo: No se encuentran columnas críticas (Factura, Importe o Fecha).");
       return;
    }
    
    for (let i = rowIndex + 1; i < data.length; i++) {
      const row = data[i];
      if (row.length < Object.keys(colMap).length) continue;
      
      const rawInvoice = String(row[colMap.invoice] || "").trim();
      if (!rawInvoice) continue;
    
      const invoiceKey = extractInvoiceNumber(rawInvoice);
    
      // 2. CORRECCIÓN DE FECHA: Mantenemos el tipo de dato original
      let valFecha = row[colMap.fecha];
      let cleanFecha = null;

      if (valFecha instanceof Date) {
        cleanFecha = valFecha; // ¡Es una fecha real! La guardamos tal cual.
      } else if (typeof valFecha === 'string' && valFecha.trim() !== "") {
        cleanFecha = valFecha.trim(); // Es texto, lo guardamos limpio.
      }

      storage[invoiceKey] = {
        importeAnticipo: String(row[colMap.importe] || "").trim(),
        moneda: String(row[colMap.moneda] || "").trim(),
        fechaAnticipo: cleanFecha // Guardamos el dato corregido
      };
    }
  } catch (e) {
     Logger.log(`Error crítico en extractAnticipoData: ${e.message}`);
  }
}

function extractCobrosData(data, storage) {
  try {
    const { headers, rowIndex } = findHeaderRow(data, "FACTURA");

    const colMap = {
      invoice: headers.indexOf("FACTURA"),
      statusValue: headers.indexOf("(-CARGO)(+ABONO)")
    };
    
    if (Object.values(colMap).includes(-1)) {
      return;
    }
    
    for (let i = rowIndex + 1; i < data.length; i++) {
      const row = data[i];
      if (row.length < Object.keys(colMap).length) continue;

      const rawInvoice = String(row[colMap.invoice] || "").trim();
      if (!rawInvoice) continue;
    
      const invoiceKey = extractInvoiceNumber(rawInvoice);
    
      storage[invoiceKey] = {
        statusValue: String(row[colMap.statusValue] || "").trim()
      };
    }
  } catch (e) {
     Logger.log(`Error crítico en extractCobrosData: ${e.message}`);
  }
}

// --- Logic.gs ---
// (Lógica adicional si se requiere en un futuro)
function extractInvoiceNumber(rawInvoice) {
  const raw = String(rawInvoice || '').trim();
  const parts = raw.split('-');
  if (parts.length > 2) {
    return parts[1].trim();
  }
  return raw;
}