// Estado, inicio, autenticacion y servicios compartidos.
let products = [];
let productsLoading = true;
let productLoadError = "";
let productsFromCache = false;
let productCacheTimestamp = null;
let clientRecords = [];
let clientsLoading = false;
let clientsLoadError = "";
let clientsFromCache = false;
let clientCacheTimestamp = null;
let editingClientId = null;

// Carrito de compras (clave: id del producto, valor: cantidad)
let cart = {};
let draftQuantities = {};
let activeProductId = null;
let invoiceHistory = [];
let deletedProductIds = [];
let activeInvoiceNumber = null;
let lastSentInvoice = null;
let activeInvoicePreview = null;
let viewingHistoricalInvoice = null;
let selectedProductCategory = "";
const expandedInventoryCategories = new Set();
let dollarRate = null;
let lastEditedCurrency = "usd";
let currentUserRole = null;
let currentUserId = null;
let selectedLoginRole = null;
let hasAuthenticatedSupabaseSession = false;
let invoiceSaveInProgress = false;
let collectionBanks = [];
let collectionBanksLoading = false;
let collectionBanksLoadError = "";
let collectionBanksLoaded = false;
let selectedCreditInvoiceKey = "";
let selectedCollectionAction = "send";
const supabaseProductMetadata = new WeakMap();
const PRODUCT_CACHE_STORAGE_KEY = "supabaseProductsCache";
const CLIENT_CACHE_STORAGE_KEY = "supabaseClientsCache";
const desktopLayoutQuery = window.matchMedia("(min-width: 1024px)");

function updateDeviceLayout() {
    document.body.dataset.layout = desktopLayoutQuery.matches ? "desktop" : "mobile";
}

updateDeviceLayout();
window.addEventListener("resize", updateDeviceLayout);

document.addEventListener("DOMContentLoaded", async () => {
    window.addEventListener("offline", () => updateConnectionStatus());
    window.addEventListener("online", () => {
        updateConnectionStatus("Conexión restablecida. Sincronizando datos...");
        synchronizeAfterReconnect();
    });
    updateConnectionStatus();
    loadInvoiceHistory();
    updateCurrentDate();
    try {
        await loadSupabaseClient();
    } catch (error) {
        setAccessError(error.message);
        return;
    }
    await initializeAccessGate();
});

