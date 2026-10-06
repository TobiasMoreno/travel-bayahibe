import { createHash } from "node:crypto";

const GALLERY_FOLDER = "travel-bayahibe/recuerdos";
const GALLERY_TAG = "travel-bayahibe-recuerdo";
const TRAVELERS = new Set(["Andy", "Cata", "Tobi", "Vale"]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

function getConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary todavía no está configurado en Netlify.");
  }
  return { cloudName, apiKey, apiSecret };
}

function sign(params, secret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join("&");
  return createHash("sha1").update(`${payload}${secret}`).digest("hex");
}

function escapeContext(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("=", "\\=");
}

function authHeader(apiKey, apiSecret) {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

async function listResources(resourceType, config) {
  const url = new URL(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/${resourceType}/tags/${GALLERY_TAG}`);
  url.searchParams.set("max_results", "100");
  url.searchParams.set("context", "true");
  url.searchParams.set("tags", "true");
  const response = await fetch(url, {
    headers: { authorization: authHeader(config.apiKey, config.apiSecret) },
  });
  if (!response.ok) throw new Error("Cloudinary no pudo devolver los recuerdos.");
  const data = await response.json();
  return (data.resources || []).map((asset) => ({
    assetId: asset.asset_id,
    publicId: asset.public_id,
    resourceType: asset.resource_type,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    duration: asset.duration || null,
    bytes: asset.bytes,
    createdAt: asset.created_at,
    url: asset.secure_url,
    author: asset.context?.custom?.author || "El grupo",
    caption: asset.context?.custom?.caption || "",
    capturedAt: asset.context?.custom?.captured_at || "",
  }));
}

async function listGallery(config) {
  const [images, videos] = await Promise.all([
    listResources("image", config),
    listResources("video", config),
  ]);
  return [...images, ...videos].sort((left, right) => {
    const leftDate = left.capturedAt || left.createdAt;
    const rightDate = right.capturedAt || right.createdAt;
    return String(rightDate).localeCompare(String(leftDate));
  });
}

function prepareUpload(body, config) {
  const author = String(body.author || "").trim();
  const caption = String(body.caption || "").trim().slice(0, 280);
  const capturedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.capturedAt || ""))
    ? String(body.capturedAt)
    : "";
  if (!TRAVELERS.has(author)) throw new Error("Elegí quién agrega el recuerdo.");

  const contextParts = [`author=${escapeContext(author)}`];
  if (caption) contextParts.push(`caption=${escapeContext(caption)}`);
  if (capturedAt) contextParts.push(`captured_at=${capturedAt}`);

  const uploadParams = {
    context: contextParts.join("|"),
    folder: GALLERY_FOLDER,
    overwrite: false,
    tags: GALLERY_TAG,
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

async function deleteAsset(body, config) {
  const assetId = String(body.assetId || "");
  if (!assetId) throw new Error("Falta identificar el recuerdo.");
  const lookupUrl = new URL(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/by_asset_ids`);
  lookupUrl.searchParams.append("asset_ids[]", assetId);
  lookupUrl.searchParams.set("tags", "true");
  const lookupResponse = await fetch(lookupUrl, {
    headers: { authorization: authHeader(config.apiKey, config.apiSecret) },
  });
  const lookup = await lookupResponse.json().catch(() => ({}));
  const asset = lookup.resources?.[0];
  if (!lookupResponse.ok || !asset || !asset.tags?.includes(GALLERY_TAG)) {
    throw new Error("El archivo no pertenece a esta biblioteca.");
  }
  const publicId = asset.public_id;
  const resourceType = asset.resource_type;
  if (!["image", "video"].includes(resourceType)) throw new Error("El tipo de archivo no es válido.");

  const params = {
    invalidate: true,
    public_id: publicId,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const form = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    api_key: config.apiKey,
    signature: sign(params, config.apiSecret),
  });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/destroy`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !["ok", "not found"].includes(result.result)) {
    throw new Error("Cloudinary no pudo eliminar el recuerdo.");
  }
  return result.result;
}

export default async (request) => {
  try {
    const config = getConfig();
    if (request.method === "GET") {
      return json({ ok: true, assets: await listGallery(config) });
    }
    if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

    const body = await request.json();
    if (body.action === "sign") return json({ ok: true, ...prepareUpload(body, config) });
    if (body.action === "delete") {
      await deleteAsset(body, config);
      return json({ ok: true });
    }
    return json({ ok: false, error: "Acción no válida." }, 400);
  } catch (error) {
    return json({ ok: false, error: error.message || "No se pudo actualizar la biblioteca." }, 500);
  }
};

export const config = { path: "/api/gallery" };
