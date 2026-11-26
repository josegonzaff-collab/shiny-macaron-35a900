// Acciones de facturas, totales y envio por WhatsApp.
async function deleteSavedInvoice(number, userId) {
    if (currentUserRole !== "boss") {
        alert("Solo el jefe puede eliminar facturas.");
        return;
    }
    const localInvoice = invoiceHistory.find(invoice => invoice.number === number && invoice.userId === userId);
    if (!confirm(`¿Eliminar la factura ${number} del historial? Si ya se había descontado el stock, se reintegrará automáticamente.`)) return;

    if (!navigator.onLine && localInvoice?.syncPending) {
        try {
            const stockChanges = localInvoice.stockReservedLocally
                ? calculateInvoiceStockChanges(localInvoice, 1)
                : [];
            const updatedHistory = invoiceHistory.filter(invoice => !(invoice.number === number && invoice.userId === userId));
            localStorage.setItem("invoiceHistory", JSON.stringify(updatedHistory));
            invoiceHistory = updatedHistory;
            if (stockChanges.length > 0) applyInvoiceStockChanges(stockChanges);
            if (activeInvoiceNumber === number && userId === currentUserId) {
                activeInvoiceNumber = null;
                cart = {};
                draftQuantities = {};
                updateTotals();
                renderProducts(getVisibleProducts());
                renderBilling();
            }
            updateConnectionStatus("Factura pendiente eliminada localmente. El inventario de Supabase no había sido descontado aún.");
            renderInvoiceHistory();
            return;
        } catch (error) {
            console.error("No se pudo eliminar la factura local sin conexión:", error);
            alert(error.message || "No se pudo eliminar la factura local.");
            return;
        }
    }
    if (!navigator.onLine) {
        alert("Se necesita conexión a internet para eliminar una factura ya sincronizada.");
        return;
    }

    try {
        const { error } = await supabaseClient
            .from("facturas")
            .delete()
            .eq("user_id", userId)
            .eq("numero", number);
        if (error) throw error;
    } catch (error) {
        console.error("No se pudo eliminar la factura de Supabase:", error);
        alert(error.message || "No se pudo eliminar la factura de Supabase.");
        return;
    }
    try {
        await loadProductsFromSupabase();
    } catch (error) {
        console.error("No se pudo actualizar el stock después de eliminar la factura:", error);
        updateConnectionStatus(`La factura fue eliminada, pero no se pudo actualizar la vista del stock: ${error.message}.`, true);
    }

    const updatedHistory = invoiceHistory.filter(invoice => !(invoice.number === number && invoice.userId === userId));
    invoiceHistory = updatedHistory;
    try {
        localStorage.setItem("invoiceHistory", JSON.stringify(updatedHistory));
    } catch (error) {
        console.error("No se pudo actualizar el historial local después de eliminar la factura:", error);
    }

    updateConnectionStatus("Factura eliminada. Si tenía un descuento de inventario registrado, el stock fue reintegrado.");
    if (activeInvoiceNumber === number && userId === currentUserId) {
        activeInvoiceNumber = null;
        cart = {};
        draftQuantities = {};
        updateTotals();
        renderProducts(getVisibleProducts());
        renderBilling();
    }
    renderInvoiceHistory();
}

function startNewInvoice() {
    if (!invoiceHistory.some(invoice => invoice.number === activeInvoiceNumber && invoice.userId === currentUserId)) return;

    lastSentInvoice = null;
    activeInvoicePreview = null;
    viewingHistoricalInvoice = null;
    cart = {};
    draftQuantities = {};
    activeInvoiceNumber = null;
    document.getElementById("client-name").value = "";
    document.getElementById("client-phone").value = "";
    document.getElementById("client-route").value = "";
    document.getElementById("registered-client-select").value = "";
    document.getElementById("payment-method").value = "Contado";
    updateTotals();
    renderProducts(getVisibleProducts());
    renderBilling();
    showView("order");
}

function updateTotals() {
    let totalItems = 0;
    let totalAmount = 0;
    let hasPendingPrice = false;

    for (let id in cart) {
        const prod = products.find(p => p.id == id);
        if (prod) {
            const quantities = cart[id];
            totalItems += quantities.unit + quantities.box;
            const details = getOrderDetails(prod, quantities);
            totalAmount += details.subtotal;
            hasPendingPrice ||= details.hasPendingPrice;
        }
    }

    document.getElementById("footer-units").innerText = totalItems;
    document.getElementById("total-amount").innerText = totalItems === 0
        ? "$0.00"
        : hasPendingPrice ? "Por cotizar" : `$${totalAmount.toFixed(2)}`;
}

