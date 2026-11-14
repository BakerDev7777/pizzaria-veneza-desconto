// ============================================================
// CONFIGURAÇÃO PUSHINPAY + OTIMIZAÇÃO META ADS (PIZZARIA VENEZA)
// ============================================================
window.PUSHINPAY_CONFIG = {
    API_TOKEN: "73737|AJFfZC71a2HKoNQHd5E3qXus9p1wgrQsLwAvpDkZ65b05551",
    API_URL: "https://api.pushinpay.com.br/api/pix/cashIn",
    STATUS_URL: "https://api.pushinpay.com.br/api/transactions/",
    WEBHOOK_URL: "",

    // ID do Pixel da Meta ativo
    META_PIXEL_ID: "3631463027026813"
};

(function() {
    // 1. Inicialização automática do Meta Pixel (caso ainda não tenha sido inicializado no <head>)
    const pixelId = (window.PUSHINPAY_CONFIG && window.PUSHINPAY_CONFIG.META_PIXEL_ID || "").trim();
    if (pixelId && typeof window.fbq !== "function") {
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        window.fbq('init', pixelId);
        window.fbq('track', 'PageView');
    }

    function trackMeta(eventName, params) {
        try {
            if (typeof window.fbq === "function") {
                window.fbq("track", eventName, params || {});
            }
        } catch (e) {}
    }

    // Monitora mudanças de rota SPA para disparar ViewContent / AddToCart / InitiateCheckout no Meta Ads
    let lastTrackedPath = "";
    function checkRouteEvents() {
        const p = window.location.pathname;
        if (p === lastTrackedPath) return;
        lastTrackedPath = p;
        if (p.startsWith("/product/")) {
            trackMeta("ViewContent", { content_type: "product", currency: "BRL" });
        } else if (p === "/cart") {
            trackMeta("AddToCart", { currency: "BRL" });
        } else if (p === "/checkout") {
            trackMeta("InitiateCheckout", { currency: "BRL" });
        }
    }
    window.addEventListener("popstate", checkRouteEvents);
    setInterval(checkRouteEvents, 800);

    // 2. Interceptador de Fetch (PushinPay PIX + Bloqueio de Telemetria Antiga)
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

        // A) Cria cobrança PIX na PushinPay (/functions/v1/get-payment)
        if (url.includes("/functions/v1/get-payment")) {
            try {
                let bodyObj = {};
                if (init && init.body) {
                    bodyObj = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
                }

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
                const qrBase64 = pData.qr_code_base64
                    ? (pData.qr_code_base64.startsWith("data:image") ? pData.qr_code_base64 : "data:image/png;base64," + pData.qr_code_base64)
                    : "";

                window.__lastPushinQrBase64 = qrBase64;
                window.__lastPushinAmountBRL = totalBRL;

                trackMeta("InitiateCheckout", { value: totalBRL, currency: "BRL" });

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
                console.error("Erro PushinPay:", err);
                return new Response(JSON.stringify({
                    success: false,
                    message: err.message || "Erro ao conectar com a PushinPay"
                }), { status: 500, headers: { "Content-Type": "application/json" } });
            }
        }

        // B) Consulta status do PIX na PushinPay (/functions/v1/verify-payment)
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

                if (isPaid) {
                    trackMeta("Purchase", {
                        value: window.__lastPushinAmountBRL || (info.value ? info.value / 100 : 32.90),
                        currency: "BRL",
                        transaction_id: txId
                    });
                }

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

        // C) Bloqueia qualquer vazamento de telemetria/sessão para o Supabase antigo do outro anunciante
        if (url.includes("iwjltiyaqmtlnylddgru.supabase.co")) {
            return new Response(JSON.stringify({ ok: true, data: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        return originalFetch(input, init);
    };
})();