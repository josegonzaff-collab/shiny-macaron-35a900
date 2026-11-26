// Preparacion, emision e historial de facturas.
function renderBilling() {
    const name = document.getElementById("client-name").value.trim();
    const phone = document.getElementById("client-phone").value.trim();
    const route = document.getElementById("client-route").value;
    const clientInfo = document.getElementById("billing-client-info");
    clientInfo.replaceChildren();
    [
        ["Comercio", name || "Pendiente"],
        ["Teléfono", phone || "Pendiente"],
        ["Ruta", route || "Pendiente"]
    ].forEach(([label, value]) => {
        const row = document.createElement("p");
        const labelElement = document.createElement("span");
        labelElement.className = "font-semibold text-slate-700";
        labelElement.textContent = `${label}: `;
        row.append(labelElement, document.createTextNode(value));
        clientInfo.appendChild(row);
    });
    const clientSummary = document.getElementById("order-client-summary");
    if (clientSummary) {
        clientSummary.textContent = name
            ? `${name}${route ? ` · ${route}` : ""}`
            : "Seleccionar cliente";
    }
    const hasItems = Object.keys(cart).length > 0;
    document.getElementById("billing-invoice-number").textContent =
        `N.º ${activeInvoiceNumber || getNextInvoiceNumber()}`;
    document.getElementById("new-invoice-button").classList.toggle("hidden", !invoiceHistory.some(invoice => invoice.number === activeInvoiceNumber && invoice.userId === currentUserId));

    const container = document.getElementById("billing-items");
    container.innerHTML = "";
    const ids = Object.keys(cart);
    if (ids.length === 0) {
        container.innerHTML = '<p class="py-3 text-center text-sm text-slate-400">Todavía no hay productos.</p>';
    }

    let totalAmount = 0;
    let hasPendingPrice = false;
    ids.forEach(id => {
        const prod = products.find(product => product.id == id);
        const quantities = cart[id];
        const details = getOrderDetails(prod, quantities);
        totalAmount += details.subtotal;
        hasPendingPrice ||= details.hasPendingPrice;

        const priceLabels = [];
        if (quantities.unit > 0) {
            const unitPrice = prod.price != null && Number.isFinite(Number(prod.price))
                ? `$${Number(prod.price).toFixed(2)} / ${prod.unit}`
                : "Por cotizar / unidad";
            priceLabels.push(unitPrice);
        }
        if (quantities.box > 0) {
            const boxPrice = prod.boxPrice != null && Number.isFinite(Number(prod.boxPrice))
                ? `$${Number(prod.boxPrice).toFixed(2)} / caja`
                : "Por cotizar / caja";
            priceLabels.push(boxPrice);
        }

        const row = document.createElement("div");
        row.className = "grid grid-cols-[minmax(115px,1.3fr)_minmax(60px,0.8fr)_minmax(85px,1fr)_minmax(60px,0.8fr)] items-center gap-1 px-2 py-3 text-center text-sm sm:grid-cols-[minmax(170px,1.4fr)_minmax(120px,1fr)_minmax(140px,1fr)_minmax(90px,0.7fr)] sm:gap-3 sm:px-3";
        const product = document.createElement("div");
        product.className = "flex min-w-0 items-center gap-1";
        const name = document.createElement("p");
        name.className = "min-w-0 flex-1 break-words text-center font-semibold text-slate-900";
        name.textContent = getProductDisplayName(prod);
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-red-700 sm:p-2";
        removeButton.setAttribute("aria-label", `Quitar ${prod.name} de la factura`);
        removeButton.title = "Quitar producto";
        removeButton.addEventListener("click", () => removeFromInvoice(prod.id));
        const removeIcon = document.createElement("i");
        removeIcon.className = "fa-solid fa-trash-can";
        removeIcon.setAttribute("aria-hidden", "true");
        removeButton.appendChild(removeIcon);
        product.append(name, removeButton);

        const quantity = document.createElement("p");
        quantity.className = "min-w-0 break-words text-center text-xs text-slate-700";
        quantity.textContent = details.quantityLabels;

        const price = document.createElement("p");
        price.className = "min-w-0 break-words text-center text-xs text-slate-700";
        price.textContent = priceLabels.join(" · ");

        const total = document.createElement("p");
        total.className = "min-w-0 break-words text-center text-xs font-semibold text-slate-900";
        total.textContent = details.hasPendingPrice ? "Por cotizar" : `$${details.subtotal.toFixed(2)}`;
        row.append(product, quantity, price, total);
        container.appendChild(row);
    });

    document.getElementById("billing-total").textContent = ids.length === 0
        ? "$0.00"
        : hasPendingPrice ? "Por cotizar" : `$${totalAmount.toFixed(2)}`;
}

