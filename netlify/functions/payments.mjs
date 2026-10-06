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
    if (!["create", "update", "delete"].includes(body.action)) {
      return json({ ok: false, error: "Acción no válida." }, 400);
    }

    const result = await callSheetsBridge({ action: body.action, payment: body.payment || {} });
    return result.ok ? json(result) : json(result, 400);
  } catch (error) {
    return json({ ok: false, error: error.message || "No se pudo actualizar el pago." }, 500);
  }
};

export const config = { path: "/api/payments" };
