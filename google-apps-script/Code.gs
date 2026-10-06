const SPREADSHEET_ID = "17YIMlGoyO4UPnLpPLtsj3FEJUrMXPabewKSyh4MQzZI";
const SHEET_NAME = "Pagos";
const ALLOWED_TRAVELERS = ["Andy", "Cata", "Tobi", "Vale"];

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
      note: String(row[4] || "")
    };
  });
}

function createPayment_(payment) {
  validatePayment_(payment);
  const id = "p_" + new Date().getTime() + "_" + Math.random().toString(36).slice(2, 8);
  getSheet_().appendRow([id, payment.name, Number(payment.amount), payment.date || "", payment.note || ""]);
}

function updatePayment_(payment) {
  validatePayment_(payment);
  const row = findRow_(payment.id);
  getSheet_().getRange(row, 1, 1, 5).setValues([[payment.id, payment.name, Number(payment.amount), payment.date || "", payment.note || ""]]);
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
