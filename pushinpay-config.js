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
    const pixelId = (window.PUSHINPAY_CONFIG && window.PUSHINPAY_CONFIG.META_PIXEL_ID || "").trim();

    // Catálogo base da Pizzaria Veneza para enriquecer eventos de funil (ViewContent, AddToCart, etc.)
    const CATALOG = {
        "1": { id: "69057e0a37656a0f32c9f0c5", name: "2 Pizza PP + 1 Refrigerante 2 Litros", price: 24.90 },
        "2": { id: "69057e0a37656a0f32c9f0c8", name: "2 Pizzas M + 1 Refrigerante 2L (MAIS VENDIDO)", price: 32.90 },
        "3": { id: "69057e0a37656a0f32c9f0cb", name: "2 Pizzas G + 1 Refrigerante 2L", price: 55.90 },
        "4": { id: "69057e0a37656a0f32c9f0d3", name: "2 Pizzas Gigante + 2 Refri 2L", price: 75.90 },
        "5": { id: "69057e0a37656a0f32c9f0d6", name: "Pizza M Calabresa + Refri Lata", price: 24.90 },
        "6": { id: "69057e0a37656a0f32c9f0d9", name: "Pizza G Frango c/ Catupiry + Refri 2L", price: 39.90 },
        "7": { id: "69057e0a37656a0f32c9f0dc", name: "Pizza Doce Brigadeiro com Morango", price: 19.90 }
    };

    function parseBRLPrice(strOrNum) {
        if (typeof strOrNum === "number") return isNaN(strOrNum) ? 0 : strOrNum;
        if (!strOrNum) return 0;
        const cleaned = String(strOrNum).replace(/[^\d,\.-]/g, "").replace(",", ".");
        const val = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
    }

    function safeJsonParse(raw, fallback) {
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return parsed != null ? parsed : fallback;
        } catch (e) {
            return fallback;
        }
    }

    // ============================================================
    // 1. PERSISTÊNCIA ANTI-F5 / ANTI-RELOAD (ITEM 3)
    // ============================================================
    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;

    // Restaura estado do PIX imediatamente antes do React montar
    (function restorePersistedPaymentState() {
        try {
            const savedQr = sessionStorage.getItem("__lastPushinQrBase64") || localStorage.getItem("__lastPushinQrBase64") || "";
            if (savedQr) {
                window.__lastPushinQrBase64 = savedQr;
            }
            const savedAmt = parseFloat(sessionStorage.getItem("__lastPushinAmountBRL") || localStorage.getItem("__lastPushinAmountBRL") || "0");
            if (savedAmt > 0) {
                window.__lastPushinAmountBRL = savedAmt;
            }

            // Restaura transações já rastreadas para evitar duplicidade de Purchase no F5
            const trackedMap = safeJsonParse(sessionStorage.getItem("__tracked_purchases") || localStorage.getItem("__tracked_purchases"), {});
            window.__paidTrackedIds = Object.assign({}, window.__paidTrackedIds || {}, trackedMap);

            // Se paymentData sumiu do localStorage ou está incompleto, restaura do backup
            const currentPdRaw = localStorage.getItem("paymentData");
            const backupPdRaw = sessionStorage.getItem("paymentData_backup") || localStorage.getItem("paymentData_backup");
            let pdObj = safeJsonParse(currentPdRaw, null);

            if ((!pdObj || !pdObj.transactionId || !pdObj.pixCode) && backupPdRaw) {
                pdObj = safeJsonParse(backupPdRaw, null);
                if (pdObj && pdObj.transactionId && pdObj.pixCode) {
                    if (!pdObj.qrCodeBase64 && savedQr) {
                        pdObj.qrCodeBase64 = savedQr;
                    }
                    nativeSetItem.call(localStorage, "paymentData", JSON.stringify(pdObj));
                }
            } else if (pdObj && pdObj.transactionId && !pdObj.qrCodeBase64 && savedQr) {
                pdObj.qrCodeBase64 = savedQr;
                const updatedRaw = JSON.stringify(pdObj);
                nativeSetItem.call(localStorage, "paymentData", updatedRaw);
                nativeSetItem.call(sessionStorage, "paymentData_backup", updatedRaw);
            }
        } catch (e) {}
    })();

    // Intercepta Storage.prototype.setItem para garantir qrCodeBase64 e backup espelhado em paymentData
    Storage.prototype.setItem = function(key, value) {
        try {
            if (key === "paymentData" && typeof value === "string") {
                const parsed = safeJsonParse(value, null);
                if (parsed && typeof parsed === "object") {
                    if (!parsed.qrCodeBase64 && window.__lastPushinQrBase64) {
                        parsed.qrCodeBase64 = window.__lastPushinQrBase64;
                    }
                    if (!parsed.amount && window.__lastPushinAmountBRL) {
                        parsed.amount = window.__lastPushinAmountBRL;
                    }
                    value = JSON.stringify(parsed);
                    try {
                        nativeSetItem.call(sessionStorage, "paymentData_backup", value);
                        nativeSetItem.call(localStorage, "paymentData_backup", value);
                    } catch (err) {}
                    if (parsed.customer) {
                        syncAdvancedMatching(parsed.customer);
                    }
                }
            }
        } catch (e) {}
        return nativeSetItem.call(this, key, value);
    };

    // Evita remoção prematura de paymentData caso o usuário ainda esteja na tela /payment
    Storage.prototype.removeItem = function(key) {
        try {
            if (key === "paymentData" && window.location.pathname === "/payment") {
                return;
            }
        } catch (e) {}
        return nativeRemoveItem.call(this, key);
    };

    function markPurchaseTracked(txId) {
        if (!txId) return;
        window.__paidTrackedIds = window.__paidTrackedIds || {};
        window.__paidTrackedIds[txId] = true;
        try {
            const serialized = JSON.stringify(window.__paidTrackedIds);
            nativeSetItem.call(sessionStorage, "__tracked_purchases", serialized);
            nativeSetItem.call(localStorage, "__tracked_purchases", serialized);
        } catch (e) {}
    }

    // ============================================================
    // 2. META PIXEL ADVANCED MATCHING (ITEM 1)
    // ============================================================
    function removeAccents(str) {
        return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function buildAdvancedMatching(rawCustomer) {
        if (!rawCustomer || typeof rawCustomer !== "object") return null;

        const existing = safeJsonParse(localStorage.getItem("__meta_am"), {});
        const am = Object.assign({ country: "br" }, existing);

        const fullName = String(rawCustomer.nome || rawCustomer.name || "").trim().toLowerCase();
        if (fullName && fullName !== "cliente") {
            const parts = fullName.split(/\s+/).filter(Boolean);
            if (parts.length > 0) {
                am.fn = removeAccents(parts[0]).replace(/[^a-z]/g, "");
            }
            if (parts.length > 1) {
                am.ln = removeAccents(parts.slice(1).join(" ")).replace(/[^a-z\s]/g, "").trim();
            }
        }

        const rawPhone = String(rawCustomer.telefone || rawCustomer.phone || "").replace(/\D/g, "");
        if (rawPhone.length >= 10) {
            am.ph = (rawPhone.length === 10 || rawPhone.length === 11) ? ("55" + rawPhone) : rawPhone;
        }

        const rawCep = String(rawCustomer.cep || rawCustomer.zip || "").replace(/\D/g, "");
        if (rawCep.length === 8) {
            am.zp = rawCep;
        }

        const rawCity = String(rawCustomer.city || rawCustomer.cidade || "").trim().toLowerCase();
        if (rawCity) {
            am.ct = removeAccents(rawCity).replace(/[^a-z]/g, "");
        }

        const rawState = String(rawCustomer.state || rawCustomer.uf || "").trim().toLowerCase();
        if (rawState && rawState.length === 2) {
            am.st = removeAccents(rawState).replace(/[^a-z]/g, "");
        }

        const rawEmail = String(rawCustomer.email || "").trim().toLowerCase();
        if (rawEmail && rawEmail.includes("@") && !rawEmail.includes("doisirmaospizzaria.site")) {
            am.em = rawEmail;
        }

        return am;
    }

    function syncAdvancedMatching(rawCustomer) {
        try {
            const am = buildAdvancedMatching(rawCustomer);
            if (!am || Object.keys(am).length <= 1) return am;
            nativeSetItem.call(localStorage, "__meta_am", JSON.stringify(am));
            if (pixelId && typeof window.fbq === "function") {
                window.fbq("init", pixelId, am);
            }
            return am;
        } catch (e) {
            return null;
        }
    }

    // Inicializa Meta Pixel (caso não exista) e aplica Advanced Matching salvo no carregamento da página
    (function initMetaPixelWithAM() {
        if (pixelId && typeof window.fbq !== "function") {
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
        }

        try {
            const pd = safeJsonParse(localStorage.getItem("paymentData") || sessionStorage.getItem("paymentData_backup"), null);
            const savedCustomer = safeJsonParse(localStorage.getItem("savedCustomerData"), null);
            const storedAm = safeJsonParse(localStorage.getItem("__meta_am"), null);

            if (pd && pd.customer) {
                syncAdvancedMatching(pd.customer);
            } else if (savedCustomer) {
                syncAdvancedMatching(savedCustomer);
            } else if (storedAm && Object.keys(storedAm).length > 0 && pixelId && typeof window.fbq === "function") {
                window.fbq("init", pixelId, storedAm);
            }
        } catch (e) {}
    })();

    // Captura preenchimento do formulário de checkout em tempo real para alimentar o Advanced Matching
    function captureCheckoutInputsFromDOM() {
        if (window.location.pathname !== "/checkout") return;
        try {
            const nameInput = document.querySelector('input[placeholder*="Nome"]');
            const phoneInput = document.querySelector('input[placeholder*="DDD"]');
            const cepInput = document.querySelector('input[placeholder*="12345"]');
            const data = {};
            if (nameInput && nameInput.value) data.name = nameInput.value;
            if (phoneInput && phoneInput.value) data.phone = phoneInput.value;
            if (cepInput && cepInput.value) data.cep = cepInput.value;
            if (Object.keys(data).length > 0) {
                syncAdvancedMatching(data);
            }
        } catch (e) {}
    }

    document.addEventListener("change", captureCheckoutInputsFromDOM, true);
    document.addEventListener("blur", captureCheckoutInputsFromDOM, true);

    // ============================================================
    // 3. PARÂMETROS RICOS DE PRODUTO NOS EVENTOS DO FUNIL (ITEM 5)
    // ============================================================
    function getRichEcommercePayload(overrideItems, overrideTotal) {
        let rawItems = [];

        if (Array.isArray(overrideItems) && overrideItems.length > 0) {
            rawItems = overrideItems;
        } else {
            const cartItems = safeJsonParse(localStorage.getItem("cart"), []);
            if (Array.isArray(cartItems) && cartItems.length > 0) {
                rawItems = cartItems;
            } else {
                const pd = safeJsonParse(localStorage.getItem("paymentData") || sessionStorage.getItem("paymentData_backup"), null);
                if (pd && Array.isArray(pd.cart) && pd.cart.length > 0) {
                    rawItems = [...pd.cart, ...(Array.isArray(pd.orderbumps) ? pd.orderbumps : [])];
                }
            }
        }

        // Se estiver em /product/:num e ainda não houver carrinho, usa o produto da rota
        const pathMatch = window.location.pathname.match(/^\/product\/(\d+)/);
        if (pathMatch && CATALOG[pathMatch[1]] && (!overrideItems || overrideItems.length === 0) && window.location.pathname.startsWith("/product/")) {
            const prod = CATALOG[pathMatch[1]];
            return {
                content_type: "product",
                content_ids: [prod.id],
                content_name: prod.name,
                contents: [{ id: prod.id, quantity: 1, item_price: prod.price }],
                num_items: 1,
                value: prod.price,
                currency: "BRL"
            };
        }

        const contentIds = [];
        const contentNames = [];
        const contents = [];
        let numItems = 0;
        let calcTotal = 0;

        rawItems.forEach((item, idx) => {
            const name = String(item.name || item.nome || "Combo Pizza Veneza").trim();
            const qty = Math.max(1, Number(item.quantity ?? item.quantidade ?? 1) || 1);
            let price = parseBRLPrice(item.price ?? item.preco);

            // Busca correspondência no catálogo pelo ID ou Nome
            let matchedId = item.id || item.cartId || "";
            if (!matchedId || price <= 0) {
                for (const k in CATALOG) {
                    if (CATALOG[k].name.toLowerCase() === name.toLowerCase() || CATALOG[k].id === matchedId) {
                        if (!matchedId) matchedId = CATALOG[k].id;
                        if (price <= 0) price = CATALOG[k].price;
                        break;
                    }
                }
            }
            if (!matchedId) {
                matchedId = "item_" + (idx + 1);
            }
            if (price <= 0) {
                price = 24.90;
            }

            contentIds.push(String(matchedId));
            contentNames.push(name);
            contents.push({
                id: String(matchedId),
                quantity: qty,
                item_price: Number(price.toFixed(2))
            });
            numItems += qty;
            calcTotal += price * qty;
        });

        // Fallback caso o carrinho esteja vazio no momento da leitura
        if (contents.length === 0) {
            const defaultProd = CATALOG["2"];
            const fallbackVal = (typeof overrideTotal === "number" && overrideTotal > 0)
                ? overrideTotal
                : (window.__lastPushinAmountBRL || defaultProd.price);
            return {
                content_type: "product",
                content_ids: [defaultProd.id],
                content_name: defaultProd.name,
                contents: [{ id: defaultProd.id, quantity: 1, item_price: Number(fallbackVal.toFixed(2)) }],
                num_items: 1,
                value: Number(fallbackVal.toFixed(2)),
                currency: "BRL"
            };
        }

        const finalValue = (typeof overrideTotal === "number" && overrideTotal > 0) ? overrideTotal : calcTotal;

        return {
            content_type: "product",
            content_ids: contentIds,
            content_name: contentNames.join(" + "),
            contents: contents,
            num_items: numItems,
            value: Number(finalValue.toFixed(2)),
            currency: "BRL"
        };
    }

    function trackMeta(eventName, params, options) {
        try {
            if (typeof window.fbq === "function") {
                if (options && typeof options === "object") {
                    window.fbq("track", eventName, params || {}, options);
                } else {
                    window.fbq("track", eventName, params || {});
                }
            }
        } catch (e) {}
    }

    // Monitora mudanças de rota SPA para disparar ViewContent / AddToCart / InitiateCheckout enriquecidos
    let lastTrackedPath = "";
    function checkRouteEvents() {
        const p = window.location.pathname;
        if (p === lastTrackedPath) return;
        lastTrackedPath = p;

        if (p.startsWith("/product/")) {
            trackMeta("ViewContent", getRichEcommercePayload());
        } else if (p === "/cart") {
            trackMeta("AddToCart", getRichEcommercePayload());
        } else if (p === "/checkout") {
            trackMeta("InitiateCheckout", getRichEcommercePayload());
        } else if (p === "/payment") {
            ensureQrCodeRenderedOnPayment();
        }
    }
    window.addEventListener("popstate", checkRouteEvents);
    setInterval(checkRouteEvents, 600);

    // Garante que a imagem do QR Code na página /payment use o Base64 salvo caso o React recarregue
    function ensureQrCodeRenderedOnPayment() {
        if (window.location.pathname !== "/payment") return;
        try {
            const qrImg = document.querySelector(".pi-qr-wrap img");
            const savedQr = window.__lastPushinQrBase64 || sessionStorage.getItem("__lastPushinQrBase64") || localStorage.getItem("__lastPushinQrBase64");
            if (qrImg && savedQr && (!qrImg.getAttribute("src") || qrImg.getAttribute("src").includes("api.qrserver.com"))) {
                qrImg.setAttribute("src", savedQr);
            }
        } catch (e) {}
    }
    setInterval(ensureQrCodeRenderedOnPayment, 1000);

    // ============================================================
    // 4. INTERCEPTADOR DE FETCH (PUSHINPAY PIX + VERIFICAÇÃO + PURCHASE IMEDIATO)
    // ============================================================
    const originalFetch = window.fetch.bind(window);
    let inFlightGeoPromise = null;

    function getCachedGeoData() {
        try {
            const raw = localStorage.getItem("lf_geo_v1") || sessionStorage.getItem("lf_geo_v1");
            const parsed = safeJsonParse(raw, null);
            if (parsed && typeof parsed === "object" && (parsed.city || parsed.uf || parsed.region)) {
                if (parsed.ip && !window.__cachedClientIp) {
                    window.__cachedClientIp = parsed.ip;
                }
                return parsed;
            }
        } catch (e) {}
        return null;
    }

    function persistGeoData(geoObj) {
        if (!geoObj || typeof geoObj !== "object") return;
        try {
            const serialized = JSON.stringify(geoObj);
            nativeSetItem.call(localStorage, "lf_geo_v1", serialized);
            nativeSetItem.call(sessionStorage, "lf_geo_v1", serialized);
        } catch (e) {}
    }

    async function resolveGeoDataFast() {
        const cached = getCachedGeoData();
        if (cached) {
            if (cached.city || cached.uf) {
                syncAdvancedMatching({ city: cached.city, state: cached.uf });
            }
            return cached;
        }

        if (inFlightGeoPromise) {
            return inFlightGeoPromise;
        }

        inFlightGeoPromise = (async () => {
            const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
            try {
                const res = await originalFetch("https://get.geojs.io/v1/ip/geo.json", {
                    method: "GET",
                    signal: controller ? controller.signal : undefined
                });
                if (timeoutId) clearTimeout(timeoutId);
                if (!res.ok) {
                    return { city: "", region: "", region_code: "", uf: "" };
                }
                const data = await res.json();
                if (data && data.ip) {
                    window.__cachedClientIp = String(data.ip).trim();
                }
                const city = String((data && data.city) || "").trim();
                const region = String((data && data.region) || "").trim();
                const rawUf = String((data && (data.region_code || data.uf || data.region)) || "").trim().toUpperCase();
                const uf = rawUf.length === 2 ? rawUf : "";

                const normalized = {
                    ip: window.__cachedClientIp || "",
                    city: city,
                    region: region || uf,
                    region_code: uf || region,
                    uf: uf
                };

                if (city || uf || region) {
                    persistGeoData(normalized);
                }
                if (city || uf) {
                    syncAdvancedMatching({ city: city, state: uf });
                }
                return normalized;
            } catch (e) {
                if (timeoutId) clearTimeout(timeoutId);
                return { city: "", region: "", region_code: "", uf: "" };
            } finally {
                inFlightGeoPromise = null;
            }
        })();

        return inFlightGeoPromise;
    }

    // Pré-carrega ou sincroniza geolocalização em cache para o Advanced Matching logo na inicialização
    (function preloadGeoForAM() {
        try {
            const cached = getCachedGeoData();
            if (cached && (cached.city || cached.uf)) {
                syncAdvancedMatching({ city: cached.city, state: cached.uf });
            }
        } catch (e) {}
    })();

    async function verifyPushinPayTransaction(txId) {
        if (!txId) return { success: false, status: "pending" };
        const cfg = window.PUSHINPAY_CONFIG || {};
        const token = (cfg.API_TOKEN || "").trim();

        const res = await originalFetch((cfg.STATUS_URL || "https://api.pushinpay.com.br/api/transactions/") + encodeURIComponent(txId), {
            method: "GET",
            headers: {
                "Authorization": "Bearer " + token,
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });

        if (!res.ok) {
            return { success: false, status: "pending" };
        }

        const info = await res.json();
        const st = String(info.status || "pending").toLowerCase();
        const isPaid = ["paid", "approved", "completed", "authorized"].includes(st);

        if (isPaid && (!window.__paidTrackedIds || !window.__paidTrackedIds[txId])) {
            markPurchaseTracked(txId);
            const paidValue = window.__lastPushinAmountBRL || (info.value ? info.value / 100 : 32.90);
            const richParams = Object.assign(getRichEcommercePayload(null, paidValue), {
                transaction_id: txId
            });
            trackMeta("Purchase", richParams, { eventID: "pur_" + txId });
        }

        return {
            success: isPaid,
            status: isPaid ? "paid" : st
        };
    }

    // Listener visibilitychange / focus para verificar o PIX imediatamente quando o cliente volta do app do banco
    function handleReturnFromBankApp() {
        if (document.visibilityState && document.visibilityState !== "visible") return;
        if (window.location.pathname !== "/payment") return;
        try {
            const pd = safeJsonParse(localStorage.getItem("paymentData") || sessionStorage.getItem("paymentData_backup"), null);
            const txId = pd && pd.transactionId;
            if (!txId) return;
            verifyPushinPayTransaction(txId).then(result => {
                if (result && result.success) {
                    setTimeout(() => {
                        if (window.location.pathname === "/payment") {
                            window.location.href = "/up1" + window.location.search;
                        }
                    }, 1500);
                }
            }).catch(() => {});
        } catch (e) {}
    }
    document.addEventListener("visibilitychange", handleReturnFromBankApp);
    window.addEventListener("focus", handleReturnFromBankApp);

    window.fetch = async function(input, init) {
        const url = typeof input === "string" ? input : (input && input.url ? input.url : "");

        // Item 2: Resposta instantânea e não-bloqueante (<1ms) para api.ipify.org
        if (url.includes("api.ipify.org")) {
            return new Response(JSON.stringify({ ip: window.__cachedClientIp || "127.0.0.1" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Item 3: Interceptador de geolocalização rápido, com cache e à prova de rate-limit (ipapi.co & get.geojs.io)
        if (url.includes("ipapi.co/json") || url.includes("get.geojs.io/v1/ip/geo.json")) {
            const cachedGeo = getCachedGeoData();
            if (cachedGeo) {
                return new Response(JSON.stringify(cachedGeo), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            const resolvedGeo = await resolveGeoDataFast();
            return new Response(JSON.stringify(resolvedGeo || { city: "", region: "", uf: "" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Intercepta consulta ViaCEP para já enriquecer cidade/UF no Advanced Matching
        if (url.includes("viacep.com.br/ws/")) {
            const response = await originalFetch(input, init);
            try {
                const clone = response.clone();
                clone.json().then(cepData => {
                    if (cepData && !cepData.erro) {
                        syncAdvancedMatching({
                            cep: cepData.cep,
                            city: cepData.localidade,
                            state: cepData.uf
                        });
                    }
                }).catch(() => {});
            } catch (e) {}
            return response;
        }

        // A) Cria cobrança PIX na PushinPay (/functions/v1/get-payment)
        if (url.includes("/functions/v1/get-payment")) {
            try {
                let bodyObj = {};
                if (init && init.body) {
                    bodyObj = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
                }

                // Sincroniza dados do cliente no Advanced Matching antes dos disparos de evento
                captureCheckoutInputsFromDOM();
                syncAdvancedMatching(bodyObj);

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
                const txId = String(pData.id || ("pp_" + Date.now()));
                const emvCode = (pData.qr_code || "").trim();
                const qrBase64 = pData.qr_code_base64
                    ? (pData.qr_code_base64.startsWith("data:image") ? pData.qr_code_base64 : "data:image/png;base64," + pData.qr_code_base64)
                    : "";

                // Salva estado do PIX em memória, sessionStorage e localStorage (Anti-F5)
                window.__lastPushinQrBase64 = qrBase64;
                window.__lastPushinAmountBRL = totalBRL;
                try {
                    if (qrBase64) {
                        nativeSetItem.call(sessionStorage, "__lastPushinQrBase64", qrBase64);
                        nativeSetItem.call(localStorage, "__lastPushinQrBase64", qrBase64);
                    }
                    nativeSetItem.call(sessionStorage, "__lastPushinAmountBRL", String(totalBRL));
                    nativeSetItem.call(localStorage, "__lastPushinAmountBRL", String(totalBRL));
                } catch (e) {}

                // Monta payload rico de e-commerce com todos os itens do pedido
                const richPayload = getRichEcommercePayload(bodyObj.cart, totalBRL);

                // Dispara AddPaymentInfo enriquecido
                trackMeta("AddPaymentInfo", richPayload);

                // OPÇÃO B (Item 2B): Dispara Purchase imediatamente na geração do PIX com eventID de deduplicação
                if (!window.__paidTrackedIds || !window.__paidTrackedIds[txId]) {
                    markPurchaseTracked(txId);
                    const purchasePayload = Object.assign({}, richPayload, {
                        transaction_id: txId
                    });
                    trackMeta("Purchase", purchasePayload, { eventID: "pur_" + txId });
                }

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
                const result = await verifyPushinPayTransaction(txId);
                return new Response(JSON.stringify(result), {
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