function getOrderDetails(prod, quantities) {
    const quantityLabels = [];
    let subtotal = 0;
    let hasPendingPrice = false;

    if (quantities.unit > 0) {
        quantityLabels.push(`${quantities.unit} ${getProductUnitName(prod, quantities.unit)}`);
        if (prod.price != null && Number.isFinite(Number(prod.price))) {
            subtotal += Number(prod.price) * quantities.unit;
        } else {
            hasPendingPrice = true;
        }
    }

    if (quantities.box > 0) {
        quantityLabels.push(`${quantities.box} ${quantities.box === 1 ? "caja" : "cajas"}`);
        if (prod.boxPrice != null && Number.isFinite(Number(prod.boxPrice))) {
            subtotal += Number(prod.boxPrice) * quantities.box;
        } else {
            hasPendingPrice = true;
        }
    }

    return { quantityLabels: quantityLabels.join(" + "), subtotal, hasPendingPrice };
}

function openCommercialInvoicePreview() {
    const clientName = document.getElementById("client-name").value.trim();
    const clientPhone = document.getElementById("client-phone").value.trim();
    const clientRoute = document.getElementById("client-route").value;
    if (!clientName || !clientPhone || !clientRoute) {
        alert("Completa el teléfono, el nombre del comercio y la ruta.");
        return;
    }
    if (Object.keys(cart).length === 0) {
        alert("Agrega al menos un producto para preparar la factura lista.");
        return;
    }

    const number = activeInvoiceNumber || getNextInvoiceNumber();
    const savedInvoice = invoiceHistory.find(invoice => invoice.number === number && invoice.userId === currentUserId);
    viewingHistoricalInvoice = null;
    activeInvoicePreview = createInvoiceRecord(number, savedInvoice ? savedInvoice.date : new Date().toISOString());
    activeInvoicePreview.userId = currentUserId;
    const status = document.getElementById("final-invoice-status");
    status.className = "mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800";
    status.textContent = "Vista previa sin emitir: no se guardará la factura ni se descontará inventario.";
    showView("final-invoice");
}

function getInvoiceSharePrice(item, priceField, quantityField, otherQuantityField) {
    const storedPrice = item[priceField];
    if (storedPrice != null && storedPrice !== "" && Number.isFinite(Number(storedPrice))) {
        return Number(storedPrice);
    }

    const quantity = Number(item[quantityField]);
    const otherQuantity = Number(item[otherQuantityField]);
    const subtotal = Number(item.subtotal);
    if (
        quantity > 0 &&
        otherQuantity === 0 &&
        item.subtotal != null &&
        Number.isFinite(subtotal)
    ) {
        return subtotal / quantity;
    }

    return null;
}

function formatInvoiceShareSection(
    title,
    items,
    quantityField,
    otherQuantityField,
    priceField,
    quantityUnit,
    priceUnit
) {
    const sectionItems = items.filter(item => Number(item[quantityField]) > 0);
    if (sectionItems.length === 0) return "";

    const lines = [`*${title}*`];
    for (const item of sectionItems) {
        const quantity = Number(item[quantityField]);
        const price = getInvoiceSharePrice(item, priceField, quantityField, otherQuantityField);
        const amount = price == null
            ? ""
            : ` ($${price.toFixed(2)} por ${priceUnit}; monto $${(price * quantity).toFixed(2)})`;
        lines.push(`• ${quantity} ${quantityUnit} - ${item.name}${amount}`);
    }

    return lines.join("\n");
}

