// Cobros a credito y cuentas bancarias.
function renderCreditCollections() {
    renderCreditInvoiceRegistry();
    renderSelectedCreditInvoice();
    renderCollectionBanks();
}

function renderCreditInvoiceRegistry() {
    const registry = document.getElementById("credit-invoice-registry");
    const searchStatus = document.getElementById("credit-invoice-search-status");
    const query = normalizeCreditSearchText(document.getElementById("credit-invoice-search").value);
    const creditInvoices = invoiceHistory.filter(invoice =>
        String(invoice.paymentMethod || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase() === "credito"
    );
    const matchingInvoices = creditInvoices.filter(invoice => {
        const searchableText = normalizeCreditSearchText(`${invoice.clientName || ""} ${invoice.number || ""}`);
        return searchableText.includes(query);
    });
    registry.replaceChildren();

    if (creditInvoices.length === 0) {
        searchStatus.textContent = "No hay facturas a crédito.";
        selectedCreditInvoiceKey = "";
        renderSelectedCreditInvoice();
    } else {
        searchStatus.textContent = query
            ? `${matchingInvoices.length} de ${creditInvoices.length} facturas.`
            : `${creditInvoices.length} ${creditInvoices.length === 1 ? "factura" : "facturas"}.`;
        matchingInvoices.forEach(invoice => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `flex w-full items-center justify-between gap-3 rounded-md border px-3 py-3 text-left transition ${
                selectedCreditInvoiceKey === getInvoiceKey(invoice)
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
            }`;
            button.setAttribute("aria-pressed", String(selectedCreditInvoiceKey === getInvoiceKey(invoice)));

            const details = document.createElement("span");
            details.className = "min-w-0";
            const client = document.createElement("span");
            client.className = "block truncate text-sm font-semibold text-slate-900";
            client.textContent = invoice.clientName || "Cliente sin nombre";
            const number = document.createElement("span");
            number.className = "mt-0.5 block text-xs text-slate-500";
            number.textContent = `Factura ${invoice.number || "sin número"} · ${invoice.clientRoute || "Sin ruta"}`;
            details.append(client, number);

            const amount = document.createElement("span");
            amount.className = "shrink-0 text-sm font-bold text-slate-900";
            amount.textContent = invoice.total == null ? "Por cotizar" : `$${Number(invoice.total).toFixed(2)}`;
            button.append(details, amount);
            button.addEventListener("click", () => selectCreditInvoice(getInvoiceKey(invoice)));
            registry.appendChild(button);
        });
        if (matchingInvoices.length === 0) {
            const empty = document.createElement("p");
            empty.className = "rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500";
            empty.textContent = "No hay resultados.";
            registry.appendChild(empty);
        }
    }

    if (selectedCreditInvoiceKey && !creditInvoices.some(invoice => getInvoiceKey(invoice) === selectedCreditInvoiceKey)) {
        selectedCreditInvoiceKey = "";
        renderSelectedCreditInvoice();
    }
}

function normalizeCreditSearchText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

function selectCreditInvoice(invoiceKey) {
    selectedCreditInvoiceKey = invoiceKey;
    selectedCollectionAction = "send";
    renderCreditCollections();
}

function setCollectionAction(action) {
    if (!["send", "report"].includes(action)) return;
    selectedCollectionAction = action;
    renderSelectedCreditInvoice();
}

function clearSelectedCreditInvoice() {
    selectedCreditInvoiceKey = "";
    renderCreditCollections();
}

function renderSelectedCreditInvoice() {
    const panel = document.getElementById("selected-credit-invoice-panel");
    const searchPanel = document.getElementById("credit-invoice-search-panel");
    const content = document.getElementById("selected-credit-action-content");
    const invoice = invoiceHistory.find(record => getInvoiceKey(record) === selectedCreditInvoiceKey);
    panel.classList.toggle("hidden", !invoice);
    searchPanel.classList.toggle("hidden", Boolean(invoice));
    content.replaceChildren();

    const sendButton = document.getElementById("collection-page-send");
    const reportButton = document.getElementById("collection-page-report");
    const description = document.getElementById("collection-page-description");
    sendButton.setAttribute("aria-pressed", String(selectedCollectionAction === "send"));
    reportButton.setAttribute("aria-pressed", String(selectedCollectionAction === "report"));
    sendButton.className = selectedCollectionAction === "send"
        ? "min-h-11 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800"
        : "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700";
    reportButton.className = selectedCollectionAction === "report"
        ? "min-h-11 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800"
        : "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700";
    description.textContent = selectedCollectionAction === "send"
        ? "Busca una factura y envía el cobro al cliente."
        : "Busca una factura y reporta el pago recibido.";
    if (!invoice) return;

    document.getElementById("selected-credit-invoice-title").textContent =
        `${invoice.clientName || "Cliente"} · Factura ${invoice.number || "sin número"}`;
    document.getElementById("selected-credit-invoice-details").textContent =
        `${invoice.clientRoute || "Sin ruta"}${invoice.date ? ` · ${new Date(invoice.date).toLocaleDateString("es-VE")}` : ""}`;
    document.getElementById("selected-credit-invoice-amount").textContent =
        invoice.total == null ? "Monto por cotizar" : `Monto: $${Number(invoice.total).toFixed(2)}`;

    content.appendChild(createCreditCollectionCard(invoice, selectedCollectionAction));
}

