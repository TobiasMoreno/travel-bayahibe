const SPREADSHEET_ID = "17YIMlGoyO4UPnLpPLtsj3FEJUrMXPabewKSyh4MQzZI";
const SHEET_NAME = "Pagos";
const ALLOWED_TRAVELERS = ["Andy", "Cata", "Tobi", "Vale"];
const RECEIPT_HEADERS = ["Comprobante_Asset_ID", "Comprobante_Public_ID", "Comprobante_Tipo", "Comprobante_URL", "Comprobante_Nombre"];

function doGet(e) {
  if (!isAuthorized_(e && e.parameter && e.parameter.secret)) return json_({ ok: false, error: "No autorizado." });
  return json_({ ok: true, payments: listPayments_() });
}

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  if (!isAuthorized_(body.secret)) return json_({ ok: false, error: "No autorizado." });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const payment = body.payment || {};
    if (body.action === "create") createPayment_(payment);
    else if (body.action === "update") updatePayment_(payment);
    else if (body.action === "delete") deletePayment_(payment.id);
    else return json_({ ok: false, error: "Acción no válida." });
    return json_({ ok: true, payments: listPayments_() });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No existe la pestaña Pagos.");
  const headerRange = sheet.getRange(1, 6, 1, RECEIPT_HEADERS.length);
  const currentHeaders = headerRange.getValues()[0];
  if (currentHeaders.join("") !== RECEIPT_HEADERS.join("")) headerRange.setValues([RECEIPT_HEADERS]);
  return sheet;
}

function listPayments_() {
  const values = getSheet_().getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).filter(function(row) { return row[1]; }).map(function(row) {
    return {
      id: String(row[0] || ""),
      name: String(row[1] || ""),
      amount: Number(row[2] || 0),
      date: row[3] instanceof Date ? Utilities.formatDate(row[3], "UTC", "yyyy-MM-dd") : String(row[3] || ""),
      note: String(row[4] || ""),
      receipt: row[5] ? {
        assetId: String(row[5] || ""),
        publicId: String(row[6] || ""),
        resourceType: String(row[7] || "image"),
        url: String(row[8] || ""),
        name: String(row[9] || "Comprobante")
      } : null
    };
  });
}

function createPayment_(payment) {
  validatePayment_(payment);
  const id = "p_" + new Date().getTime() + "_" + Math.random().toString(36).slice(2, 8);
  const receipt = receiptValues_(payment.receipt);
  getSheet_().appendRow([id, payment.name, Number(payment.amount), payment.date || "", payment.note || ""].concat(receipt));
}

function updatePayment_(payment) {
  validatePayment_(payment);
  const row = findRow_(payment.id);
  const sheet = getSheet_();
  const existingReceipt = sheet.getRange(row, 6, 1, RECEIPT_HEADERS.length).getValues()[0];
  const receipt = Object.prototype.hasOwnProperty.call(payment, "receipt") ? receiptValues_(payment.receipt) : existingReceipt;
  sheet.getRange(row, 1, 1, 10).setValues([[payment.id, payment.name, Number(payment.amount), payment.date || "", payment.note || ""].concat(receipt)]);
}

function receiptValues_(receipt) {
  if (!receipt || !receipt.assetId || !receipt.url) return ["", "", "", "", ""];
  return [
    String(receipt.assetId),
    String(receipt.publicId || ""),
    String(receipt.resourceType || "image"),
    String(receipt.url),
    String(receipt.name || "Comprobante")
  ];
}

function deletePayment_(id) {
  const row = findRow_(id);
  getSheet_().deleteRow(row);
}

function findRow_(id) {
  if (!id) throw new Error("Falta el identificador del pago.");
  const ids = getSheet_().getRange(2, 1, Math.max(getSheet_().getLastRow() - 1, 1), 1).getValues();
  for (let index = 0; index < ids.length; index++) {
    if (String(ids[index][0]) === String(id)) return index + 2;
  }
  throw new Error("No encontré ese pago.");
}

function validatePayment_(payment) {
  if (ALLOWED_TRAVELERS.indexOf(payment.name) === -1) throw new Error("Viajero no válido.");
  if (!(Number(payment.amount) > 0)) throw new Error("El monto debe ser mayor que cero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payment.date || ""))) throw new Error("La fecha no es válida.");
}

function isAuthorized_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET");
  return Boolean(expected && secret && expected === secret);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