function normalizeColumnName(name) {
    return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function getProductField(row, aliases) {
    const fields = new Map(Object.entries(row).map(([key, value]) => [normalizeColumnName(key), value]));
    for (const alias of aliases) {
        const value = fields.get(normalizeColumnName(alias));
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return undefined;
}

function getProductColumnName(row, aliases) {
    const fields = new Map(Object.keys(row).map(key => [normalizeColumnName(key), key]));
    for (const alias of aliases) {
        const columnName = fields.get(normalizeColumnName(alias));
        if (columnName) return columnName;
    }
    return undefined;
}

function parseProductNumber(value) {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const number = Number(String(value).trim().replace(",", "."));
    return Number.isFinite(number) ? number : undefined;
}

function stableProductId(name) {
    let hash = 2166136261;
    for (const character of String(name).trim().toLowerCase()) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return -(hash >>> 0 || 1);
}

function mapSupabaseProduct(row) {
    const name = getProductField(row, ["nombre", "name", "producto", "product", "descripcion", "description"]);
    if (!name) return null;

    const idColumn = getProductColumnName(row, ["id", "producto_id", "codigo", "code"]);
    const sourceId = idColumn ? row[idColumn] : undefined;
    const numericId = parseProductNumber(sourceId);
    const product = {
        id: Number.isInteger(numericId) ? numericId : stableProductId(name),
        name: String(name).trim(),
        category: String(getProductField(row, ["categoria", "category", "tipo", "grupo"]) || "Sin categoría").trim(),
        unit: String(getProductField(row, ["unidad", "unit", "presentacion", "presentation", "medida"]) || "Unidad").trim()
    };

    const priceAliases = ["precio", "price", "precio_unitario", "unit_price", "precio_venta"];
    const boxPriceAliases = ["precio_caja", "precio_por_caja", "box_price", "boxprice"];
    const stockAliases = ["stock", "existencia", "inventario", "cantidad"];
    const price = parseProductNumber(getProductField(row, priceAliases));
    const boxPrice = parseProductNumber(getProductField(row, boxPriceAliases));
    const stock = parseProductNumber(getProductField(row, stockAliases));
    const unitsPerBox = parseProductNumber(getProductField(row, ["unidades_por_caja"]));
    const liters = parseProductNumber(getProductField(row, ["litros", "liters", "capacidad_litros", "capacity_liters"]));
    const looseUnits = parseProductNumber(getProductField(row, ["stock_unidades_sueltas"]));
    if (price !== undefined) product.price = price;
    if (boxPrice !== undefined) product.boxPrice = boxPrice;
    if (Number.isInteger(stock) && stock >= 0) product.stock = stock;
    if (Number.isInteger(unitsPerBox) && unitsPerBox > 0) product.unitsPerBox = unitsPerBox;
    if (liters !== undefined && liters > 0) product.liters = liters;
    if (Number.isInteger(looseUnits) && looseUnits >= 0) product.looseUnits = looseUnits;
    supabaseProductMetadata.set(product, {
        idColumn,
        sourceId,
        columns: {
            category: getProductColumnName(row, ["categoria", "category", "tipo", "grupo"]),
            unit: getProductColumnName(row, ["unidad", "unit", "presentacion", "presentation", "medida"]),
            price: getProductColumnName(row, priceAliases),
            boxPrice: getProductColumnName(row, boxPriceAliases),
            stock: getProductColumnName(row, stockAliases),
            unitsPerBox: getProductColumnName(row, ["unidades_por_caja"]),
            liters: getProductColumnName(row, ["litros", "liters", "capacidad_litros", "capacity_liters"]),
            looseUnits: getProductColumnName(row, ["stock_unidades_sueltas"])
        }
    });
    return product;
}

function getProductStockSummary(product) {
    if (!Number.isInteger(product.stock) || product.stock < 0) return "Stock no configurado";
    if (!Number.isInteger(product.unitsPerBox) || product.unitsPerBox <= 0) {
        return `${product.stock} cajas · configurar unidades por caja`;
    }

    const looseUnits = Number.isInteger(product.looseUnits) && product.looseUnits >= 0
        ? product.looseUnits
        : 0;
    const totalUnits = product.stock * product.unitsPerBox + looseUnits;
    const pluralUnit = getProductUnitName(product, totalUnits);
    const casesLabel = `${product.stock} ${product.stock === 1 ? "caja" : "cajas"}`;
    const looseLabel = looseUnits ? ` + ${looseUnits} sueltas` : "";
    return `${totalUnits} ${pluralUnit} (${casesLabel}${looseLabel})`;
}

function calculateInvoiceStockChanges(invoice, direction = -1) {
    const quantitiesBySourceId = new Map();
    invoice.items.forEach(item => {
        const sourceId = String(item.supabaseProductId ?? "");
        const units = Number(item.quantityUnit);
        const boxes = Number(item.quantityBox);
        if (!sourceId || !Number.isInteger(units) || units < 0 || !Number.isInteger(boxes) || boxes < 0 || units + boxes === 0) {
            throw new Error(`No se pudieron validar las cantidades facturadas de ${item.name || "un producto"}.`);
        }
        const previous = quantitiesBySourceId.get(sourceId) || { units: 0, boxes: 0 };
        previous.units += units;
        previous.boxes += boxes;
        quantitiesBySourceId.set(sourceId, previous);
    });

    return [...quantitiesBySourceId.entries()].map(([sourceId, quantities]) => {
        const product = products.find(candidate => String(supabaseProductMetadata.get(candidate)?.sourceId ?? "") === sourceId);
        if (!product) throw new Error(`El producto ${sourceId} no está disponible en el catálogo actual.`);
        if (!Number.isInteger(product.unitsPerBox) || product.unitsPerBox <= 0) {
            throw new Error(`Configura las unidades por caja de ${product.name} antes de facturarlo.`);
        }
        if (!Number.isInteger(product.stock) || product.stock < 0) {
            throw new Error(`El stock en cajas de ${product.name} no está configurado.`);
        }

        const looseUnits = Number.isInteger(product.looseUnits) && product.looseUnits >= 0
            ? product.looseUnits
            : 0;
        const currentUnits = product.stock * product.unitsPerBox + looseUnits;
        const requestedUnits = quantities.boxes * product.unitsPerBox + quantities.units;
        const updatedUnits = currentUnits + direction * requestedUnits;
        if (updatedUnits < 0) {
            throw new Error(`Stock insuficiente de ${product.name}. Disponible: ${currentUnits} ${product.unit}.`);
        }

        return {
            product,
            boxes: Math.floor(updatedUnits / product.unitsPerBox),
            looseUnits: updatedUnits % product.unitsPerBox
        };
    });
}

function applyInvoiceStockChanges(changes) {
    changes.forEach(change => {
        change.product.stock = change.boxes;
        change.product.looseUnits = change.looseUnits;
    });
    renderProducts(getVisibleProducts());
    renderInventory();
}

function readCachedProductRows() {
    try {
        const cache = JSON.parse(localStorage.getItem(PRODUCT_CACHE_STORAGE_KEY) || "null");
        if (!cache || !Array.isArray(cache.rows)) return null;
        productCacheTimestamp = cache.savedAt || null;
        return cache.rows;
    } catch (error) {
        console.error("No se pudo leer el catálogo guardado:", error);
        return null;
    }
}

function loadCachedProducts() {
    const rows = readCachedProductRows();
    if (!rows) return false;
    products = rows.map(mapSupabaseProduct).filter(Boolean);
    loadDeletedProducts();
    return true;
}

function updateConnectionStatus(message = null, isError = false) {
    const status = document.getElementById("connection-status");
    if (!status) return;

    if (!message && !navigator.onLine) {
        const cachedAt = productCacheTimestamp ? new Date(productCacheTimestamp).toLocaleString("es-VE") : "sin una copia local confirmada";
        message = `Sin conexión. Los precios y el stock pueden estar desactualizados (${cachedAt}). Las facturas quedarán pendientes de sincronización.`;
        isError = true;
    }
    if (!message) {
        status.classList.add("hidden");
        return;
    }

    status.className = isError
        ? "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        : "rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900";
    status.textContent = message;
}

async function synchronizeAfterReconnect(isManualRefresh = false) {
    if (!hasAuthenticatedSupabaseSession) {
        updateConnectionStatus("Conexión restablecida. Inicia sesión para sincronizar los datos.");
        return;
    }

    const failures = [];
    try {
        await loadProductsFromSupabase();
        if (productsFromCache) failures.push("el catálogo sigue mostrando datos guardados");
        else if (productLoadError) failures.push(productLoadError);
    } catch (error) {
        failures.push(`catálogo: ${error.message}`);
    }
    try {
        await loadInvoicesFromSupabase();
    } catch (error) {
        console.error("No se pudieron sincronizar las facturas al recuperar la conexión:", error);
        failures.push(`facturas: ${error.message}`);
    }
    try {
        await syncCustomersFromInvoiceHistory();
    } catch (error) {
        console.error("No se pudieron sincronizar los clientes al recuperar la conexión:", error);
        failures.push(`clientes: ${error.message}`);
    }
    try {
        await loadClientRegistryFromSupabase();
        if (clientsLoadError) failures.push(clientsLoadError);
        else if (clientsFromCache) failures.push("el registro de clientes sigue mostrando datos guardados");
    } catch (error) {
        failures.push(`registro de clientes: ${error.message}`);
    }

    if (failures.length > 0) {
        const message = isManualRefresh
            ? `Actualización incompleta desde Supabase: ${failures.join("; ")}.`
            : `Conexión restablecida, pero quedan datos por actualizar: ${failures.join("; ")}.`;
        updateConnectionStatus(message, true);
        return;
    }

    const successMessage = isManualRefresh
        ? "Datos actualizados desde Supabase: catálogo, facturas y clientes."
        : "Conexión restablecida. Catálogo, facturas y clientes sincronizados.";
    updateConnectionStatus(successMessage);
    window.setTimeout(() => {
        const status = document.getElementById("connection-status");
        if (navigator.onLine && status && status.textContent === successMessage) updateConnectionStatus();
    }, 4000);
}

async function refreshAppFromSupabase(buttonId = "supabase-refresh-menu-item") {
    if (!hasAuthenticatedSupabaseSession) {
        updateConnectionStatus("Inicia sesión para actualizar los datos desde Supabase.", true);
        return;
    }
    if (!navigator.onLine) {
        updateConnectionStatus("Sin conexión. No se pueden consultar los datos actuales de Supabase.", true);
        return;
    }

    const button = document.getElementById(buttonId);
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Actualizando...';
    updateConnectionStatus("Actualizando catálogo, facturas y clientes desde Supabase...");
    try {
        await synchronizeAfterReconnect(true);
    } finally {
        button.disabled = false;
        button.innerHTML = originalLabel;
        const dashboard = document.getElementById("admin-dashboard-view");
        if (currentUserRole === "boss" && !dashboard.classList.contains("hidden")) {
            renderAdminDashboard();
        }
    }
}

async function loadProductsFromSupabase() {
    productsLoading = true;
    productLoadError = "";
    productsFromCache = false;
    renderProducts([]);

    if (!navigator.onLine || !supabaseClient) {
        if (loadCachedProducts()) {
            productsFromCache = true;
            productLoadError = products.length === 0 ? "El catálogo guardado no contiene productos." : "";
            const message = !navigator.onLine
                ? "Sin conexión. Mostrando el catálogo guardado; los precios y stock pueden estar desactualizados."
                : "No se pudo iniciar Supabase. Mostrando el catálogo guardado; los precios y stock pueden estar desactualizados.";
            updateConnectionStatus(message, true);
        } else {
            productLoadError = !navigator.onLine
                ? "No hay conexión ni un catálogo guardado."
                : "No se pudo iniciar Supabase y no hay un catálogo guardado.";
            updateConnectionStatus("No se pudo cargar el catálogo y no hay una copia local.", true);
        }
        productsLoading = false;
        renderCategoryFilters();
        renderProducts(getVisibleProducts());
        renderInventory();
        updateTotals();
        renderBilling();
        return;
    }

    try {
        const { data, error } = await supabaseClient.from("productos").select("*");
        if (error) throw error;

        const rows = data || [];
        productCacheTimestamp = new Date().toISOString();
        try {
            localStorage.setItem(PRODUCT_CACHE_STORAGE_KEY, JSON.stringify({
                savedAt: productCacheTimestamp,
                rows
            }));
        } catch (cacheError) {
            console.error("No se pudo guardar una copia local del catálogo:", cacheError);
            updateConnectionStatus("No se pudo guardar el catálogo para usarlo sin conexión.", true);
        }

        products = rows.map(mapSupabaseProduct).filter(Boolean);
        if (products.length === 0) {
            productLoadError = "Supabase no devolvió productos visibles. Revisa que Productos tenga registros y una política SELECT.";
        }

        loadDeletedProducts();
        if (navigator.onLine) updateConnectionStatus();
    } catch (error) {
        console.error("No se pudieron cargar productos desde Supabase:", error);
        if (loadCachedProducts()) {
            productsFromCache = true;
            productLoadError = products.length === 0 ? "El catálogo guardado no contiene productos." : "";
            const cachedAt = productCacheTimestamp ? new Date(productCacheTimestamp).toLocaleString("es-VE") : "fecha desconocida";
            updateConnectionStatus(`No se pudo actualizar el catálogo desde Supabase. Mostrando precios y stock guardados el ${cachedAt}; pueden estar desactualizados.`, true);
        } else {
            products = [];
            productLoadError = "No se pudieron cargar productos y no hay un catálogo guardado para usar sin conexión.";
            updateConnectionStatus("No hay conexión ni una copia local del catálogo.", true);
        }
    } finally {
        productsLoading = false;
        renderCategoryFilters();
        renderProducts(getVisibleProducts());
        renderInventory();
        updateTotals();
        renderBilling();
    }
}

async function initializeAccessGate() {
    if (!supabaseClient) {
        setAccessError("No se pudo iniciar Supabase. Revisa la conexión y la configuración.");
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (data.session) {
            const { error: signOutError } = await supabaseClient.auth.signOut({ scope: "local" });
            if (signOutError) throw signOutError;
        }
    } catch (error) {
        console.error("No se pudo cerrar la sesión anterior de Supabase:", error);
        setAccessError("No se pudo cerrar la sesión anterior. Comprueba la conexión e intenta de nuevo.");
    }
}

function setAccessError(message) {
    const error = document.getElementById("access-error");
    error.textContent = message;
    error.classList.remove("hidden");
}

async function selectLoginRole(role) {
    if (!["boss", "seller"].includes(role)) return;
    selectedLoginRole = role;
    document.getElementById("access-error").classList.add("hidden");
    document.getElementById("role-selection").classList.add("hidden");
    document.getElementById("login-role-label").textContent = role === "boss" ? "Inicio de sesión de administrador" : "Inicio de sesión de vendedor";
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("login-email").focus();
}

function backToRoleSelection() {
    selectedLoginRole = null;
    document.getElementById("login-form").reset();
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("role-selection").classList.remove("hidden");
    document.getElementById("access-error").classList.add("hidden");
}

async function loginUser(event) {
    event.preventDefault();
    document.getElementById("access-error").classList.add("hidden");
    if (!selectedLoginRole) {
        setAccessError("Selecciona Administrador o Vendedor para continuar.");
        return;
    }
    if (!supabaseClient) {
        setAccessError("No se pudo iniciar Supabase. Revisa la conexión y la configuración.");
        return;
    }

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await enterApp(data.user, selectedLoginRole);
    } catch (error) {
        console.error("No se pudo iniciar sesión:", error);
        const { error: signOutError } = await supabaseClient.auth.signOut();
        if (signOutError) console.error("No se pudo cerrar la sesión sin rol:", signOutError);
        setAccessError(error.message || "No se pudo iniciar sesión.");
    }
}

async function enterApp(user, requestedRole = null) {
    const { data: roleRecord, error } = await supabaseClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
    if (error) throw error;
    if (!roleRecord || !["boss", "seller"].includes(roleRecord.role)) {
        throw new Error("Esta cuenta no tiene un rol asignado. Contacta al administrador.");
    }
    if (requestedRole && roleRecord.role !== requestedRole) {
        throw new Error("La cuenta ingresada no tiene el rol seleccionado.");
    }

    currentUserId = user.id;
    hasAuthenticatedSupabaseSession = true;
    await enterAppForRole(roleRecord.role);
}

async function enterAppForRole(role) {
    currentUserRole = role;
    document.getElementById("access-gate").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    document.getElementById("user-role-badge").textContent = role === "boss" ? "Administrador" : "Vendedor";
    document.getElementById("sidebar-user-role").textContent = role === "boss" ? "Administrador" : "Vendedor";
    document.getElementById("admin-dashboard-menu").classList.toggle("hidden", currentUserRole !== "boss");
    document.getElementById("password-settings-menu").classList.toggle("hidden", currentUserRole !== "boss");
    document.getElementById("manual-rate-menu").classList.toggle("hidden", currentUserRole !== "boss");
    document.getElementById("manual-rate-form-container").classList.toggle("hidden", currentUserRole !== "boss");
    document.getElementById("logout-menu-item").classList.remove("hidden");
    await loadProductsFromSupabase();
    try {
        await loadInvoicesFromSupabase();
    } catch (error) {
        console.error("No se pudieron cargar o sincronizar facturas:", error);
        alert(error.message || "No se pudieron sincronizar las facturas con Supabase.");
    }
    try {
        await syncCustomersFromInvoiceHistory();
    } catch (error) {
        console.error("No se pudieron sincronizar clientes desde las facturas:", error);
        alert(error.message || "No se pudieron sincronizar los clientes con Supabase.");
    }
    await loadClientRegistryFromSupabase();
    renderProducts(getVisibleProducts());
    renderInventory();
    renderBilling();
    renderInvoiceHistory();
    showView("order");
    loadSharedExchangeRate();
}

async function logoutUser() {
    if (hasAuthenticatedSupabaseSession) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
            console.error("No se pudo cerrar sesión:", error);
            alert("No se pudo cerrar la sesión. Intenta nuevamente.");
            return;
        }
    }

    currentUserRole = null;
    currentUserId = null;
    selectedLoginRole = null;
    hasAuthenticatedSupabaseSession = false;
    lastSentInvoice = null;
    activeInvoicePreview = null;
    viewingHistoricalInvoice = null;
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("access-gate").classList.remove("hidden");
    document.getElementById("login-form").reset();
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("role-selection").classList.remove("hidden");
    document.getElementById("login-password").value = "";
    document.getElementById("access-error").classList.add("hidden");
    closeAppSidebar();
}