function createCreditCollectionCard(invoice, type) {
    const card = document.createElement("article");
    card.className = "space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4";
    const form = document.createElement("form");
    form.className = "grid grid-cols-1 gap-3 sm:grid-cols-2";
    if (type === "report") {
        addCollectionTextField(form, "reference", "Referencia", "Número de transferencia");
        addCollectionTextField(form, "originBank", "Banco del cliente", "Nombre del banco");
        addCollectionBankField(form, "destinationBankId", "Banco de la empresa", bank => {
            const phoneInput = form.elements.companyPhone;
            if (phoneInput && !phoneInput.dataset.edited) phoneInput.value = bank?.company_phone || "";
        });
        addCollectionTextField(form, "companyPhone", "Teléfono empresa", "Número de WhatsApp", "tel");
        form.addEventListener("submit", event => sendCreditCollectionReport(event, invoice));
    } else {
        addCollectionReadOnlyAmount(form, invoice);
        addCollectionTextField(form, "clientPhone", "Teléfono cliente", invoice.clientPhone || "Número de WhatsApp", "tel", invoice.clientPhone || "");
        addCollectionBankField(form, "bankId", "Cuenta de pago");
        form.addEventListener("submit", event => sendCreditCollectionReminder(event, invoice));
    }

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 sm:col-span-2 disabled:cursor-not-allowed disabled:opacity-50";
    submit.innerHTML = type === "report"
        ? '<i class="fa-brands fa-whatsapp text-lg" aria-hidden="true"></i>Enviar reporte'
        : '<i class="fa-brands fa-whatsapp text-lg" aria-hidden="true"></i>Enviar por WhatsApp';
    submit.disabled = collectionBanks.length === 0 || invoice.total == null && type === "send";
    form.appendChild(submit);
    card.appendChild(form);
    if (invoice.total == null && type === "send") {
        const note = document.createElement("p");
        note.className = "text-xs text-amber-700";
        note.textContent = "Esta factura no tiene un monto definido y no se puede enviar hasta actualizarla.";
        card.appendChild(note);
    }
    return card;
}

function addCollectionTextField(form, name, labelText, placeholder, type = "text", value = "") {
    const label = document.createElement("label");
    label.className = "block text-xs font-semibold uppercase tracking-wider text-slate-500";
    label.textContent = labelText;
    const input = document.createElement("input");
    input.name = name;
    input.type = type;
    input.autocomplete = "off";
    input.required = true;
    input.maxLength = type === "tel" ? 30 : 100;
    input.placeholder = placeholder;
    input.value = value;
    if (name === "companyPhone") input.addEventListener("input", () => { input.dataset.edited = "true"; });
    input.className = "mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10";
    label.appendChild(input);
    form.appendChild(label);
    return input;
}

function addCollectionBankField(form, name, labelText, onChange = null) {
    const label = document.createElement("label");
    label.className = "block text-xs font-semibold uppercase tracking-wider text-slate-500";
    label.textContent = labelText;
    const select = document.createElement("select");
    select.name = name;
    select.required = true;
    select.className = "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10";
    select.add(new Option(collectionBanks.length ? "Seleccionar cuenta bancaria" : "No hay cuentas bancarias registradas", ""));
    collectionBanks.forEach(bank => {
        select.add(new Option(`${bank.bank_name} · ${bank.company_name} · ${bank.account_number}`, bank.id));
    });
    select.addEventListener("change", () => {
        if (typeof onChange === "function") {
            onChange(collectionBanks.find(bank => String(bank.id) === select.value) || null);
        }
    });
    label.appendChild(select);
    form.appendChild(label);
    return select;
}

function addCollectionReadOnlyAmount(form, invoice) {
    const label = document.createElement("label");
    label.className = "block text-xs font-semibold uppercase tracking-wider text-slate-500";
    label.textContent = "Monto";
    const amount = document.createElement("input");
    amount.name = "amount";
    amount.type = "text";
    amount.readOnly = true;
    amount.value = invoice.total == null ? "" : `$${Number(invoice.total).toFixed(2)}`;
    amount.placeholder = "Monto pendiente de definir";
    amount.className = "mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-700";
    label.appendChild(amount);
    form.appendChild(label);
}

function normalizeWhatsAppPhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0")) digits = `58${digits.slice(1)}`;
    else if (digits.length === 10) digits = `58${digits}`;
    if (digits.length < 10 || digits.length > 15) {
        throw new Error("Ingresa un número de teléfono válido con código de país.");
    }
    return digits;
}

function sendCreditCollectionReport(event, invoice) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement) || !form.reportValidity()) return;
    const formData = new FormData(form);
    const reference = String(formData.get("reference") || "").trim();
    const originBank = String(formData.get("originBank") || "").trim();
    const destinationBank = collectionBanks.find(bank => String(bank.id) === String(formData.get("destinationBankId")));
    if (!destinationBank) {
        alert("Selecciona el banco de la empresa que recibió el pago.");
        return;
    }
    let recipientPhone;
    try {
        recipientPhone = normalizeWhatsAppPhone(formData.get("companyPhone"));
    } catch (error) {
        alert(error.message);
        return;
    }
    const message = [
        `*REPORTE DE PAGO · FACTURA ${invoice.number}*`,
        `*Comercio:* ${invoice.clientName}`,
        `*Ruta:* ${invoice.clientRoute}`,
        `*Monto:* ${invoice.total == null ? "Por cotizar" : `$${Number(invoice.total).toFixed(2)}`}`,
        `*Referencia:* ${reference}`,
        `*Banco de origen:* ${originBank}`,
        `*Banco receptor:* ${destinationBank.bank_name} · ${destinationBank.company_name}`
    ].join("\n");
    openCollectionWhatsApp(recipientPhone, message);
}

function sendCreditCollectionReminder(event, invoice) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement) || !form.reportValidity()) return;
    if (invoice.total == null) {
        alert("Esta factura no tiene un monto definido. Actualízala antes de enviar el cobro.");
        return;
    }
    const formData = new FormData(form);
    const bank = collectionBanks.find(record => String(record.id) === String(formData.get("bankId")));
    if (!bank) {
        alert("Selecciona una cuenta bancaria para el pago.");
        return;
    }
    let recipientPhone;
    try {
        recipientPhone = normalizeWhatsAppPhone(formData.get("clientPhone"));
    } catch (error) {
        alert(error.message);
        return;
    }
    const message = [
        `*AVISO DE COBRO · FACTURA ${invoice.number}*`,
        `Hola ${invoice.clientName || "cliente"}, te compartimos los datos para realizar tu pago.`,
        `*Monto:* $${Number(invoice.total).toFixed(2)}`,
        `*Banco:* ${bank.bank_name}`,
        `*Titular:* ${bank.company_name}`,
        `*Número de cuenta:* ${bank.account_number}`,
        `*Contacto de la empresa:* ${bank.company_phone}`
    ].join("\n");
    openCollectionWhatsApp(recipientPhone, message);
}

function openCollectionWhatsApp(phone, message) {
    const whatsappURL = `https://api.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}`;
    const whatsappWindow = window.open(whatsappURL, "_blank");
    if (!whatsappWindow) {
        updateConnectionStatus("No se pudo abrir WhatsApp. Permite las ventanas emergentes e inténtalo de nuevo.", true);
    }
}

async function loadCollectionBanksFromSupabase() {
    if (collectionBanksLoading) return;
    collectionBanksLoading = true;
    collectionBanksLoadError = "";
    renderCollectionBanks();
    try {
        if (!hasAuthenticatedSupabaseSession) throw new Error("Inicia sesión para consultar las cuentas bancarias.");
        const { data, error } = await supabaseClient
            .from("cobro_bancos")
            .select("id,account_number,bank_name,company_name,company_phone")
            .order("bank_name")
            .order("company_name");
        if (error) throw error;
        collectionBanks = data || [];
        collectionBanksLoaded = true;
    } catch (error) {
        collectionBanks = [];
        collectionBanksLoadError = error.message || "No se pudieron cargar las cuentas bancarias.";
        console.error("No se pudieron cargar las cuentas bancarias:", error);
    } finally {
        collectionBanksLoading = false;
        renderCreditCollections();
    }
}

