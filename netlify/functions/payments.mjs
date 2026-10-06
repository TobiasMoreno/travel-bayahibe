import { createHash } from "node:crypto";

const RECEIPTS_FOLDER = "travel-bayahibe/comprobantes";
const RECEIPTS_TAG = "travel-bayahibe-comprobante";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function callSheetsBridge(payload = null) {
  const url = process.env.SHEETS_WEBAPP_URL;
  const secret = process.env.SHEETS_WEBAPP_SECRET;
  if (!url || !secret) throw new Error("La edición de pagos todavía no está configurada.");
  if (!payload) {
    const response = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, { redirect: "follow" });
    if (!response.ok) throw new Error("Google Sheets no respondió correctamente.");
    return response.json();
  }
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, secret }),
  });
  if (!response.ok) throw new Error("Google Sheets no respondió correctamente.");
  return response.json();
}

function getCloudinaryConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary todavía no está configurado en Netlify.");
  return { cloudName, apiKey, apiSecret };
}

function sign(params, secret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join("&");
  return createHash("sha1").update(`${payload}${secret}`).digest("hex");
}

function escapeContext(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("=", "\\=");
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`;
}

function prepareReceiptUpload(body, config) {
  const traveler = String(body.traveler || "").trim().slice(0, 40);
  const context = `kind=payment_receipt${traveler ? `|traveler=${escapeContext(traveler)}` : ""}`;
  const uploadParams = {
    context,
    folder: RECEIPTS_FOLDER,
    overwrite: false,
    tags: RECEIPTS_TAG,
    timestamp: Math.floor(Date.now() / 1000),
    unique_filename: true,
    use_filename: true,
  };
  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    signature: sign(uploadParams, config.apiSecret),
    uploadParams,
  };
}

async function getReceiptAsset(assetId, config) {
  if (!assetId) throw new Error("Falta identificar el comprobante.");
  const url = new URL(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/by_asset_ids`);
  url.searchParams.append("asset_ids[]", String(assetId));
  url.searchParams.set("tags", "true");
  const response = await fetch(url, { headers: { authorization: authHeader(config) } });
  const data = await response.json().catch(() => ({}));
  const asset = data.resources?.[0];
  if (!response.ok || !asset || !asset.tags?.includes(RECEIPTS_TAG)) {
    throw new Error("El archivo no pertenece a los comprobantes de pagos.");
  }
  return asset;
}

async function normalizeReceipt(receipt, config) {
  if (!receipt?.assetId) return null;
  const asset = await getReceiptAsset(receipt.assetId, config);
  return {
    assetId: asset.asset_id,
    publicId: asset.public_id,
    resourceType: asset.resource_type,
    url: asset.secure_url,
    name: String(receipt.name || "Comprobante").trim().slice(0, 160),
  };
}

async function deleteReceipt(assetId, config) {
  const asset = await getReceiptAsset(assetId, config);
  if (!["image", "video", "raw"].includes(asset.resource_type)) throw new Error("El tipo de comprobante no es válido.");
  const params = { invalidate: true, public_id: asset.public_id, timestamp: Math.floor(Date.now() / 1000) };
  const form = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    api_key: config.apiKey,
    signature: sign(params, config.apiSecret),
  });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/${asset.resource_type}/destroy`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !["ok", "not found"].includes(result.result)) throw new Error("Cloudinary no pudo eliminar el comprobante.");
}

export default async (request) => {
  try {
    if (request.method === "GET") {
      const result = await callSheetsBridge();
      return result.ok ? json(result) : json(result, 502);
    }
    if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

    const body = await request.json();
    if (!process.env.PAYMENTS_PIN || String(body.pin || "") !== process.env.PAYMENTS_PIN) {
      return json({ ok: false, error: "PIN incorrecto." }, 401);
    }

    if (body.action === "signReceipt") {
      const cloudinary = getCloudinaryConfig();
      return json({ ok: true, ...prepareReceiptUpload(body, cloudinary) });
    }
    if (body.action === "discardReceipt") {
      const cloudinary = getCloudinaryConfig();
      await deleteReceipt(body.assetId, cloudinary);
      return json({ ok: true });
    }
    if (!["create", "update", "delete"].includes(body.action)) {
      return json({ ok: false, error: "Acción no válida." }, 400);
    }

    const payment = { ...(body.payment || {}) };
    let previousReceipt = null;
    if (["update", "delete"].includes(body.action)) {
      const current = await callSheetsBridge();
      if (!current.ok) return json(current, 502);
      previousReceipt = current.payments?.find((item) => String(item.id) === String(payment.id))?.receipt || null;
    }
    if (body.action !== "delete" && Object.prototype.hasOwnProperty.call(payment, "receipt")) {
      payment.receipt = payment.receipt?.assetId ? await normalizeReceipt(payment.receipt, getCloudinaryConfig()) : null;
    }

    const result = await callSheetsBridge({ action: body.action, payment });
    if (!result.ok) return json(result, 400);

    const nextAssetId = payment.receipt?.assetId || "";
    const shouldDeletePrevious = previousReceipt?.assetId && (body.action === "delete" || previousReceipt.assetId !== nextAssetId);
    let cleanupWarning = "";
    if (shouldDeletePrevious) {
      try { await deleteReceipt(previousReceipt.assetId, getCloudinaryConfig()); }
      catch (_) { cleanupWarning = "El pago se guardó, pero no se pudo limpiar el comprobante anterior."; }
    }
    return json({ ...result, cleanupWarning });
  } catch (error) {
    return json({ ok: false, error: error.message || "No se pudo actualizar el pago." }, 500);
  }
};

export const config = { path: "/api/payments" };