async function changeUserPassword(event) {
    event.preventDefault();
    if (currentUserRole !== "boss") {
        alert("Solo el administrador puede cambiar la contraseña.");
        return;
    }

    const form = event.currentTarget;
    const newPassword = form.elements.newPassword.value;
    if (newPassword !== form.elements.confirmPassword.value) {
        alert("La nueva contraseña y su confirmación no coinciden.");
        return;
    }

    try {
        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
        if (error) throw error;
        form.reset();
        alert("La contraseña de la cuenta fue actualizada.");
    } catch (error) {
        console.error("No se pudo actualizar la contraseña:", error);
        alert(error.message || "No se pudo actualizar la contraseña.");
    }
}

function openManualExchangeRateView() {
    if (currentUserRole !== "boss") {
        alert("Solo el administrador puede configurar la tasa manual.");
        return;
    }
    showView("currency");
    document.getElementById("manual-rate-form-container").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveManualExchangeRate(event) {
    event.preventDefault();
    const status = document.getElementById("manual-rate-status");
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    if (currentUserRole !== "boss" || !hasAuthenticatedSupabaseSession || !currentUserId) {
        status.className = "mt-2 text-sm text-red-700";
        status.textContent = "Solo el administrador con sesión iniciada puede guardar la tasa.";
        return;
    }

    const rate = Number(document.getElementById("manual-rate-input").value);
    if (!Number.isFinite(rate) || rate <= 0) {
        status.className = "mt-2 text-sm text-red-700";
        status.textContent = "Ingresa una tasa válida mayor que cero.";
        return;
    }

    submitButton.disabled = true;
    status.className = "mt-2 text-sm text-slate-600";
    status.textContent = "Guardando la tasa en Supabase...";
    try {
        const effectiveDate = getCaracasDateKey();
        const { data, error } = await supabaseClient
            .from("bcv_manual_rate")
            .upsert({
                id: 1,
                rate,
                effective_date: effectiveDate,
                updated_at: new Date().toISOString(),
                updated_by: currentUserId
            }, { onConflict: "id" })
            .select("rate,effective_date")
            .single();
        if (error) throw error;
        if (!data || !Number.isFinite(Number(data.rate)) || Number(data.rate) <= 0 || !data.effective_date) {
            throw new Error("Supabase no devolvió una tasa compartida válida.");
        }

        const savedRate = {
            rate: Number(data.rate),
            effectiveDate: String(data.effective_date)
        };
        document.getElementById("manual-rate-input").value = String(savedRate.rate);
        showExchangeRate(savedRate);
        status.className = "mt-2 text-sm text-emerald-700";
        status.textContent = "La tasa quedó guardada en Supabase y ya está disponible para todos los usuarios.";
    } catch (error) {
        console.error("No se pudo guardar la tasa manual compartida:", error);
        status.className = "mt-2 text-sm text-red-700";
        status.textContent = `No se pudo guardar la tasa en Supabase. ${error.message || "Verifica la conexión y los permisos."}`;
    } finally {
        submitButton.disabled = false;
    }
}

function showView(view) {
    if (view !== "final-invoice") viewingHistoricalInvoice = null;
    if (view === "admin-dashboard" && currentUserRole !== "boss") {
        alert("Solo el administrador puede acceder al panel de control.");
        return;
    }
    if (view === "security-settings" && currentUserRole !== "boss") {
        alert("Solo el jefe puede administrar las contraseñas.");
        return;
    }
    if (view === "final-invoice" && !activeInvoicePreview && !viewingHistoricalInvoice && !lastSentInvoice) {
        alert("La factura lista aparecerá después de preparar una vista previa o emitir una factura.");
        return;
    }
    const showOrder = view === "order";
    const showStock = view === "stock";
    const showHistory = view === "history";
    const showCollections = view === "collections";
    const showCurrency = view === "currency";
    const showClients = view === "clients";
    const showSecuritySettings = view === "security-settings";
    const showAdminDashboard = view === "admin-dashboard";
    const showFinalInvoice = view === "final-invoice";
    document.getElementById("section-navigation-actions").classList.toggle("hidden", showOrder);
    document.getElementById("admin-dashboard-view").classList.toggle("hidden", !showAdminDashboard);
    document.getElementById("order-view").classList.toggle("hidden", !showOrder);
    document.getElementById("stock-view").classList.toggle("hidden", !showStock);
    document.getElementById("final-invoice-view").classList.toggle("hidden", !showFinalInvoice);
    document.getElementById("history-view").classList.toggle("hidden", !showHistory);
    document.getElementById("collections-view").classList.toggle("hidden", !showCollections);
    document.getElementById("currency-view").classList.toggle("hidden", !showCurrency);
    document.getElementById("clients-view").classList.toggle("hidden", !showClients);
    document.getElementById("security-settings-view").classList.toggle("hidden", !showSecuritySettings);
    document.getElementById("order-footer").classList.toggle("hidden", !showOrder);
    document.querySelectorAll("[data-app-view]").forEach(button => {
        const isCurrentView = button.dataset.appView === view;
        button.classList.toggle("active", isCurrentView);
        if (isCurrentView) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });

    if (showStock) renderInventory();
    if (showOrder) renderBilling();
    if (showFinalInvoice) renderFinalInvoice(activeInvoicePreview || viewingHistoricalInvoice || lastSentInvoice);
    if (showAdminDashboard) {
        renderAdminDashboard();
        renderSalesReports();
    }
    if (showHistory) renderInvoiceHistory();
    if (showCollections) {
        renderCreditCollections();
        if (!collectionBanksLoaded && !collectionBanksLoading) loadCollectionBanksFromSupabase();
    }
    if (showCurrency) loadSharedExchangeRate();
    if (showClients) loadClientRegistryFromSupabase();
}

function renderAdminDashboard() {
    if (currentUserRole !== "boss") return;

    const currentMonth = getCaracasDateKey().slice(0, 7);
    const monthlyTotals = new Map();

    invoiceHistory.forEach(invoice => {
        const date = new Date(invoice.date || invoice.updatedAt);
        if (!Number.isFinite(date.getTime())) return;
        const month = getCaracasDateKey(date).slice(0, 7);
        const totals = monthlyTotals.get(month) || { sales: 0, invoiceCount: 0 };
        totals.invoiceCount += 1;
        const amount = invoice.total == null || String(invoice.total).trim() === ""
            ? null
            : Number(invoice.total);
        if (amount !== null && Number.isFinite(amount) && amount >= 0) totals.sales += amount;
        monthlyTotals.set(month, totals);
    });

    const [currentYear, currentMonthNumber] = currentMonth.split("-").map(Number);
    const previousMonth = new Date(Date.UTC(currentYear, currentMonthNumber - 2, 1))
        .toISOString()
        .slice(0, 7);
    const currentTotals = monthlyTotals.get(currentMonth) || { sales: 0, invoiceCount: 0 };
    const previousTotals = monthlyTotals.get(previousMonth) || { sales: 0, invoiceCount: 0 };
    const creditInvoiceCount = invoiceHistory.filter(invoice =>
        String(invoice.paymentMethod || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase() === "credito"
    ).length;
    document.getElementById("admin-month-sales").textContent = `$${currentTotals.sales.toFixed(2)}`;
    document.getElementById("admin-month-invoices").textContent = String(currentTotals.invoiceCount);
    document.getElementById("admin-product-count").textContent = String(products.length);
    document.getElementById("admin-credit-invoice-count").textContent = String(creditInvoiceCount);

    const renderMonthlyChange = (elementId, current, previous) => {
        const element = document.getElementById(elementId);
        if (previous === 0) {
            element.textContent = current === 0 ? "Sin base de comparación" : "↑ Nuevo vs. mes anterior";
            element.className = current === 0
                ? "mt-1 text-[10px] text-slate-500 sm:text-xs"
                : "mt-1 text-[10px] font-semibold text-emerald-700 sm:text-xs";
            return;
        }

        const difference = ((current - previous) / previous) * 100;
        const direction = difference > 0 ? "↑" : difference < 0 ? "↓" : "→";
        const color = difference > 0 ? "text-emerald-700" : difference < 0 ? "text-red-700" : "text-slate-500";
        element.textContent = `${direction} ${Math.abs(difference).toFixed(1)}% vs. mes anterior`;
        element.className = `mt-1 text-[10px] font-semibold ${color} sm:text-xs`;
    };
    renderMonthlyChange("admin-month-sales-change", currentTotals.sales, previousTotals.sales);
    renderMonthlyChange("admin-month-invoices-change", currentTotals.invoiceCount, previousTotals.invoiceCount);

    const months = Array.from({ length: 12 }, (_, index) => {
        const date = new Date(Date.UTC(currentYear, currentMonthNumber - 12 + index, 1));
        const key = date.toISOString().slice(0, 7);
        return {
            label: new Intl.DateTimeFormat("es-VE", { month: "short", timeZone: "UTC" })
                .format(new Date(`${key}-15T12:00:00Z`)),
            amount: (monthlyTotals.get(key) || { sales: 0 }).sales
        };
    });
    const maxSales = Math.max(...months.map(month => month.amount), 0);
    const chart = document.getElementById("admin-dashboard-chart");
    chart.replaceChildren();
    chart.setAttribute("aria-label", `Ventas mensuales desde ${months[0].label} hasta ${months[months.length - 1].label}.`);
    months.forEach(month => {
        const column = document.createElement("div");
        column.className = "flex min-w-0 flex-1 flex-col items-center gap-1 sm:gap-2";
        const amount = document.createElement("span");
        amount.className = "max-w-full truncate text-[8px] font-medium text-slate-500 sm:text-[10px]";
        amount.textContent = month.amount > 0 ? `$${month.amount.toFixed(0)}` : "—";
        const track = document.createElement("div");
        track.className = "flex h-32 w-full items-end justify-center";
        const bar = document.createElement("div");
        bar.className = "w-full max-w-10 rounded-t bg-gradient-to-t from-blue-700 to-sky-400 transition-all";
        bar.style.height = `${maxSales > 0 ? Math.max(5, (month.amount / maxSales) * 100) : 2}%`;
        bar.title = `${month.label}: $${month.amount.toFixed(2)}`;
        track.appendChild(bar);
        const label = document.createElement("span");
        label.className = "max-w-full truncate text-[9px] capitalize text-slate-500 sm:text-[10px]";
        label.textContent = month.label.replace(".", "");
        label.title = month.label;
        column.append(amount, track, label);
        chart.appendChild(column);
    });

    const recentInvoices = invoiceHistory
        .map(invoice => ({ invoice, timestamp: new Date(invoice.date || invoice.updatedAt).getTime() }))
        .filter(entry => Number.isFinite(entry.timestamp))
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, 5);
    const activities = document.getElementById("admin-recent-activity");
    activities.replaceChildren();
    if (recentInvoices.length === 0) {
        const emptyActivity = document.createElement("p");
        emptyActivity.className = "py-6 text-center text-xs text-slate-500";
        emptyActivity.textContent = "Todavía no hay actividad reciente.";
        activities.appendChild(emptyActivity);
    } else {
        const relativeTime = new Intl.RelativeTimeFormat("es", { numeric: "auto", style: "short" });
        recentInvoices.slice(0, 3).forEach(({ invoice, timestamp }) => {
            const elapsedMinutes = Math.round((timestamp - Date.now()) / 60000);
            const elapsedHours = Math.round(elapsedMinutes / 60);
            const elapsedDays = Math.round(elapsedHours / 24);
            const timeLabel = Math.abs(elapsedMinutes) < 60
                ? relativeTime.format(elapsedMinutes, "minute")
                : Math.abs(elapsedHours) < 24
                    ? relativeTime.format(elapsedHours, "hour")
                    : relativeTime.format(elapsedDays, "day");
            const activity = document.createElement("div");
            activity.className = "flex items-center gap-2.5 py-3 sm:gap-3";
            const icon = document.createElement("span");
            icon.className = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-xs text-blue-700";
            const iconElement = document.createElement("i");
            iconElement.className = "fa-solid fa-file-invoice";
            iconElement.setAttribute("aria-hidden", "true");
            icon.appendChild(iconElement);
            const description = document.createElement("div");
            description.className = "min-w-0 flex-1";
            const title = document.createElement("p");
            title.className = "truncate text-[11px] font-semibold text-slate-800";
            title.textContent = `Factura ${invoice.number || "registrada"}`;
            const subtitle = document.createElement("p");
            subtitle.className = "mt-1 truncate text-[10px] text-slate-500";
            subtitle.textContent = `${invoice.clientName || "Cliente sin nombre"} · ${timeLabel}`;
            description.append(title, subtitle);
            const amount = document.createElement("span");
            amount.className = "shrink-0 text-[10px] font-semibold text-slate-700";
            amount.textContent = invoice.total == null || !Number.isFinite(Number(invoice.total))
                ? "Por cotizar"
                : `$${Number(invoice.total).toFixed(2)}`;
            activity.append(icon, description, amount);
            activities.appendChild(activity);
        });
    }

    const tableBody = document.getElementById("admin-recent-invoices");
    tableBody.replaceChildren();
    if (recentInvoices.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.className = "px-4 py-6 text-center text-slate-500 sm:px-5";
        cell.colSpan = 5;
        cell.textContent = "Todavía no hay facturas disponibles.";
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }

    recentInvoices.forEach(({ invoice, timestamp }) => {
        const row = document.createElement("tr");
        const date = new Date(timestamp);
        const values = [
            invoice.number || "Sin número",
            invoice.clientName || "Cliente sin nombre",
            new Intl.DateTimeFormat("es-VE", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "America/Caracas"
            }).format(date),
            invoice.paymentMethod || "No especificado",
            invoice.total == null || !Number.isFinite(Number(invoice.total))
                ? "Por cotizar"
                : `$${Number(invoice.total).toFixed(2)}`
        ];
        values.forEach((value, index) => {
            const cell = document.createElement("td");
            cell.className = index === 4
                ? "px-4 py-3 text-right font-semibold text-slate-800 sm:px-5"
                : "px-4 py-3 text-slate-600 sm:px-5";
            if (index === 0) cell.classList.add("font-semibold", "text-slate-900");
            cell.textContent = value;
            row.appendChild(cell);
        });
        tableBody.appendChild(row);
    });
}