function renderFinalInvoice(invoice) {
    if (!invoice) return;
    const isPreview = invoice === activeInvoicePreview;
    const isHistoricalInvoice = invoice === viewingHistoricalInvoice;
    const invoiceDate = new Date(invoice.date);
    const dateLabel = new Intl.DateTimeFormat("es-VE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "America/Caracas"
    }).format(invoiceDate);
    const timeLabel = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "America/Caracas"
    }).format(invoiceDate);
    document.getElementById("final-invoice-number").textContent = `N.º ${invoice.number}`;
    document.getElementById("final-invoice-preview-mark").classList.toggle("hidden", !isPreview);
    document.getElementById("final-invoice-send-button").classList.toggle("hidden", !isPreview);
    document.getElementById("final-invoice-status").classList.toggle("hidden", isHistoricalInvoice);
    document.getElementById("final-invoice-history-back-button").classList.toggle("hidden", !isHistoricalInvoice);
    const clientInfo = document.getElementById("final-invoice-client-info");
    clientInfo.replaceChildren();
    [
        ["Fecha", dateLabel],
        ["Hora", timeLabel],
        ["Comercio", invoice.clientName],
        ["Teléfono", invoice.clientPhone || "No registrado"],
        ["Ruta", invoice.clientRoute]
    ].forEach(([label, value]) => {
        const field = document.createElement("div");
        field.className = "min-w-0";
        const labelElement = document.createElement("p");
        labelElement.className = "text-[9px] font-semibold uppercase tracking-wide text-slate-500";
        labelElement.textContent = label;
        const valueElement = document.createElement("p");
        valueElement.className = "break-words font-semibold text-slate-800";
        valueElement.textContent = value || "No especificado";
        field.append(labelElement, valueElement);
        clientInfo.appendChild(field);
    });
    document.getElementById("final-invoice-payment").textContent = invoice.paymentMethod || "No especificada";
    document.getElementById("final-invoice-total").textContent =
        invoice.total == null ? "Por cotizar" : `$${Number(invoice.total).toFixed(2)}`;
    document.getElementById("new-invoice-button").classList.toggle(
        "hidden",
        isPreview || isHistoricalInvoice || !invoiceHistory.some(saved => saved.number === invoice.number && saved.userId === invoice.userId)
    );

    const container = document.getElementById("final-invoice-items");
    container.innerHTML = "";
    (Array.isArray(invoice.items) ? invoice.items : []).forEach(item => {
        const row = document.createElement("div");
        row.className = "grid grid-cols-[minmax(0,1fr)_minmax(72px,0.55fr)_minmax(76px,0.55fr)] items-start gap-2 px-2 py-2 text-xs sm:px-3";
        const name = document.createElement("p");
        name.className = "min-w-0 break-words font-semibold text-slate-900";
        name.textContent = item.name || "Producto";
        const quantity = document.createElement("p");
        quantity.className = "min-w-0 break-words text-[10px] text-slate-700";
        quantity.textContent = item.quantityLabels || "Cantidad no disponible";
        const total = document.createElement("p");
        total.className = "text-right text-[10px] font-semibold text-slate-900";
        total.textContent = item.subtotal == null ? "Por cotizar" : `$${Number(item.subtotal).toFixed(2)}`;
        row.append(name, quantity, total);
        container.appendChild(row);
    });
}

