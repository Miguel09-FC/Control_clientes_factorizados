// --- Logic.gs ---

/**
 * Extracts the clean invoice number from the hyphenated string.
 */
function extractInvoiceNumber(rawInvoice) {
  const raw = String(rawInvoice || '').trim();
  const parts = raw.split('-');
  if (parts.length > 2) {
    return parts[1].trim();
  }
  return raw;
}

/**
 * Converts a European formatted number string ("1.234,56") to a JS number (1234.56).
 */
function parseEuropeanNumber(euValue) {
  const euNumberStr = String(euValue || '').trim();
  if (!euNumberStr) return 0;
  const cleanStr = euNumberStr.replace(/\./g, '').replace(/,/g, '.');
  const num = parseFloat(cleanStr);
  return isNaN(num) ? 0 : num;
}

/**
 * Main logic function to merge bank data with sheet data and calculate new statuses.
 * MODIFICADO: Ahora calcula tres listas de modificaciones (General, Anticipo, Cobro).
 */
function mergeAndCalculateUpdates(sheetData, anticipoData, cobrosData) {
  let updatedInvoiceCount = 0;
  
  // 1. Lista General (Original)
  const modifiedInvoices = [];
  // 2. Listas de Detalle (Nuevas)
  const invoicesFromAnticipo = [];
  const invoicesFromCobros = [];

  for (const invoiceKey in sheetData) {
    const item = sheetData[invoiceKey];
    const rowData = item.rowData;
    const colIndices = item.colIndices;
    let needsUpdate = false;
    
    // Flags para detectar origen del cambio en esta iteración
    let touchedByAnticipo = false;
    let touchedByCobro = false;

    // Variables for external data
    const anticipo = anticipoData[invoiceKey];
    const cobros = cobrosData[invoiceKey];
    
    // --- CRITICAL CHECK ---
    if (!anticipo && !cobros) {
        continue;
    }
    // --- END CRITICAL CHECK ---

    // --- 1. Process Anticipo Data (If present) ---
    if (anticipo) {
      
      // a. Importe anticipado
      const currentAnticipadoValue = String(rowData[colIndices.importeAnticipado] || '').trim();
      const newImporteAnticipado = anticipo.importeAnticipo;
      
      if (parseEuropeanNumber(currentAnticipadoValue) !== parseEuropeanNumber(newImporteAnticipado)) {
          rowData[colIndices.importeAnticipado] = newImporteAnticipado;
          needsUpdate = true;
          touchedByAnticipo = true;
      }

      // b. Moneda
      const currentMoneda = String(rowData[colIndices.moneda] || '').trim();
      const newMoneda = anticipo.moneda;
      if (!currentMoneda && newMoneda) {
        rowData[colIndices.moneda] = newMoneda;
        needsUpdate = true;
        touchedByAnticipo = true;
      }

      // c. Fecha Anticipo (CORREGIDO)
      const valEnCelda = rowData[colIndices.fechaAnticipo];
      
      // Verificamos si la celda está visualmente vacía
      let celdaVacia = false;
      if (valEnCelda === "" || valEnCelda === null || valEnCelda === undefined) {
        celdaVacia = true;
      }
      
      // El dato nuevo que viene del Helper (puede ser Objeto Date o Texto)
      const nuevaFechaBanco = anticipo.fechaAnticipo;

      // Solo si la celda está vacía Y el banco trae una fecha válida, actualizamos.
      if (celdaVacia && nuevaFechaBanco) {
        rowData[colIndices.fechaAnticipo] = nuevaFechaBanco;
        needsUpdate = true;
        touchedByAnticipo = true;
      }
      }

    // --- 2. Calculate ANTICIPADA status ---
    const currentImporteStr = String(rowData[colIndices.importe] || '').trim();
    const currentAnticipadoStr = String(rowData[colIndices.importeAnticipado] || '').trim();

    const importe = parseEuropeanNumber(currentImporteStr);
    const importeAnticipado = parseEuropeanNumber(currentAnticipadoStr);

    let newAnticipadaStatus = rowData[colIndices.anticipada];
    
    // Si hay datos de anticipo, recalculamos el status
    if (anticipo) {
        if (importeAnticipado > 0) {
            if (importe === importeAnticipado) {
                newAnticipadaStatus = 'ANTICIPADA';
            } else if (importe !== importeAnticipado) {
                newAnticipadaStatus = 'ANTICIPO PARCIAL';
            }
        } else if (importeAnticipado === 0 && importe > 0) {
            newAnticipadaStatus = 'NO ANTICIPADA';
        } else {
            newAnticipadaStatus = 'NO ANTICIPADA';
        }
    }

    if (rowData[colIndices.anticipada] !== newAnticipadaStatus) {
      rowData[colIndices.anticipada] = newAnticipadaStatus;
      needsUpdate = true;
      touchedByAnticipo = true;
    }

    // --- 3. Calculate ESTADO (Subject to Block Rule) ---
    const currentEstado = String(rowData[colIndices.estado] || '').toUpperCase().trim();
    const isEstadoBlocked = (currentEstado === 'CANCELADA' || currentEstado === 'CAIDA FINANCIACION');
    
    if (!isEstadoBlocked) {
        let newEstado = rowData[colIndices.estado];

        if (cobros) { 
            const rawStatusValue = String(cobros.statusValue || '').trim().toUpperCase();

            if (rawStatusValue === 'COBRO' || parseEuropeanNumber(cobros.statusValue) === 0) {
                newEstado = 'PAGADA';
            } else {
                newEstado = 'REVIEW INVOICE';
            }
       }
      
       if (rowData[colIndices.estado] !== newEstado) {
           rowData[colIndices.estado] = newEstado;
           needsUpdate = true;
           touchedByCobro = true;
       }
    }

    // --- 4. Final Update Check and Audit Log Tracking ---
    if (needsUpdate) {
      item.needsUpdate = true;
      
      // Lista General (sin duplicados)
      if (!modifiedInvoices.includes(invoiceKey)) {
        modifiedInvoices.push(invoiceKey);
      }
      
      // Listas de Detalle
      if (touchedByAnticipo) invoicesFromAnticipo.push(invoiceKey);
      if (touchedByCobro) invoicesFromCobros.push(invoiceKey);
      
      updatedInvoiceCount++;
    }
  } // End main loop

  return { 
    updatedData: sheetData, 
    updatedInvoiceCount: modifiedInvoices.length, 
    modifiedInvoices, 
    invoicesFromAnticipo, 
    invoicesFromCobros 
  };
}