async function loadSharedExchangeRate() {
    const status = document.getElementById("currency-rate-status");
    status.className = "mt-3 text-sm text-slate-600";
    status.textContent = "Consultando la tasa compartida en Supabase...";
    document.getElementById("currency-usd-amount").disabled = true;
    document.getElementById("currency-ves-amount").disabled = true;

    try {
        const rate = await loadSharedExchangeRateFromSupabase();
        if (currentUserRole === "boss") {
            document.getElementById("manual-rate-input").value = rate ? String(rate.rate) : "";
        }
        if (!rate) {
            dollarRate = null;
            document.getElementById("currency-rate-value").textContent = "--";
            document.getElementById("header-bcv-rate").textContent = "BCV: --";
            document.getElementById("currency-rate-date").textContent = "Tasa no configurada";
            document.getElementById("currency-usd-amount").value = "";
            document.getElementById("currency-ves-amount").value = "";
            status.className = "mt-3 text-sm text-amber-700";
            status.textContent = "El administrador debe ingresar y guardar una tasa en Supabase para habilitar la conversión.";
            return;
        }
        showExchangeRate(rate);
    } catch (error) {
        console.error("No se pudo cargar la tasa compartida desde Supabase:", error);
        dollarRate = null;
        document.getElementById("currency-rate-value").textContent = "--";
        document.getElementById("header-bcv-rate").textContent = "BCV: --";
        document.getElementById("currency-rate-date").textContent = "Tasa no disponible";
        document.getElementById("currency-usd-amount").value = "";
        document.getElementById("currency-ves-amount").value = "";
        status.className = "mt-3 text-sm text-red-700";
        status.textContent = `No se pudo cargar la tasa desde Supabase. ${error.message || "Verifica la conexión y los permisos."}`;
    }
}

