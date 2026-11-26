// Registro y sincronizacion de clientes.
function getClientFromInvoice(invoice) {
    const name = String(invoice.clientName || "").trim();
    const phone = String(invoice.clientPhone || "").trim();
    const route = String(invoice.clientRoute || "").trim();
    if (!name || !route) return null;
    return { nombre: name, telefono: phone, ruta: route };
}

function getClientIdentity(client) {
    const normalizedName = client.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const normalizedRoute = client.ruta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const normalizedPhone = String(client.telefono || "").replace(/\D/g, "");
    return `${normalizedRoute}|${normalizedPhone}|${normalizedName}`;
}

function getClientRouteIdentity(client) {
    const normalizedName = String(client.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const normalizedRoute = String(client.ruta || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    return `${normalizedRoute}|${normalizedName}`;
}

function getAvailableClientRoutes() {
    const configuredRoutes = [...document.getElementById("client-route").options]
        .map(option => option.value)
        .filter(Boolean);
    return [...new Set([...configuredRoutes, ...clientRecords.map(client => client.ruta).filter(Boolean)])];
}

function updateClientRouteOptions() {
    const routeSelect = document.getElementById("client-route");
    const selectedRoute = routeSelect.value;
    const existingRoutes = new Set([...routeSelect.options].map(option => option.value));
    getAvailableClientRoutes().forEach(route => {
        if (!existingRoutes.has(route)) routeSelect.add(new Option(route, route));
    });
    routeSelect.value = selectedRoute;

    const adminRouteSelect = document.getElementById("client-admin-route");
    if (!adminRouteSelect) return;
    const adminSelectedRoute = adminRouteSelect.value;
    adminRouteSelect.replaceChildren(new Option("Seleccionar ruta", ""));
    getAvailableClientRoutes().forEach(route => adminRouteSelect.add(new Option(route, route)));
    adminRouteSelect.value = adminSelectedRoute;
}

function createClientRouteSelect(selectedRoute) {
    const select = document.createElement("select");
    select.required = true;
    select.className = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10";
    select.add(new Option("Seleccionar ruta", ""));
    getAvailableClientRoutes().forEach(route => select.add(new Option(route, route)));
    select.value = selectedRoute || "";
    return select;
}

function renderRegisteredClientOptions() {
    updateClientRouteOptions();
    const select = document.getElementById("registered-client-select");
    const selectedClientKey = select.value;
    const clientsByRouteAndName = new Map();
    clientRecords.forEach(client => {
        const key = getClientRouteIdentity(client);
        if (key !== "|" && !clientsByRouteAndName.has(key)) clientsByRouteAndName.set(key, client);
    });

    select.replaceChildren(new Option("Buscar cliente por nombre y ruta", ""));
    [...clientsByRouteAndName.entries()]
        .sort((left, right) => left[1].nombre.localeCompare(right[1].nombre, "es"))
        .forEach(([key, client]) => {
            select.add(new Option(`${client.nombre} — ${client.ruta}`, key));
        });
    if (clientsByRouteAndName.has(selectedClientKey)) select.value = selectedClientKey;
}

function selectRegisteredClient(identity) {
    const client = clientRecords.find(record => getClientRouteIdentity(record) === identity);
    if (!client) return;
    document.getElementById("client-name").value = client.nombre;
    document.getElementById("client-phone").value = client.telefono || "";
    const routeSelect = document.getElementById("client-route");
    if (![...routeSelect.options].some(option => option.value === client.ruta)) {
        routeSelect.add(new Option(client.ruta, client.ruta));
    }
    routeSelect.value = client.ruta;
    invalidateActiveInvoice();
    closeOrderClientDropdown();
}

function toggleOrderClientAction(action) {
    const controls = {
        register: {
            buttonId: "order-client-register-toggle",
            panelId: "quick-client-form"
        },
        select: {
            buttonId: "order-client-select-toggle",
            panelId: "order-client-select-panel"
        }
    };
    const selectedControl = controls[action];
    if (!selectedControl) return;

    const selectedPanel = document.getElementById(selectedControl.panelId);
    if (!selectedPanel) return;
    const shouldOpen = selectedPanel.classList.contains("hidden");

    Object.values(controls).forEach(control => {
        const panel = document.getElementById(control.panelId);
        const button = document.getElementById(control.buttonId);
        if (panel) panel.classList.add("hidden");
        if (button) button.setAttribute("aria-expanded", "false");
    });

    if (shouldOpen) {
        selectedPanel.classList.remove("hidden");
        document.getElementById(selectedControl.buttonId).setAttribute("aria-expanded", "true");
    }
}

function closeOrderClientDropdown() {
    const dropdown = document.getElementById("order-client-dropdown");
    if (!dropdown) return;
    dropdown.open = false;
    document.getElementById("quick-client-form").classList.add("hidden");
    document.getElementById("order-client-select-panel").classList.add("hidden");
    document.getElementById("order-client-register-toggle").setAttribute("aria-expanded", "false");
    document.getElementById("order-client-select-toggle").setAttribute("aria-expanded", "false");
}

function clearRegisteredClientSelection() {
    const select = document.getElementById("registered-client-select");
    if (select) select.value = "";
}

function canManageRegisteredClients() {
    return currentUserRole === "boss" && navigator.onLine && !clientsFromCache;
}

async function addRegisteredClient(event) {
    event.preventDefault();
    if (currentUserRole !== "boss") {
        alert("Solo el administrador puede agregar clientes.");
        return;
    }
    if (!navigator.onLine || clientsFromCache) {
        alert("Conéctate y actualiza el registro de clientes antes de modificarlo.");
        return;
    }

    const form = event.currentTarget;
    const nombre = form.elements.clientName.value.trim();
    const telefono = form.elements.clientPhone.value.trim();
    const ruta = form.elements.route.value;
    if (!telefono || !nombre || !ruta) {
        alert("Completa el teléfono, el nombre del cliente y selecciona una ruta.");
        return;
    }
    const duplicate = clientRecords.find(client => getClientRouteIdentity(client) === getClientRouteIdentity({ nombre, ruta }));
    if (duplicate) {
        alert("Ya existe un cliente con ese nombre en esa ruta. Puedes editar el registro existente.");
        return;
    }

    try {
        const { error } = await supabaseClient
            .from("clientes")
            .insert({ nombre, telefono, ruta });
        if (error) throw error;
        form.reset();
        await loadClientRegistryFromSupabase();
    } catch (error) {
        console.error("No se pudo agregar el cliente:", error);
        alert(error.message || "No se pudo agregar el cliente.");
    }
}

function startEditingClient(clientId) {
    if (!canManageRegisteredClients()) {
        alert("Conéctate para editar los clientes registrados.");
        return;
    }
    editingClientId = String(clientId);
    renderClientRegistry();
}

async function addQuickRegisteredClient(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const telefono = form.elements.clientPhone.value.trim();
    const nombre = form.elements.clientName.value.trim();
    const ruta = form.elements.clientRoute.value;

    if (!telefono || !nombre || !ruta) {
        alert("Completa el teléfono, el nombre del comercio y la ruta.");
        return;
    }
    if (!hasAuthenticatedSupabaseSession || !navigator.onLine) {
        document.getElementById("client-phone").value = telefono;
        document.getElementById("client-name").value = nombre;
        document.getElementById("client-route").value = ruta;
        invalidateActiveInvoice();
        alert("El cliente quedó preparado para la factura, pero debes iniciar sesión y tener conexión para guardarlo en el registro.");
        return;
    }

    const duplicate = clientRecords.find(client => getClientRouteIdentity(client) === getClientRouteIdentity({ nombre, ruta }));
    if (duplicate) {
        alert("Ya existe un cliente con ese nombre en esa ruta.");
        return;
    }

    try {
        const { error } = await supabaseClient
            .from("clientes")
            .insert({ nombre, telefono, ruta });
        if (error) throw error;
        form.reset();
        await loadClientRegistryFromSupabase();
        document.getElementById("client-phone").value = telefono;
        document.getElementById("client-name").value = nombre;
        document.getElementById("client-route").value = ruta;
        invalidateActiveInvoice();
        closeOrderClientDropdown();
    } catch (error) {
        console.error("No se pudo registrar el cliente:", error);
        alert(error.message || "No se pudo registrar el cliente.");
    }
}

async function saveRegisteredClient(event, clientId) {
    event.preventDefault();
    if (!canManageRegisteredClients()) {
        alert("Conéctate para guardar los cambios del cliente.");
        return;
    }

    const form = event.currentTarget;
    const nombre = form.elements.clientName.value.trim();
    const telefono = form.elements.clientPhone.value.trim();
    const ruta = form.elements.route.value;
    if (!telefono || !nombre || !ruta) {
        alert("Completa el teléfono, el nombre del cliente y selecciona una ruta.");
        return;
    }
    const duplicate = clientRecords.find(client =>
        String(client.id) !== String(clientId)
        && getClientRouteIdentity(client) === getClientRouteIdentity({ nombre, ruta })
    );
    if (duplicate) {
        alert("Ya existe otro cliente con ese nombre en esa ruta.");
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from("clientes")
            .update({ nombre, telefono, ruta })
            .eq("id", clientId)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Supabase no confirmó el cambio del cliente.");
        editingClientId = null;
        await loadClientRegistryFromSupabase();
    } catch (error) {
        console.error("No se pudo actualizar el cliente:", error);
        alert(error.message || "No se pudo actualizar el cliente.");
    }
}

async function deleteRegisteredClient(clientId) {
    if (!canManageRegisteredClients()) {
        alert("Conéctate para eliminar clientes.");
        return;
    }
    const client = clientRecords.find(record => String(record.id) === String(clientId));
    if (!client || !confirm(`¿Eliminar a ${client.nombre} de la ruta ${client.ruta}? Las facturas anteriores no cambiarán.`)) return;

    try {
        const { data, error } = await supabaseClient
            .from("clientes")
            .delete()
            .eq("id", clientId)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Supabase no encontró el cliente para eliminarlo.");
        await loadClientRegistryFromSupabase();
    } catch (error) {
        console.error("No se pudo eliminar el cliente:", error);
        alert(error.message || "No se pudo eliminar el cliente.");
    }
}

async function syncCustomersFromInvoiceHistory() {
    if (!hasAuthenticatedSupabaseSession) {
        throw new Error("Debes iniciar sesión para sincronizar clientes.");
    }
    if (!navigator.onLine) return;

    const clients = new Map();
    invoiceHistory.forEach(invoice => {
        const client = getClientFromInvoice(invoice);
        if (client) clients.set(getClientIdentity(client), client);
    });
    if (clients.size === 0) return;

    const { data: existingClients, error: existingError } = await supabaseClient
        .from("clientes")
        .select("nombre,ruta");
    if (existingError) throw existingError;
    const existingKeys = new Set((existingClients || []).map(getClientRouteIdentity));
    const clientsToInsert = [...clients.values()]
        .filter(client => !existingKeys.has(getClientRouteIdentity(client)));
    if (clientsToInsert.length === 0) return;

    const { error } = await supabaseClient
        .from("clientes")
        .upsert(clientsToInsert, { onConflict: "nombre,telefono,ruta", ignoreDuplicates: true });
    if (error) throw error;
}

async function syncClientFromInvoice(invoice) {
    const client = getClientFromInvoice(invoice);
    if (!client) return;
    if (!hasAuthenticatedSupabaseSession) {
        throw new Error("Debes iniciar sesión para sincronizar clientes.");
    }

    const { data: existingClient, error: existingError } = await supabaseClient
        .from("clientes")
        .select("id")
        .eq("nombre", client.nombre)
        .eq("ruta", client.ruta)
        .limit(1)
        .maybeSingle();
    if (existingError) throw existingError;
    if (existingClient) return;

    const { error } = await supabaseClient
        .from("clientes")
        .upsert(client, { onConflict: "nombre,telefono,ruta", ignoreDuplicates: true });
    if (error) throw error;
}

async function loadClientRegistryFromSupabase() {
    if (!supabaseClient || !hasAuthenticatedSupabaseSession) {
        clientsLoadError = "Inicia sesión para consultar el registro de clientes.";
        clientRecords = [];
        clientsFromCache = false;
        renderClientRegistry();
        return;
    }

    clientsLoading = true;
    clientsLoadError = "";
    clientsFromCache = false;
    renderClientRegistry();
    try {
        if (!navigator.onLine) throw new Error("Sin conexión a internet.");
        const { data, error } = await supabaseClient
            .from("clientes")
            .select("id,nombre,telefono,ruta")
            .order("ruta")
            .order("nombre");
        if (error) throw error;
        clientRecords = data || [];
        clientCacheTimestamp = new Date().toISOString();
        try {
            localStorage.setItem(CLIENT_CACHE_STORAGE_KEY, JSON.stringify({
                savedAt: clientCacheTimestamp,
                records: clientRecords
            }));
        } catch (cacheError) {
            console.error("No se pudo guardar una copia local de los clientes:", cacheError);
            updateConnectionStatus("No se pudo guardar una copia local del registro de clientes.", true);
        }
    } catch (error) {
        console.error("No se pudo cargar el registro de clientes:", error);
        try {
            const cache = JSON.parse(localStorage.getItem(CLIENT_CACHE_STORAGE_KEY) || "null");
            const cachedRecords = Array.isArray(cache?.records) ? cache.records : [];
            const locallyRecordedClients = invoiceHistory
                .map(getClientFromInvoice)
                .filter(Boolean);
            const mergedRecords = new Map();
            [...cachedRecords, ...locallyRecordedClients].forEach(client => {
                mergedRecords.set(getClientIdentity(client), client);
            });
            if (Array.isArray(cache?.records) || locallyRecordedClients.length > 0) {
                clientRecords = [...mergedRecords.values()];
                clientCacheTimestamp = cache?.savedAt || null;
                clientsFromCache = true;
                const cachedAt = clientCacheTimestamp
                    ? `guardados el ${new Date(clientCacheTimestamp).toLocaleString("es-VE")}`
                    : "obtenidos de facturas guardadas en este dispositivo";
                updateConnectionStatus(`No se pudo actualizar el registro desde Supabase. Mostrando clientes ${cachedAt}.`, true);
            } else {
                throw new Error("No hay clientes guardados localmente.");
            }
        } catch (cacheError) {
            console.error("No se pudo leer la copia local de los clientes:", cacheError);
            clientsLoadError = !navigator.onLine
                ? "No hay conexión y todavía no existe una copia local del registro de clientes."
                : "No se pudo cargar el registro ni existe una copia local. Revisa la conexión y las políticas RLS.";
            clientRecords = [];
        }
    } finally {
        clientsLoading = false;
        renderClientRegistry();
    }
}

function renderClientRegistry() {
    const container = document.getElementById("client-registry-list");
    container.innerHTML = "";
    const adminForm = document.getElementById("client-admin-form");
    const isBoss = currentUserRole === "boss";
    adminForm.classList.toggle("hidden", !isBoss);
    adminForm.querySelectorAll("input, select, button").forEach(control => {
        control.disabled = !canManageRegisteredClients();
    });
    renderRegisteredClientOptions();

    if (clientsLoading) {
        container.innerHTML = '<p class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Cargando clientes...</p>';
        return;
    }
    if (clientsLoadError) {
        container.innerHTML = `<p class="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700">${clientsLoadError}</p>`;
        return;
    }
    if (clientsFromCache) {
        const cachedAt = clientCacheTimestamp
            ? `guardados el ${new Date(clientCacheTimestamp).toLocaleString("es-VE")}`
            : "obtenidos de facturas guardadas en este dispositivo";
        const warning = document.createElement("p");
        warning.className = "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900";
        warning.textContent = `Mostrando clientes ${cachedAt}; podrían faltar cambios recientes.`;
        container.appendChild(warning);
    }
    if (clientRecords.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500";
        emptyState.textContent = "Todavía no hay clientes registrados.";
        container.appendChild(emptyState);
        return;
    }

    const routes = getAvailableClientRoutes();

    routes.forEach(route => {
        const routeClients = clientRecords.filter(client => client.ruta === route);
        const section = document.createElement("section");
        section.className = "rounded-lg border border-slate-200 bg-white p-4";

        const heading = document.createElement("div");
        heading.className = "mb-3 flex items-center justify-between border-b border-slate-100 pb-3";
        const title = document.createElement("h3");
        title.className = "text-sm font-bold text-slate-900";
        title.textContent = route;
        const count = document.createElement("span");
        count.className = "rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600";
        count.textContent = `${routeClients.length} ${routeClients.length === 1 ? "cliente" : "clientes"}`;
        heading.append(title, count);
        section.appendChild(heading);

        if (routeClients.length === 0) {
            const empty = document.createElement("p");
            empty.className = "text-sm text-slate-500";
            empty.textContent = "Todavía no hay clientes registrados en esta ruta.";
            section.appendChild(empty);
        } else {
            const list = document.createElement("ul");
            list.className = "divide-y divide-slate-100";
            routeClients.forEach(client => {
                const item = document.createElement("li");
                item.className = "flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between";
                const name = document.createElement("p");
                name.className = "text-sm font-semibold text-slate-800";
                name.textContent = client.nombre;
                const phone = document.createElement("p");
                phone.className = "mt-0.5 text-xs text-slate-500";
                phone.textContent = client.telefono ? `Teléfono: ${client.telefono}` : "Sin teléfono";
                const details = document.createElement("div");
                details.append(name, phone);
                item.appendChild(details);
                if (isBoss && client.id != null) {
                    if (editingClientId === String(client.id)) {
                        const form = document.createElement("form");
                        form.className = "grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]";
                        form.addEventListener("submit", event => saveRegisteredClient(event, client.id));

                        const nameInput = document.createElement("input");
                        nameInput.name = "clientName";
                        nameInput.type = "text";
                        nameInput.maxLength = 160;
                        nameInput.required = true;
                        nameInput.value = client.nombre;
                        nameInput.setAttribute("aria-label", `Nombre del cliente ${client.nombre}`);
                        nameInput.className = "min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10";

                        const phoneInput = document.createElement("input");
                        phoneInput.name = "clientPhone";
                        phoneInput.type = "tel";
                        phoneInput.maxLength = 30;
                        phoneInput.required = true;
                        phoneInput.value = client.telefono || "";
                        phoneInput.setAttribute("aria-label", `Teléfono del cliente ${client.nombre}`);
                        phoneInput.className = "min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10";

                        const routeSelect = createClientRouteSelect(client.ruta);
                        routeSelect.name = "route";
                        routeSelect.setAttribute("aria-label", `Ruta del cliente ${client.nombre}`);

                        const saveButton = document.createElement("button");
                        saveButton.type = "submit";
                        saveButton.disabled = !canManageRegisteredClients();
                        saveButton.className = "rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50";
                        saveButton.textContent = "Guardar";

                        const cancelButton = document.createElement("button");
                        cancelButton.type = "button";
                        cancelButton.className = "rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600";
                        cancelButton.textContent = "Cancelar";
                        cancelButton.addEventListener("click", () => {
                            editingClientId = null;
                            renderClientRegistry();
                        });

                        form.append(nameInput, phoneInput, routeSelect, saveButton, cancelButton);
                        item.appendChild(form);
                    } else {
                        const actions = document.createElement("div");
                        actions.className = "flex shrink-0 items-center gap-2";

                        const editButton = document.createElement("button");
                        editButton.type = "button";
                        editButton.disabled = !canManageRegisteredClients();
                        editButton.className = "rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
                        editButton.textContent = "Editar";
                        editButton.addEventListener("click", () => startEditingClient(client.id));

                        const deleteButton = document.createElement("button");
                        deleteButton.type = "button";
                        deleteButton.disabled = !canManageRegisteredClients();
                        deleteButton.className = "rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50";
                        deleteButton.textContent = "Eliminar";
                        deleteButton.addEventListener("click", () => deleteRegisteredClient(client.id));

                        actions.append(editButton, deleteButton);
                        item.appendChild(actions);
                    }
                }
                list.appendChild(item);
            });
            section.appendChild(list);
        }

        container.appendChild(section);
    });
}