function createInvoiceRecord(number, date) {
    let totalAmount = 0;
    let hasPendingPrice = false;
    const items = Object.entries(cart).map(([id, quantities]) => {
        const prod = products.find(product => product.id == id);
        const details = getOrderDetails(prod, quantities);
        totalAmount += details.subtotal;
        hasPendingPrice ||= details.hasPendingPrice;
        return {
            productId: prod.id,
            supabaseProductId: supabaseProductMetadata.get(prod)?.sourceId == null
                ? null
                : String(supabaseProductMetadata.get(prod).sourceId),
            name: getProductDisplayName(prod),
            quantityUnit: quantities.unit,
            quantityBox: quantities.box,
            unitPrice: prod.price != null && prod.price !== "" && Number.isFinite(Number(prod.price))
                ? Number(prod.price)
                : null,
            boxPrice: prod.boxPrice != null && prod.boxPrice !== "" && Number.isFinite(Number(prod.boxPrice))
                ? Number(prod.boxPrice)
                : null,
            unitsPerBox: Number.isInteger(Number(prod.unitsPerBox)) && Number(prod.unitsPerBox) > 0
                ? Number(prod.unitsPerBox)
                : null,
            quantityLabels: details.quantityLabels,
            subtotal: details.hasPendingPrice ? null : details.subtotal
        };
    });

    return {
        number,
        sequence: Number(number.slice(4)),
        date,
        clientName: document.getElementById("client-name").value.trim(),
        clientPhone: document.getElementById("client-phone").value.trim(),
        clientRoute: document.getElementById("client-route").value,
        paymentMethod: document.getElementById("payment-method").value,
        items,
        total: hasPendingPrice ? null : totalAmount
    };
}

async function saveCurrentInvoice() {
    const number = activeInvoiceNumber || getNextInvoiceNumber();
    const existingIndex = invoiceHistory.findIndex(invoice => invoice.number === number && invoice.userId === currentUserId);
    const previousInvoice = existingIndex >= 0 ? invoiceHistory[existingIndex] : null;
    const date = previousInvoice ? previousInvoice.date : new Date().toISOString();
    const invoice = createInvoiceRecord(number, date);
    invoice.userId = currentUserId;
    invoice.updatedAt = new Date().toISOString();
    invoice.syncPending = true;
    invoice.stockPending = previousInvoice ? previousInvoice.stockPending === true : true;
    invoice.stockReservedLocally = previousInvoice ? previousInvoice.stockReservedLocally === true : false;
    let localStockChanges = null;

    if (navigator.onLine) {
        try {
            if (invoice.stockPending) {
                await finalizeInvoiceAndDecrementStock(invoice);
                invoice.stockPending = false;
                invoice.stockReservedLocally = false;
                await loadProductsFromSupabase();
            } else {
                await syncInvoiceToSupabase(invoice);
            }
            invoice.syncPending = false;
        } catch (error) {
            if (navigator.onLine) {
                console.error("No se pudo emitir la factura ni descontar el stock:", error);
                updateConnectionStatus(`No se emitió la factura: ${error.message}`, true);
                alert(error.message || "No se pudo emitir la factura ni descontar el stock.");
                return null;
            }
        }
    }

    if (!navigator.onLine && invoice.stockPending && !invoice.stockReservedLocally) {
        try {
            localStockChanges = calculateInvoiceStockChanges(invoice);
            invoice.stockReservedLocally = true;
        } catch (error) {
            alert(error.message || "No se pudo validar el stock disponible.");
            return null;
        }
    }

    const updatedHistory = [...invoiceHistory];

    if (existingIndex >= 0) updatedHistory[existingIndex] = invoice;
    else updatedHistory.unshift(invoice);

    try {
        localStorage.setItem("invoiceSequence", String(Math.max(Number(localStorage.getItem("invoiceSequence")) || 0, invoice.sequence)));
        localStorage.setItem("invoiceHistory", JSON.stringify(updatedHistory));
    } catch (error) {
        alert("No se pudo guardar la factura en este dispositivo.");
        return null;
    }

    invoiceHistory = updatedHistory;
    if (localStockChanges) applyInvoiceStockChanges(localStockChanges);
    activeInvoiceNumber = number;
    renderBilling();
    renderInvoiceHistory();
    if (!navigator.onLine) {
        updateConnectionStatus();
        return invoice;
    }
    try {
        await syncClientFromInvoice(invoice);
        await loadClientRegistryFromSupabase();
    } catch (error) {
        console.error("No se pudo sincronizar el cliente de la factura:", error);
        updateConnectionStatus(`La factura y el stock se guardaron, pero no se pudo sincronizar el cliente: ${error.message}.`, true);
    }
    return invoice;
}

