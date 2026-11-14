// ============================================================
// INTEGRAÇÃO OFICIAL PUSHINPAY - PIZZARIA VENEZA
// ============================================================
window.PUSHINPAY_CONFIG = {
    API_TOKEN: "73737|AJFfZC71a2HKoNQHd5E3qXus9p1wgrQsLwAvpDkZ65b05551",
    API_URL: "https://api.pushinpay.com.br/api/pix/cashIn",
    STATUS_URL: "https://api.pushinpay.com.br/api/transactions/",
    WEBHOOK_URL: ""
};

(function() {
    const originalFetch = window.fetch.bind(window);

    function parseBRLPrice(strOrNum) {
        if (typeof strOrNum === "number") return strOrNum;
        if (!strOrNum) return 0;
        const cleaned = String(strOrNum).replace(/[^\d,\.-]/g, "").replace(",", ".");
        const val = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
    }

    window.fetch = async function(input, init) {
        const url = typeof input === "string" ? input : (input && input.url ? input.url : "");

        // 1. Intercepta criação de PIX (/functions/v1/get-payment) -> PushinPay POST /api/pix/cashIn
        if (url.includes("/functions/v1/get-payment")) {
            try {
                let bodyObj = {};
                if (init && init.body) {
                    bodyObj = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
                }

                // Calcula o valor total do carrinho (cart: [{nome, preco: "32,90", quantidade: 1}, ...])
                let totalBRL = 0;
                if (Array.isArray(bodyObj.cart)) {
                    bodyObj.cart.forEach(item => {
                        const unitPrice = parseBRLPrice(item.preco ?? item.price);
                        const qty = Number(item.quantidade ?? item.quantity ?? 1) || 1;
                        totalBRL += unitPrice * qty;
                    });
                }
                if (totalBRL <= 0 && bodyObj.amount) {
                    totalBRL = parseBRLPrice(bodyObj.amount);
                }
                if (totalBRL < 0.5) {
                    totalBRL = 24.90;
                }

                const valueInCents = Math.round(totalBRL * 100);
                const cfg = window.PUSHINPAY_CONFIG || {};
                const token = (cfg.API_TOKEN || "").trim();

                const pushinPayload = { value: valueInCents };
                if (cfg.WEBHOOK_URL && cfg.WEBHOOK_URL.trim() !== "") {
                    pushinPayload.webhook_url = cfg.WEBHOOK_URL.trim();
                }

                const res = await originalFetch(cfg.API_URL || "https://api.pushinpay.com.br/api/pix/cashIn", {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(pushinPayload)
                });

                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    return new Response(JSON.stringify({
                        success: false,
                        message: errJson.message || ("Erro PushinPay HTTP " + res.status)
                    }), { status: res.status, headers: { "Content-Type": "application/json" } });
                }

                const pData = await res.json();
                const txId = pData.id || ("pp_" + Date.now());
                const emvCode = (pData.qr_code || "").trim();
                const qrBase64 = pData.qr_code_base64 || "";

                const mappedResponse = {
                    success: true,
                    token: txId,
                    pixCode: emvCode,
                    qrCodeBase64: qrBase64,
                    valor: totalBRL,
                    data: {
                        id: txId,
                        amount: valueInCents,
                        status: pData.status || "created",
                        pix: {
                            qrcode: emvCode,
                            qr_code_base64: qrBase64
                        },
                        customer: {
                            name: bodyObj.nome || "Cliente",
                            phone: bodyObj.telefone || "",
                            email: bodyObj.email || "",
                            document: bodyObj.cpf || ""
                        }
                    }
                };

                return new Response(JSON.stringify(mappedResponse), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            } catch (err) {
                console.error("Erro PushinPay Interceptor:", err);
                return new Response(JSON.stringify({
                    success: false,
                    message: err.message || "Erro ao conectar com a PushinPay"
                }), { status: 500, headers: { "Content-Type": "application/json" } });
            }
        }

        // 2. Intercepta consulta de status do PIX (/functions/v1/verify-payment?id=...) -> PushinPay GET /api/transactions/{id}
        if (url.includes("/functions/v1/verify-payment")) {
            try {
                const parsedUrl = new URL(url, window.location.origin);
                const txId = parsedUrl.searchParams.get("id");
                const cfg = window.PUSHINPAY_CONFIG || {};
                const token = (cfg.API_TOKEN || "").trim();

                if (!txId) {
                    return new Response(JSON.stringify({ success: false, status: "pending" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                const res = await originalFetch((cfg.STATUS_URL || "https://api.pushinpay.com.br/api/transactions/") + encodeURIComponent(txId), {
                    method: "GET",
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    }
                });

                if (!res.ok) {
                    return new Response(JSON.stringify({ success: false, status: "pending" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                const info = await res.json();
                const st = String(info.status || "pending").toLowerCase();
                const isPaid = ["paid", "approved", "completed", "authorized"].includes(st);

                return new Response(JSON.stringify({
                    success: isPaid,
                    status: isPaid ? "paid" : st
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            } catch (e) {
                return new Response(JSON.stringify({ success: false, status: "pending" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        return originalFetch(input, init);
    };
})();