async function loadSharedExchangeRateFromSupabase() {
    if (!hasAuthenticatedSupabaseSession || !supabaseClient) {
        throw new Error("Inicia sesión para consultar la tasa compartida.");
    }

    const { data, error } = await supabaseClient
        .from("bcv_manual_rate")
        .select("rate,effective_date")
        .eq("id", 1)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const rate = Number(data.rate);
    const effectiveDate = String(data.effective_date || "").trim();
    if (!Number.isFinite(rate) || rate <= 0 || !effectiveDate) {
        throw new Error("La tasa guardada en Supabase no es válida.");
    }
    return { rate, effectiveDate };
}

function getCaracasDateKey(date = new Date()) {
    const parts = new Map(new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Caracas",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

function showExchangeRate(rateData) {
    dollarRate = rateData.rate;
    const formattedRate = new Intl.NumberFormat("es-VE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
    }).format(rateData.rate);
    document.getElementById("currency-rate-value").textContent = formattedRate;
    document.getElementById("header-bcv-rate").textContent = `BCV: ${formattedRate}`;
    document.getElementById("currency-rate-date").textContent =
        `Tasa actualizada: ${new Date(`${rateData.effectiveDate}T12:00:00Z`).toLocaleDateString("es-VE", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "UTC"
        })}`;
    document.getElementById("currency-rate-mode").textContent = "Tasa manual compartida";
    document.getElementById("currency-usd-amount").disabled = false;
    document.getElementById("currency-ves-amount").disabled = false;

    const status = document.getElementById("currency-rate-status");
    status.className = "mt-3 text-sm text-slate-600";
    status.textContent = "Tasa compartida guardada en Supabase por el administrador.";

    if (document.getElementById("currency-usd-amount").value || document.getElementById("currency-ves-amount").value) {
        if (lastEditedCurrency === "usd") convertUsdToBolivares();
        else convertBolivaresToUsd();
    }
}

function convertUsdToBolivares() {
    const usdInput = document.getElementById("currency-usd-amount");
    const vesInput = document.getElementById("currency-ves-amount");
    lastEditedCurrency = "usd";
    const amount = Number(usdInput.value);
    vesInput.value = usdInput.value === "" || !Number.isFinite(amount) || amount < 0 || !dollarRate
        ? ""
        : (amount * dollarRate).toFixed(2);
}

function convertBolivaresToUsd() {
    const usdInput = document.getElementById("currency-usd-amount");
    const vesInput = document.getElementById("currency-ves-amount");
    lastEditedCurrency = "ves";
    const amount = Number(vesInput.value);
    usdInput.value = vesInput.value === "" || !Number.isFinite(amount) || amount < 0 || !dollarRate
        ? ""
        : (amount / dollarRate).toFixed(2);
}

function clearCurrencyAmounts() {
    document.getElementById("currency-usd-amount").value = "";
    document.getElementById("currency-ves-amount").value = "";
}

function openSecuritySettings() {
    if (currentUserRole !== "boss") {
        alert("Solo el jefe puede administrar las contraseñas.");
        return;
    }
    showView("security-settings");
}

function updateCurrentDate() {
    document.getElementById("current-date").textContent = new Date().toLocaleDateString("es-VE", {
        weekday: "long",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "America/Caracas"
    });
}

function getSalesReportPeriods() {
    const today = getCaracasDateKey();
    const [year, month, day] = today.split("-").map(Number);
    const todayUtc = new Date(Date.UTC(year, month - 1, day));
    const daysSinceMonday = (todayUtc.getUTCDay() + 6) % 7;
    const weekStart = new Date(todayUtc);
    weekStart.setUTCDate(todayUtc.getUTCDate() - daysSinceMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const toKey = date => date.toISOString().slice(0, 10);
    const formatKey = key => new Date(`${key}T12:00:00Z`).toLocaleDateString("es-VE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC"
    });

    return {
        weekly: {
            start: toKey(weekStart),
            end: toKey(weekEnd),
            label: `${formatKey(toKey(weekStart))} - ${formatKey(toKey(weekEnd))}`
        },
        monthly: {
            start: toKey(monthStart),
            end: toKey(monthEnd),
            label: new Date(`${today}T12:00:00Z`).toLocaleDateString("es-VE", {
                month: "long",
                year: "numeric",
                timeZone: "UTC"
            })
        }
    };
}

function loadInvoiceHistory() {
    try {
        const savedInvoices = JSON.parse(localStorage.getItem("invoiceHistory") || "[]");
        invoiceHistory = Array.isArray(savedInvoices) ? savedInvoices : [];
        const highestSequence = invoiceHistory.reduce((highest, invoice) => Math.max(highest, Number(invoice.sequence) || 0), 0);
        const storedSequence = Number(localStorage.getItem("invoiceSequence")) || 0;
        if (highestSequence > storedSequence) {
            try {
                localStorage.setItem("invoiceSequence", String(highestSequence));
            } catch (error) {
                // Keep the loaded history usable if local storage is full.
            }
        }
    } catch (error) {
        invoiceHistory = [];
        localStorage.removeItem("invoiceHistory");
    }
}

function getInvoiceKey(invoice) {
    return JSON.stringify([invoice.userId || "", invoice.number]);
}

function toSupabaseInvoiceRecord(invoice) {
    const { syncPending, stockPending, stockReservedLocally, ...invoiceData } = invoice;
    return {
        user_id: invoice.userId || currentUserId,
        numero: invoice.number,
        datos: invoiceData,
        updated_at: invoice.updatedAt || invoice.date || new Date().toISOString()
    };
}

async function syncInvoiceToSupabase(invoice) {
    if (!hasAuthenticatedSupabaseSession || !currentUserId) {
        throw new Error("Debes iniciar sesión para sincronizar facturas.");
    }

    const { error } = await supabaseClient
        .from("facturas")
        .upsert(toSupabaseInvoiceRecord(invoice), { onConflict: "user_id,numero" });
    if (error) throw error;
}

async function finalizeInvoiceAndDecrementStock(invoice) {
    if (!hasAuthenticatedSupabaseSession || !currentUserId) {
        throw new Error("Debes iniciar sesión para emitir facturas.");
    }
    const { error } = await supabaseClient.rpc("finalize_invoice_and_decrement_stock", {
        p_invoice: invoice
    });
    if (error) throw error;
}

async function loadInvoicesFromSupabase() {
    if (!hasAuthenticatedSupabaseSession || !currentUserId) {
        throw new Error("Debes iniciar sesión para cargar facturas.");
    }

    const localInvoices = invoiceHistory
        .map(invoice => {
            const isLegacyInvoice = !invoice.userId;
            return {
                ...invoice,
                userId: invoice.userId || currentUserId,
                updatedAt: invoice.updatedAt || invoice.date || new Date().toISOString(),
                syncPending: invoice.syncPending === true || isLegacyInvoice
            };
        })
        .filter(invoice => currentUserRole === "boss" || invoice.userId === currentUserId);
    invoiceHistory = localInvoices;
    if (!navigator.onLine) {
        renderInvoiceHistory();
        return;
    }

    const { data, error } = await supabaseClient
        .from("facturas")
        .select("user_id,numero,datos,updated_at")
        .order("updated_at", { ascending: false });
    if (error) throw error;

    const remoteInvoices = (data || []).map(record => ({
        ...record.datos,
        number: record.numero,
        userId: record.user_id,
        updatedAt: record.updated_at,
        syncPending: false
    }));
    const remoteByKey = new Map(remoteInvoices.map(invoice => [getInvoiceKey(invoice), invoice]));
    const mergedInvoices = new Map(remoteByKey);
    const pendingSync = new Map();

    localInvoices.forEach(invoice => {
        const key = getInvoiceKey(invoice);
        const remoteInvoice = remoteByKey.get(key);
        const localIsNewer = !remoteInvoice || new Date(invoice.updatedAt).getTime() >= new Date(remoteInvoice.updatedAt).getTime();
        if (invoice.userId === currentUserId && invoice.syncPending && localIsNewer) {
            mergedInvoices.set(key, invoice);
            pendingSync.set(key, invoice);
        }
    });

    invoiceHistory = [...mergedInvoices.values()]
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    try {
        localStorage.setItem("invoiceHistory", JSON.stringify(invoiceHistory));
    } catch (error) {
        console.error("No se pudo actualizar el historial local de facturas:", error);
    }

    const currentUserSequence = invoiceHistory
        .filter(invoice => invoice.userId === currentUserId)
        .reduce((highest, invoice) => Math.max(highest, Number(invoice.sequence) || 0), 0);
    const storedSequence = Number(localStorage.getItem("invoiceSequence")) || 0;
    if (currentUserSequence > storedSequence) {
        try {
            localStorage.setItem("invoiceSequence", String(currentUserSequence));
        } catch (error) {
            console.error("No se pudo actualizar la secuencia local de facturas:", error);
        }
    }

    if (pendingSync.size > 0) {
        let stockChanged = false;
        for (const invoice of pendingSync.values()) {
            if (invoice.stockPending) {
                await finalizeInvoiceAndDecrementStock(invoice);
                invoice.stockPending = false;
                invoice.stockReservedLocally = false;
                stockChanged = true;
            } else {
                await syncInvoiceToSupabase(invoice);
            }
            invoice.syncPending = false;
        }
        try {
            localStorage.setItem("invoiceHistory", JSON.stringify(invoiceHistory));
        } catch (error) {
            console.error("No se pudo guardar localmente el estado de sincronización:", error);
        }
        if (stockChanged) await loadProductsFromSupabase();
    }

    renderInvoiceHistory();
}