function renderCollectionBanks() {
    const adminSection = document.getElementById("collection-bank-admin-section");
    const form = document.getElementById("collection-bank-form");
    const status = document.getElementById("collection-bank-status");
    const list = document.getElementById("collection-bank-list");
    const globalStatus = document.getElementById("collection-bank-global-status");
    if (!adminSection || !form || !status || !list) return;
    const isBoss = currentUserRole === "boss";
    adminSection.classList.toggle("hidden", !isBoss);
    form.querySelectorAll("input, button").forEach(control => {
        control.disabled = !isBoss || !navigator.onLine || !hasAuthenticatedSupabaseSession;
    });
    list.replaceChildren();

    if (collectionBanksLoading) {
        status.className = "text-sm text-slate-600";
        status.textContent = "Cargando cuentas bancarias compartidas...";
    } else if (collectionBanksLoadError) {
        status.className = "text-sm text-red-700";
        status.textContent = `No se pudieron cargar las cuentas. Verifica la conexión y ejecuta la configuración SQL de cobros. ${collectionBanksLoadError}`;
    } else {
        status.className = "text-sm text-slate-600";
        status.textContent = collectionBanks.length
            ? `${collectionBanks.length} ${collectionBanks.length === 1 ? "cuenta disponible" : "cuentas disponibles"} para todos los usuarios.`
            : "Todavía no hay cuentas bancarias registradas.";
    }
    if (globalStatus) {
        if (collectionBanksLoadError) {
            globalStatus.className = "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
            globalStatus.textContent = `No se pudieron cargar las cuentas bancarias. Verifica la conexión y la configuración SQL. ${collectionBanksLoadError}`;
        } else if (collectionBanksLoading) {
            globalStatus.className = "rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600";
            globalStatus.textContent = "Cargando las cuentas bancarias compartidas...";
        } else if (collectionBanks.length === 0) {
            globalStatus.className = "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800";
            globalStatus.textContent = "No hay cuentas bancarias disponibles. Pide al administrador que las registre.";
        } else {
            globalStatus.className = "hidden";
            globalStatus.textContent = "";
        }
    }
    if (isBoss && (!navigator.onLine || !hasAuthenticatedSupabaseSession)) {
        status.textContent += " Se requiere conexión e iniciar sesión para administrar las cuentas.";
    }

    collectionBanks.forEach(bank => {
        const row = document.createElement("div");
        row.className = "flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between";
        const details = document.createElement("p");
        details.className = "min-w-0 text-sm text-slate-700";
        details.textContent = `${bank.bank_name} · ${bank.company_name} · ${bank.account_number} · ${bank.company_phone}`;
        row.appendChild(details);
        if (isBoss) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.disabled = !navigator.onLine || !hasAuthenticatedSupabaseSession;
            remove.className = "shrink-0 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50";
            remove.textContent = "Eliminar";
            remove.addEventListener("click", () => deleteCollectionBank(bank.id));
            row.appendChild(remove);
        }
        list.appendChild(row);
    });
}

async function addCollectionBank(event) {
    event.preventDefault();
    if (currentUserRole !== "boss") {
        alert("Solo el administrador puede agregar cuentas bancarias.");
        return;
    }
    if (!navigator.onLine || !hasAuthenticatedSupabaseSession) {
        alert("Conéctate e inicia sesión para guardar una cuenta bancaria compartida.");
        return;
    }
    const form = event.currentTarget;
    const accountNumber = form.elements.accountNumber.value.trim();
    const bankName = form.elements.bankName.value.trim();
    const companyName = form.elements.companyName.value.trim();
    const companyPhone = form.elements.companyPhone.value.trim();
    try {
        normalizeWhatsAppPhone(companyPhone);
    } catch (error) {
        alert(error.message);
        return;
    }
    try {
        const { error } = await supabaseClient
            .from("cobro_bancos")
            .insert({
                account_number: accountNumber,
                bank_name: bankName,
                company_name: companyName,
                company_phone: companyPhone,
                updated_by: currentUserId
            });
        if (error) throw error;
        form.reset();
        collectionBanksLoaded = false;
        await loadCollectionBanksFromSupabase();
    } catch (error) {
        console.error("No se pudo agregar la cuenta bancaria:", error);
        alert(error.message || "No se pudo agregar la cuenta bancaria.");
    }
}

async function deleteCollectionBank(bankId) {
    if (currentUserRole !== "boss" || !navigator.onLine || !hasAuthenticatedSupabaseSession) {
        alert("Solo el administrador conectado puede eliminar cuentas bancarias.");
        return;
    }
    const bank = collectionBanks.find(record => String(record.id) === String(bankId));
    if (!bank || !confirm(`¿Eliminar la cuenta ${bank.bank_name} de ${bank.company_name}?`)) return;
    try {
        const { error } = await supabaseClient
            .from("cobro_bancos")
            .delete()
            .eq("id", bankId);
        if (error) throw error;
        collectionBanksLoaded = false;
        await loadCollectionBanksFromSupabase();
    } catch (error) {
        console.error("No se pudo eliminar la cuenta bancaria:", error);
        alert(error.message || "No se pudo eliminar la cuenta bancaria.");
    }
}