function buildInvoiceShareText(invoice, isPreview) {
    const invoiceDate = new Date(invoice.date);
    if (!Number.isFinite(invoiceDate.getTime())) throw new Error("La fecha de la factura no es válida.");
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
    if (!/^\d{2}:\d{2}$/.test(timeLabel)) throw new Error("No se pudo formatear la hora de la factura.");

    const items = (Array.isArray(invoice.items) ? invoice.items : [])
        .filter(item => item && typeof item === "object");
    const sections = [
        formatInvoiceShareSection(
            "MAYOR (POR CAJA)",
            items,
            "quantityBox",
            "quantityUnit",
            "boxPrice",
            "Cja",
            "caja"
        ),
        formatInvoiceShareSection(
            "DETAL (POR UNIDAD)",
            items,
            "quantityUnit",
            "quantityBox",
            "unitPrice",
            "Und",
            "unidad"
        )
    ].filter(Boolean);

    let message = `*FACTURA ${invoice.number}*\n`;
    if (isPreview) message += "*VISTA PREVIA - NO EMITIDA*\n";
    message += `*Fecha:* ${dateLabel}\n*Hora:* ${timeLabel}\n\n`;
    message += `*Comercio:* ${invoice.clientName}\n`;
    message += `*Teléfono:* ${invoice.clientPhone || "No registrado"}\n`;
    message += `*Ruta:* ${invoice.clientRoute}\n`;
    if (sections.length > 0) message += `\n${sections.join("\n\n")}\n`;
    const totalLabel = invoice.total == null ? "POR COTIZAR" : `$${Number(invoice.total).toFixed(2)}`;
    message += `\n*Forma de pago:* ${invoice.paymentMethod}\n`;
    message += `*TOTAL A PAGAR:* ${totalLabel}\n`;
    return message;
}

async function shareCommercialInvoice() {
    const invoice = activeInvoicePreview || viewingHistoricalInvoice || lastSentInvoice;
    if (!invoice) {
        alert("Primero prepara la factura lista.");
        return;
    }
    const isPreview = invoice === activeInvoicePreview;
    const text = buildInvoiceShareText(invoice, isPreview);
    if (typeof navigator.share === "function") {
        try {
            await navigator.share({ title: `Factura ${invoice.number}`, text });
        } catch (error) {
            if (error.name === "AbortError") return;
            console.error("No se pudo compartir la factura:", error);
            alert(error.message || "No se pudo compartir la factura.");
        }
        return;
    }

    const shareWindow = window.open("about:blank", "_blank");
    if (!shareWindow) {
        updateConnectionStatus("El navegador bloqueó la ventana para compartir. Permite ventanas emergentes e inténtalo nuevamente.", true);
        return;
    }
    shareWindow.location.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}

async function sendToWhatsApp() {
    if (invoiceSaveInProgress) return;
    if (viewingHistoricalInvoice) {
        alert("Las facturas emitidas se pueden consultar, pero no volver a enviar desde el registro.");
        return;
    }
    const clientName = document.getElementById("client-name").value.trim();
    const clientPhone = document.getElementById("client-phone").value.trim();
    const clientRoute = document.getElementById("client-route").value;
    if (!clientPhone || !clientName || !clientRoute) {
        alert("Completa el teléfono, el nombre del comercio y la ruta.");
        return;
    }
    if (Object.keys(cart).length === 0) {
        alert("Marca al menos un producto como listo antes de enviar la factura.");
        return;
    }
    invoiceSaveInProgress = true;
    const whatsappWindow = window.open("about:blank", "_blank");
    let invoice;
    try {
        invoice = await saveCurrentInvoice();
    } catch (error) {
        console.error("No se pudo preparar la factura:", error);
        alert(error.message || "No se pudo preparar la factura.");
    } finally {
        invoiceSaveInProgress = false;
    }
    if (!invoice) {
        if (whatsappWindow) whatsappWindow.close();
        return;
    }
    const message = buildInvoiceShareText(invoice, false);
    const encodedMessage = encodeURIComponent(message);

    // Puedes cambiar este número por el de tu central o almacén (código de país + número)
    const phoneCentral = ""; // Ej: 584121234567 (opcional, si se deja vacío abre WhatsApp para elegir contacto)

    const whatsappURL = `https://api.whatsapp.com/send?phone=${phoneCentral}&text=${encodedMessage}`;
    let whatsappOpened = false;
    if (whatsappWindow) {
        try {
            whatsappWindow.location.href = whatsappURL;
            whatsappOpened = true;
        } catch (error) {
            console.error("No se pudo abrir la ventana de WhatsApp:", error);
        }
    }

    if (whatsappOpened) {
        document.getElementById("final-invoice-status").textContent = "Factura guardada. Confirma el envío en la ventana de WhatsApp.";
    } else {
        updateConnectionStatus("La factura se guardó, pero el navegador bloqueó la ventana de WhatsApp.", true);
        document.getElementById("final-invoice-status").textContent = "Factura guardada, pero WhatsApp no se abrió. Permite las ventanas emergentes para completar el envío.";
    }
    activeInvoicePreview = null;
    viewingHistoricalInvoice = null;
    lastSentInvoice = invoice;
    showView("final-invoice");
}