function viewSavedInvoice(invoice) {
    if (!invoiceHistory.includes(invoice)) return;
    activeInvoicePreview = null;
    viewingHistoricalInvoice = invoice;
    showView("final-invoice");
}

function renderInvoiceHistory() {
    const container = document.getElementById("invoice-history-list");
    container.innerHTML = "";

    if (invoiceHistory.length === 0) {
        container.innerHTML = '<p class="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">Todavía no hay facturas guardadas.</p>';
        return;
    }

    invoiceHistory.forEach(invoice => {
        const card = document.createElement("article");
        card.className = "rounded-lg border border-slate-200 bg-white p-4";

        const heading = document.createElement("div");
        heading.className = "flex items-center justify-between gap-3 text-sm font-bold text-slate-900";
        const number = document.createElement("span");
        number.textContent = invoice.number;
        const headingActions = document.createElement("div");
        headingActions.className = "flex items-center gap-2";
        const date = document.createElement("time");
        date.className = "text-xs font-medium text-slate-500 text-right";
        date.dateTime = invoice.date;
        date.textContent = new Date(invoice.date).toLocaleString("es-VE");
        headingActions.appendChild(date);
        if (currentUserRole === "boss") {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "rounded-md p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-700";
            deleteButton.title = `Eliminar factura ${invoice.number}`;
            deleteButton.setAttribute("aria-label", `Eliminar factura ${invoice.number}`);
            deleteButton.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>';
            deleteButton.addEventListener("click", () => deleteSavedInvoice(invoice.number, invoice.userId));
            headingActions.appendChild(deleteButton);
        }
        if (currentUserRole === "boss" && invoice.userId !== currentUserId) {
            const owner = document.createElement("span");
            owner.className = "text-[10px] font-semibold text-slate-500";
            owner.textContent = `Vendedor ${String(invoice.userId || "").slice(0, 8)}`;
            headingActions.appendChild(owner);
        }
        heading.append(number, headingActions);
        card.appendChild(heading);

        const client = document.createElement("p");
        client.className = "text-sm text-slate-700 mt-2";
        client.textContent = `${invoice.clientName} · ${invoice.clientRoute}`;
        card.appendChild(client);

        const items = document.createElement("ul");
        items.className = "text-xs text-slate-600 mt-2 space-y-1";
        invoice.items.forEach(item => {
            const line = document.createElement("li");
            const subtotal = item.subtotal == null ? "Por cotizar" : `$${item.subtotal.toFixed(2)}`;
            line.textContent = `${item.name}: ${item.quantityLabels} · ${subtotal}`;
            items.appendChild(line);
        });
        card.appendChild(items);

        const total = document.createElement("p");
        total.className = "mt-3 text-sm font-bold text-slate-900";
        total.textContent = `Forma de pago: ${invoice.paymentMethod} · Total: ${invoice.total == null ? "Por cotizar" : `$${invoice.total.toFixed(2)}`}`;
        card.appendChild(total);

        const viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.className = "mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-100";
        viewButton.setAttribute("aria-label", `Ver factura ${invoice.number}`);
        viewButton.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>Ver factura';
        viewButton.addEventListener("click", () => viewSavedInvoice(invoice));
        card.appendChild(viewButton);

        container.appendChild(card);
    });
}
