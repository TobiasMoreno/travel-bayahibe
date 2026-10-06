const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=300, stale-while-revalidate=600",
  },
});

export default async (request) => {
  try {
    if (request.method !== "GET") return json({ ok: false, error: "Método no permitido." }, 405);
    const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
    const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
    const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary todavía no está configurado en Netlify.");

    const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
      headers: { authorization },
    });
    const usage = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Cloudinary no pudo devolver el consumo de almacenamiento.");

    const used = Number(usage.storage?.usage || 0);
    const limit = Number(usage.storage?.limit || 0);
    const reportedPercent = Number(usage.storage?.used_percent);
    const occupiedPercent = Number.isFinite(reportedPercent)
      ? reportedPercent
      : limit > 0 ? (used / limit) * 100 : 0;
    const occupied = Math.min(100, Math.max(0, Math.round(occupiedPercent * 10) / 10));
    return json({ ok: true, occupiedPercent: occupied, freePercent: Math.round((100 - occupied) * 10) / 10 });
  } catch (error) {
    return json({ ok: false, error: error.message || "No se pudo consultar el almacenamiento." }, 502);
  }
};

export const config = { path: "/api/cloudinary-usage" };
