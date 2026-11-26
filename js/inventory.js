// Catalogo de productos e inventario.
let pendingProductImport = null;
let productImportInProgress = false;
let productImportExcelLibraryPromise = null;

const PRODUCT_IMPORT_FIELD_ALIASES = {
    name: ["name", "nombre", "producto", "product", "descripcion", "description"],
    category: ["category", "categoria", "tipo", "grupo"],
    unit: ["unit", "unidad", "presentacion", "presentation", "medida"],
    price: ["price", "precio", "precio_unitario", "unit_price", "precio_venta"],
    boxPrice: ["precio_caja", "precio_por_caja", "box_price", "boxprice"],
    liters: ["litros", "liters", "capacidad_litros", "capacity_liters"],
    stock: ["stock", "existencia", "inventario", "cantidad"],
    unitsPerBox: ["unidades_por_caja"],
    looseUnits: ["stock_unidades_sueltas", "stock_unidades", "unidades_sueltas"]
};

function getProductLitersLabel(product) {
    const liters = Number(product.liters);
    return product.liters == null || !Number.isFinite(liters) || liters <= 0
        ? ""
        : `${liters.toLocaleString("es-VE", { maximumFractionDigits: 3 })} L`;
}

function getProductDisplayName(product) {
    const name = String(product.name || "");
    const litersLabel = getProductLitersLabel(product);
    return litersLabel && !/\b\d+(?:[.,]\d+)?\s*L\b/i.test(name)
        ? `${name} (${litersLabel})`
        : name;
}

function escapeInventoryHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

function setAddProductStatus(message, isError = false) {
    const status = document.getElementById("add-product-status");
    status.className = isError
        ? "text-sm text-red-700"
        : "text-sm text-emerald-700";
    status.textContent = message;
}

async function addInventoryProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const status = document.getElementById("add-product-status");
    status.classList.remove("hidden");

    if (currentUserRole !== "boss" || !hasAuthenticatedSupabaseSession) {
        setAddProductStatus("Solo el administrador con sesión iniciada puede agregar productos.", true);
        return;
    }
    if (!navigator.onLine || !supabaseClient) {
        setAddProductStatus("Se necesita conexión con Supabase para agregar el producto.", true);
        return;
    }

    const name = form.elements.name.value.trim().toLocaleUpperCase("es");
    const category = form.elements.category.value.trim().toLocaleUpperCase("es");
    const unitsPerBox = Number(form.elements.unitsPerBox.value);
    const liters = Number(form.elements.liters.value);
    const wholesalePrice = Number(form.elements.wholesalePrice.value);
    const unitPrice = Number(form.elements.unitPrice.value);
    if (!name || !category
        || !Number.isInteger(unitsPerBox) || unitsPerBox <= 0
        || !Number.isFinite(liters) || liters <= 0
        || !Number.isFinite(wholesalePrice) || wholesalePrice <= 0
        || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        setAddProductStatus("Completa todos los campos con valores válidos mayores que cero.", true);
        return;
    }

    submitButton.disabled = true;
    const originalButtonLabel = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Guardando...';
    try {
        const { data, error } = await supabaseClient
            .from("productos")
            .insert({
                name,
                category,
                unit: "botella",
                price: unitPrice,
                precio_caja: wholesalePrice,
                litros: liters,
                stock: 0,
                unidades_por_caja: unitsPerBox,
                stock_unidades_sueltas: 0
            })
            .select("*")
            .single();
        if (error) throw error;

        const product = mapSupabaseProduct(data);
        if (!product) throw new Error("Supabase guardó el producto, pero devolvió datos incompletos.");
        products.push(product);
        productLoadError = "";
        const savedAt = new Date().toISOString();
        productCacheTimestamp = savedAt;
        try {
            const cached = JSON.parse(localStorage.getItem(PRODUCT_CACHE_STORAGE_KEY) || "null");
            const cachedRows = cached && Array.isArray(cached.rows) ? cached.rows : [];
            cachedRows.push(data);
            localStorage.setItem(PRODUCT_CACHE_STORAGE_KEY, JSON.stringify({ savedAt, rows: cachedRows }));
        } catch (cacheError) {
            console.error("El producto se guardó en Supabase, pero no se pudo actualizar la copia local:", cacheError);
            updateConnectionStatus(`Producto guardado en Supabase; no se pudo actualizar la copia local: ${cacheError.message}`, true);
        }

        form.reset();
        renderInventory();
        renderCategoryFilters();
        renderProducts(getVisibleProducts());
        updateTotals();
        renderBilling();
        setAddProductStatus(`${name} se agregó correctamente al inventario.`);
    } catch (error) {
        console.error("No se pudo agregar el producto a Supabase:", error);
        setAddProductStatus(error.message || "No se pudo guardar el producto en Supabase.", true);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonLabel;
    }
}

function setProductImportStatus(message, isError = false) {
    const status = document.getElementById("product-import-status");
    status.className = `mt-3 text-sm ${isError ? "text-red-700" : "text-slate-600"}`;
    status.textContent = message;
}

function loadProductImportExcelLibrary() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!productImportExcelLibraryPromise) {
        productImportExcelLibraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
            script.async = true;
            script.onload = () => {
                if (window.XLSX) resolve(window.XLSX);
                else reject(new Error("El lector de Excel no quedó disponible."));
            };
            script.onerror = () => reject(new Error("No se pudo cargar el lector de Excel. Comprueba internet y vuelve a intentarlo."));
            document.head.appendChild(script);
        }).catch(error => {
            productImportExcelLibraryPromise = null;
            throw error;
        });
    }
    return productImportExcelLibraryPromise;
}

function normalizeProductImportName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("es");
}

function isBlankProductImportValue(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

function parseProductImportNumber(value, fieldLabel, rowNumber) {
    if (typeof value === "number") {
        if (Number.isFinite(value)) return value;
        throw new Error(`Fila ${rowNumber}: ${fieldLabel} debe ser un número válido.`);
    }

    const text = String(value).trim().replace(/\s/g, "").replace(/^(?:bsf?\.?)/i, "").replace(/[$€£]/g, "");
    if (!/^[+-]?\d[\d.,]*$/.test(text)) {
        throw new Error(`Fila ${rowNumber}: ${fieldLabel} debe ser un número válido.`);
    }
    let normalized = text;
    if (normalized.includes(",") && normalized.includes(".")) {
        normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
            ? normalized.replace(/\./g, "").replace(",", ".")
            : normalized.replace(/,/g, "");
    } else {
        normalized = normalized.replace(",", ".");
    }
    const number = Number(normalized);
    if (!text || !Number.isFinite(number)) {
        throw new Error(`Fila ${rowNumber}: ${fieldLabel} debe ser un número válido.`);
    }
    return number;
}

function getProductImportFieldIndexes(headerRow) {
    const indexes = {};
    const duplicates = [];
    headerRow.forEach((header, index) => {
        const normalizedHeader = normalizeColumnName(String(header || "").trim());
        if (!normalizedHeader) return;
        const field = Object.keys(PRODUCT_IMPORT_FIELD_ALIASES).find(key =>
            PRODUCT_IMPORT_FIELD_ALIASES[key].some(alias => normalizeColumnName(alias) === normalizedHeader)
        );
        if (!field) return;
        if (indexes[field] !== undefined) duplicates.push(PRODUCT_IMPORT_FIELD_ALIASES[field][0]);
        else indexes[field] = index;
    });

    if (duplicates.length) {
        throw new Error(`Hay columnas repetidas en el archivo: ${[...new Set(duplicates)].join(", ")}.`);
    }
    if (indexes.name === undefined) {
        throw new Error("El archivo debe tener una columna Nombre (o name).");
    }
    if (!Object.keys(indexes).some(field => field !== "name")) {
        throw new Error("Incluye al menos una columna para actualizar, como precio o stock.");
    }
    return indexes;
}

function buildProductImportPlan(sheetRows, catalog = products) {
    const indexes = getProductImportFieldIndexes(sheetRows[0] || []);
    const productsByName = new Map();
    catalog.forEach(product => {
        const key = normalizeProductImportName(product.name);
        if (!productsByName.has(key)) productsByName.set(key, []);
        productsByName.get(key).push(product);
    });

    const seenNames = new Set();
    const actions = [];
    const errors = [];
    const numericFields = {
        price: { label: "precio por unidad", minimum: 0 },
        boxPrice: { label: "precio por caja", minimum: 0 },
        liters: { label: "litros", minimum: 0, exclusive: true },
        stock: { label: "stock en cajas", minimum: 0, integer: true },
        unitsPerBox: { label: "unidades por caja", minimum: 1, integer: true },
        looseUnits: { label: "unidades sueltas", minimum: 0, integer: true }
    };

    sheetRows.slice(1).forEach((row, rowIndex) => {
        if (!row.some(value => !isBlankProductImportValue(value))) return;
        const rowNumber = rowIndex + 2;
        const getValue = field => indexes[field] === undefined ? undefined : row[indexes[field]];
        const name = String(getValue("name") || "").trim();
        if (!name) {
            errors.push(`Fila ${rowNumber}: falta el nombre del producto.`);
            return;
        }
        if (name.length > 160) {
            errors.push(`Fila ${rowNumber}: el nombre supera los 160 caracteres.`);
            return;
        }

        const nameKey = normalizeProductImportName(name);
        if (seenNames.has(nameKey)) {
            errors.push(`Fila ${rowNumber}: el producto "${name}" aparece más de una vez en el archivo.`);
            return;
        }
        seenNames.add(nameKey);

        const matches = productsByName.get(nameKey) || [];
        if (matches.length > 1) {
            errors.push(`Fila ${rowNumber}: "${name}" coincide con varios productos existentes; no se modificó.`);
            return;
        }

        const isNew = matches.length === 0;
        const fields = {};
        let rowHasError = false;
        ["category", "unit"].forEach(field => {
            const value = getValue(field);
            if (isBlankProductImportValue(value)) return;
            const text = String(value).trim();
            if (field === "category" && text.length > 80) {
                errors.push(`Fila ${rowNumber}: la categoría supera los 80 caracteres.`);
                rowHasError = true;
                return;
            }
            if (field === "unit" && text.length > 40) {
                errors.push(`Fila ${rowNumber}: la unidad supera los 40 caracteres.`);
                rowHasError = true;
                return;
            }
            fields[field] = field === "category" ? text.toLocaleUpperCase("es") : text;
        });

        Object.entries(numericFields).forEach(([field, rules]) => {
            const value = getValue(field);
            if (isBlankProductImportValue(value)) return;
            try {
                const number = parseProductImportNumber(value, rules.label, rowNumber);
                if (number < rules.minimum || (rules.exclusive && number === rules.minimum)) {
                    throw new Error(`Fila ${rowNumber}: ${rules.label} debe ser ${rules.exclusive ? "mayor que" : "como mínimo"} ${rules.minimum}.`);
                }
                if (rules.integer && (!Number.isSafeInteger(number) || number < 0)) {
                    throw new Error(`Fila ${rowNumber}: ${rules.label} debe ser un entero no negativo.`);
                }
                fields[field] = number;
            } catch (error) {
                errors.push(error.message);
                rowHasError = true;
            }
        });

        if (rowHasError) return;
        if (isNew) {
            const requiredFields = ["category", "liters", "stock", "unitsPerBox"];
            const missingFields = requiredFields.filter(field => fields[field] === undefined);
            if (missingFields.length) {
                errors.push(`Fila ${rowNumber}: el producto nuevo "${name}" necesita categoría, litros, stock y unidades por caja.`);
                return;
            }
            if ((fields.price !== undefined && fields.price <= 0)
                || (fields.boxPrice !== undefined && fields.boxPrice <= 0)) {
                errors.push(`Fila ${rowNumber}: los precios de un producto nuevo deben ser mayores que cero o dejarse vacíos.`);
                return;
            }
            fields.unit = fields.unit || "botella";
            if (fields.price === undefined) fields.price = null;
            if (fields.boxPrice === undefined) fields.boxPrice = null;
            if (fields.looseUnits === undefined) fields.looseUnits = 0;
        } else {
            if (!Object.keys(fields).length) {
                errors.push(`Fila ${rowNumber}: no hay campos con valores para actualizar "${name}".`);
                return;
            }
            if (fields.unitsPerBox !== undefined
                && Number.isInteger(matches[0].unitsPerBox)
                && fields.unitsPerBox !== matches[0].unitsPerBox
                && fields.stock === undefined) {
                errors.push(`Fila ${rowNumber}: incluye el stock en cajas para cambiar las unidades por caja de "${name}".`);
                return;
            }
            const metadata = supabaseProductMetadata.get(matches[0]);
            if (!metadata?.idColumn || metadata.sourceId == null) {
                errors.push(`Fila ${rowNumber}: "${name}" no tiene un identificador de Supabase para actualizar.`);
                return;
            }
            const missingColumns = Object.keys(fields).filter(field => !metadata.columns[field]);
            if (missingColumns.length) {
                errors.push(`Fila ${rowNumber}: faltan columnas de Supabase para actualizar ${missingColumns.join(", ")} en "${name}".`);
                return;
            }
        }

        actions.push({
            rowNumber,
            name: isNew ? name.toLocaleUpperCase("es") : matches[0].name,
            kind: isNew ? "insert" : "update",
            product: matches[0] || null,
            fields
        });
    });

    if (!actions.length && !errors.length) errors.push("El archivo no contiene productos para importar.");
    return { actions, errors };
}

function renderProductImportPreview(plan, fileName) {
    const preview = document.getElementById("product-import-preview");
    const body = document.getElementById("product-import-preview-rows");
    const errorList = document.getElementById("product-import-errors");
    const summary = document.getElementById("product-import-summary");
    const confirmButton = document.getElementById("product-import-confirm-button");
    const previewLimit = document.getElementById("product-import-preview-limit");
    const additions = plan.actions.filter(action => action.kind === "insert").length;
    const updates = plan.actions.length - additions;
    const stockUpdates = plan.actions.filter(action =>
        Object.prototype.hasOwnProperty.call(action.fields, "stock")
    ).length;
    const previewRows = plan.actions.slice(0, 20);
    const getPriceLabel = value => value === undefined
        ? "Sin cambio"
        : value === null ? "Pendiente" : `$${Number(value).toFixed(2)}`;

    preview.classList.remove("hidden");
    body.replaceChildren();
    errorList.replaceChildren();
    errorList.classList.toggle("hidden", plan.errors.length === 0);
    plan.errors.slice(0, 20).forEach(message => {
        const item = document.createElement("li");
        item.textContent = message;
        errorList.appendChild(item);
    });
    if (plan.errors.length > 20) {
        const item = document.createElement("li");
        item.textContent = `Y ${plan.errors.length - 20} errores más. Corrige el archivo y vuelve a cargarlo.`;
        errorList.appendChild(item);
    }

    summary.textContent = `${fileName}: ${updates} productos por actualizar y ${additions} nuevos; ${stockUpdates} filas reemplazarán el stock en cajas. ${plan.errors.length ? `Hay ${plan.errors.length} errores; corrígelos antes de importar.` : "Revisa la vista previa antes de confirmar."}`;
    previewRows.forEach(action => {
        const row = document.createElement("tr");
        [
            String(action.rowNumber),
            action.name,
            action.kind === "insert" ? "Agregar" : "Actualizar",
            getPriceLabel(action.fields.price),
            getPriceLabel(action.fields.boxPrice),
            action.fields.stock === undefined ? "—" : String(action.fields.stock)
        ].forEach(value => {
            const cell = document.createElement("td");
            cell.className = "px-3 py-2";
            cell.textContent = value;
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
    previewLimit.classList.toggle("hidden", plan.actions.length <= previewRows.length);
    previewLimit.textContent = `Mostrando las primeras ${previewRows.length} filas de ${plan.actions.length}.`;
    confirmButton.disabled = plan.errors.length > 0 || plan.actions.length === 0 || currentUserRole !== "boss";
    pendingProductImport = plan.errors.length ? null : plan;
    setProductImportStatus(plan.errors.length ? "No se harán cambios hasta corregir todos los errores." : "El archivo se validó. Confirma la importación cuando estés listo.");
}

async function previewProductImport(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    const preview = document.getElementById("product-import-preview");
    const confirmButton = document.getElementById("product-import-confirm-button");
    pendingProductImport = null;
    preview.classList.add("hidden");
    confirmButton.disabled = true;
    if (!file) return;
    if (currentUserRole !== "boss" || !hasAuthenticatedSupabaseSession) {
        setProductImportStatus("Solo el administrador con sesión iniciada puede importar el inventario.", true);
        return;
    }
    if (productsLoading) {
        setProductImportStatus("Espera a que termine de cargar el catálogo antes de importar.", true);
        return;
    }
    if (!navigator.onLine || !supabaseClient) {
        setProductImportStatus("Se necesita conexión con Supabase para importar productos.", true);
        return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        setProductImportStatus("Selecciona un archivo .xlsx, .xls o .csv.", true);
        return;
    }

    setProductImportStatus("Leyendo y validando el archivo...");
    try {
        const xlsx = await loadProductImportExcelLibrary();
        const workbook = xlsx.read(await file.arrayBuffer(), { type: "array", raw: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("El archivo no contiene hojas de cálculo.");
        const sheetRows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
            header: 1,
            defval: "",
            raw: true,
            blankrows: true
        });
        if (sheetRows.length < 2) throw new Error("La hoja debe tener encabezados y al menos una fila de productos.");
        const { data, error } = await supabaseClient.from("productos").select("*");
        if (error) throw new Error(`No se pudo verificar el catálogo actual en Supabase: ${error.message}`);
        const catalog = (data || []).map(mapSupabaseProduct).filter(Boolean);
        const plan = buildProductImportPlan(sheetRows, catalog);
        renderProductImportPreview(plan, file.name);
    } catch (error) {
        console.error("No se pudo preparar la importación del inventario:", error);
        input.value = "";
        setProductImportStatus(error.message || "No se pudo preparar la importación.", true);
    }
}

function downloadProductImportTemplate() {
    const csv = "\uFEFFnombre,categoria,unidad,precio,precio_caja,litros,stock,unidades_por_caja,stock_unidades_sueltas\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-inventario.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function importProductCatalog() {
    if (productImportInProgress || !pendingProductImport) return;
    if (currentUserRole !== "boss" || !hasAuthenticatedSupabaseSession || !navigator.onLine || !supabaseClient) {
        setProductImportStatus("Se requiere una sesión de administrador y conexión a internet para importar.", true);
        return;
    }
    const actions = pendingProductImport.actions;
    const confirmed = confirm(
        `Se importarán ${actions.length} productos. En los existentes, las celdas vacías conservarán los datos; en nuevos, los precios vacíos quedarán pendientes. El stock en cajas reemplazará las cajas actuales; si incluyes unidades sueltas, también serán reemplazadas. Los productos que no estén en el archivo se conservarán. ¿Continuar?`
    );
    if (!confirmed) return;

    const input = document.getElementById("product-import-file");
    const confirmButton = document.getElementById("product-import-confirm-button");
    productImportInProgress = true;
    input.disabled = true;
    confirmButton.disabled = true;
    let added = 0;
    let updated = 0;
    try {
        for (let index = 0; index < actions.length; index += 1) {
            const action = actions[index];
            setProductImportStatus(`Guardando fila ${action.rowNumber} (${index + 1} de ${actions.length})...`);
            if (action.kind === "update") {
                await saveProductFieldsToSupabase(action.product, action.fields);
                updated += 1;
            } else {
                const { data, error } = await supabaseClient
                    .from("productos")
                    .insert({
                        name: action.name,
                        category: action.fields.category,
                        unit: action.fields.unit,
                        price: action.fields.price,
                        precio_caja: action.fields.boxPrice,
                        litros: action.fields.liters,
                        stock: action.fields.stock,
                        unidades_por_caja: action.fields.unitsPerBox,
                        stock_unidades_sueltas: action.fields.looseUnits
                    })
                    .select("*")
                    .single();
                if (error) throw new Error(`Fila ${action.rowNumber}: ${error.message}`);
                if (!mapSupabaseProduct(data)) {
                    throw new Error(`Fila ${action.rowNumber}: Supabase guardó el producto, pero devolvió datos incompletos.`);
                }
                added += 1;
            }
        }

        pendingProductImport = null;
        input.value = "";
        await loadProductsFromSupabase();
        if (productsFromCache || productLoadError) {
            setProductImportStatus(`Se guardaron ${updated} productos actualizados y ${added} nuevos en Supabase, pero no se pudo confirmar la recarga del catálogo. Usa “Actualizar datos” antes de vender.`, true);
        } else {
            setProductImportStatus(`Importación completada: ${updated} productos actualizados y ${added} nuevos.`);
        }
    } catch (error) {
        console.error("Se interrumpió la importación del inventario:", error);
        pendingProductImport = null;
        input.value = "";
        await loadProductsFromSupabase();
        const refreshed = !productsFromCache && !productLoadError;
        const savedCount = added + updated;
        const details = savedCount
            ? `Se guardaron ${updated} actualizados y ${added} nuevos antes del error.`
            : "No se confirmó ningún cambio en la respuesta; revisa el catálogo antes de volver a importar.";
        const refreshNote = refreshed
            ? " Se volvió a consultar el catálogo en Supabase."
            : " No se pudo confirmar la recarga desde Supabase; actualiza los datos antes de continuar.";
        setProductImportStatus(`Importación interrumpida. ${details} ${error.message || "Revisa los permisos y vuelve a intentarlo."}${refreshNote}`, true);
    } finally {
        productImportInProgress = false;
        input.disabled = false;
        confirmButton.disabled = true;
    }
}

function loadDeletedProducts() {
    try {
        const savedIds = JSON.parse(localStorage.getItem("deletedProductIds") || "[]");
        deletedProductIds = Array.isArray(savedIds) ? savedIds.map(Number) : [];
        products = products.filter(product => !deletedProductIds.includes(product.id));
    } catch (error) {
        deletedProductIds = [];
        localStorage.removeItem("deletedProductIds");
    }
}

async function saveProductFieldsToSupabase(product, fields) {
    if (!navigator.onLine) {
        throw new Error("Se necesita conexión a internet para cambiar los datos del inventario.");
    }
    const metadata = supabaseProductMetadata.get(product);
    if (!supabaseClient) throw new Error("No se pudo conectar con Supabase para actualizar este producto.");
    if (!metadata?.idColumn || metadata.sourceId == null) {
        throw new Error("La tabla public.productos necesita un identificador en una columna id, producto_id, codigo o code para actualizar este producto.");
    }
    const requiredColumns = {
        category: "categoria",
        unit: "unidad",
        liters: "litros",
        stock: "stock",
        unitsPerBox: "unidades_por_caja",
        looseUnits: "stock_unidades_sueltas",
        price: "precio",
        boxPrice: "precio_caja"
    };
    const updates = {};
    Object.entries(fields).forEach(([field, value]) => {
        const column = metadata.columns[field];
        if (!column) {
            throw new Error(`La tabla public.productos no contiene la columna "${requiredColumns[field] || field}" necesaria para actualizar este producto.`);
        }
        updates[column] = value;
    });

    const { data, error } = await supabaseClient
        .from("productos")
        .update(updates)
        .eq(metadata.idColumn, metadata.sourceId)
        .select("*")
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Supabase no confirmó el cambio. Verifica los permisos RLS y que el producto exista.");

    const updatedProduct = mapSupabaseProduct(data);
    if (!updatedProduct) throw new Error("Supabase devolvió un producto actualizado con datos incompletos.");
    Object.assign(product, updatedProduct);
    supabaseProductMetadata.set(product, supabaseProductMetadata.get(updatedProduct));
}

async function saveProductFieldToSupabase(product, field, value) {
    return saveProductFieldsToSupabase(product, { [field]: value });
}

async function updateProductPrice(id, type, value) {
    if (currentUserRole !== "boss") {
        alert("Solo el jefe puede cambiar precios.");
        return;
    }
    const product = products.find(item => item.id === id);
    if (!product || !["price", "boxPrice"].includes(type)) return;

    const price = value === "" ? null : Number(value);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
        renderInventory();
        return;
    }

    try {
        await saveProductFieldToSupabase(product, type, price);
    } catch (error) {
        console.error("No se pudo actualizar el precio en Supabase:", error);
        alert(error.message || "No se pudo actualizar el precio en Supabase.");
        renderInventory();
        return;
    }

    renderInventory();
    renderProducts(getVisibleProducts());
    updateTotals();
    renderBilling();
}

function getVisibleProducts() {
    if (!selectedProductCategory) return [];
    const query = document.getElementById("search-product").value.trim().toLocaleLowerCase("es");
    return products.filter(product =>
        String(product.category || "").trim() === selectedProductCategory
        && String(product.name || "").toLocaleLowerCase("es").includes(query)
    );
}

function deleteInventoryProduct(id) {
    if (currentUserRole !== "boss") {
        alert("Solo el jefe puede eliminar productos del inventario.");
        return;
    }
    const product = products.find(item => item.id === id);
    if (!product || !confirm(`¿Eliminar ${product.name} del inventario y catálogo? El historial de facturas no cambiará.`)) return;

    deletedProductIds = [...new Set([...deletedProductIds, id])];
    try {
        localStorage.setItem("deletedProductIds", JSON.stringify(deletedProductIds));
    } catch (error) {
        alert("No se pudo actualizar el inventario en este dispositivo.");
        return;
    }

    products = products.filter(item => item.id !== id);
    delete cart[id];
    delete draftQuantities[id];
    updateTotals();
    renderInventory();
    renderProducts(getVisibleProducts());
    renderBilling();
}

function getNextInvoiceNumber() {
    const storedSequence = Number(localStorage.getItem("invoiceSequence")) || 0;
    const historySequence = invoiceHistory
        .filter(invoice => invoice.userId === currentUserId)
        .reduce((highest, invoice) => Math.max(highest, Number(invoice.sequence) || 0), 0);
    const nextSequence = Math.max(storedSequence, historySequence) + 1;
    return `FAC-${String(nextSequence).padStart(6, "0")}`;
}

function invalidateActiveInvoice() {
    if (activeInvoiceNumber && invoiceHistory.some(invoice => invoice.number === activeInvoiceNumber && invoice.userId === currentUserId)) {
        activeInvoiceNumber = null;
    }
    renderBilling();
}

function toggleAppSidebar() {
    const sidebar = document.getElementById("app-sidebar");
    if (sidebar.classList.contains("open")) {
        closeAppSidebar();
        return;
    }

    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    document.getElementById("app-sidebar-backdrop").classList.remove("hidden");
    const toggle = document.getElementById("app-sidebar-toggle");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Cerrar menú");
    toggle.setAttribute("title", "Cerrar menú");
    sidebar.querySelector("button").focus();
}

function closeAppSidebar() {
    const sidebar = document.getElementById("app-sidebar");
    const shouldRestoreFocus = sidebar.contains(document.activeElement)
        && !document.getElementById("app-shell").classList.contains("hidden");
    sidebar.classList.remove("open");
    sidebar.setAttribute("aria-hidden", "true");
    document.getElementById("app-sidebar-backdrop").classList.add("hidden");
    const toggle = document.getElementById("app-sidebar-toggle");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Abrir menú");
    toggle.setAttribute("title", "Abrir menú");
    if (shouldRestoreFocus) toggle.focus();
}

function openStockView() {
    showView("stock");
    closeAppSidebar();
    refreshInventory();
}

async function refreshInventory() {
    const button = document.getElementById("refresh-inventory-button");
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Actualizando...';
    updateConnectionStatus("Actualizando el inventario desde Supabase...");
    try {
        await loadProductsFromSupabase();
    } finally {
        button.disabled = false;
        button.innerHTML = originalLabel;
    }
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeAppSidebar();
        closeProductQuantityModal();
    }
});

async function updateStock(id, value) {
    if (currentUserRole !== "boss") {
        alert("Solo el jefe puede modificar el inventario.");
        return;
    }
    const prod = products.find(product => product.id === id);
    if (!prod) return;

    const quantity = value === "" ? null : Number(value);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) {
        renderInventory();
        return;
    }

    try {
        await saveProductFieldToSupabase(prod, "stock", quantity);
    } catch (error) {
        console.error("No se pudo actualizar el stock en Supabase:", error);
        alert(error.message || "No se pudo actualizar el stock en Supabase.");
        renderInventory();
        return;
    }

    renderInventory();
    renderProducts(getVisibleProducts());
}

async function updateProductUnitsPerBox(id, value) {
    if (currentUserRole !== "boss") {
        alert("Solo el jefe puede configurar las unidades por caja.");
        return;
    }
    const product = products.find(item => item.id === id);
    if (!product) return;

    const units = Number(value);
    if (!Number.isInteger(units) || units <= 0) {
        alert("Indica un número entero de unidades mayor que cero por caja.");
        renderInventory();
        return;
    }
    const fields = { unitsPerBox: units };
    if (Number.isSafeInteger(product.stock) && product.stock >= 0
        && Number.isInteger(product.unitsPerBox) && product.unitsPerBox > 0) {
        const looseUnits = Number.isInteger(product.looseUnits) && product.looseUnits >= 0
            ? product.looseUnits
            : 0;
        const totalUnits = product.stock * product.unitsPerBox + looseUnits;
        if (!Number.isSafeInteger(totalUnits)) {
            alert("No se puede conservar el inventario porque la cantidad total supera el límite permitido.");
            renderInventory();
            return;
        }
        const updatedBoxes = Math.floor(totalUnits / units);
        const updatedLooseUnits = totalUnits % units;
        fields.stock = updatedBoxes;
        if (supabaseProductMetadata.get(product)?.columns.looseUnits) {
            fields.looseUnits = updatedLooseUnits;
        } else if (updatedLooseUnits !== 0) {
            alert("Para conservar el inventario al cambiar el tamaño de caja, agrega la columna stock_unidades_sueltas en Supabase.");
            renderInventory();
            return;
        }
    }

    try {
        await saveProductFieldsToSupabase(product, fields);
    } catch (error) {
        console.error("No se pudo actualizar las unidades por caja en Supabase:", error);
        alert(error.message || "No se pudo actualizar las unidades por caja.");
        renderInventory();
        return;
    }

    renderInventory();
    renderProducts(getVisibleProducts());
}

function updateInventoryStockSummary(id) {
    const product = products.find(item => item.id === id);
    const boxesInput = document.getElementById(`inventory-stock-${id}`);
    const unitsPerBoxInput = document.getElementById(`inventory-units-per-box-${id}`);
    const summary = document.getElementById(`inventory-stock-summary-${id}`);
    if (!product || !boxesInput || !unitsPerBoxInput || !summary) return;

    const boxes = boxesInput.value.trim() ? Number(boxesInput.value) : null;
    if (boxes === null || !Number.isSafeInteger(boxes) || boxes < 0) {
        summary.textContent = "Ingresa una cantidad válida de cajas.";
        return;
    }
    const unitsPerBox = Number(unitsPerBoxInput.value);
    if (!Number.isInteger(unitsPerBox) || unitsPerBox <= 0) {
        summary.textContent = `Configura cuántas ${getProductUnitName(product, 2)} trae cada caja.`;
        return;
    }
    const looseUnits = Number.isInteger(product.looseUnits) && product.looseUnits >= 0
        ? product.looseUnits
        : 0;
    const totalUnits = boxes * unitsPerBox + looseUnits;
    if (!Number.isSafeInteger(totalUnits)) {
        summary.textContent = "La cantidad total supera el límite permitido.";
        return;
    }
    summary.textContent = `Total disponible: ${totalUnits} ${getProductUnitName(product, totalUnits)}.`;
}

function renderInventory() {
    const container = document.getElementById("inventory-list");
    container.innerHTML = "";
    const canManageInventory = currentUserRole === "boss";
    document.getElementById("add-product-form-container").classList.toggle("hidden", !canManageInventory);
    document.getElementById("product-import-panel").classList.toggle("hidden", !canManageInventory);
    const categoryOptions = document.getElementById("inventory-category-options");
    categoryOptions.replaceChildren();
    [...new Set(products.map(product => String(product.category || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "es"))
        .forEach(category => {
            const option = document.createElement("option");
            option.value = category;
            categoryOptions.appendChild(option);
        });

    if (products.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500";
        emptyState.textContent = productsLoading ? "Cargando inventario..." : productLoadError || "No hay productos en el inventario.";
        container.appendChild(emptyState);
        return;
    }

    const productsByCategory = new Map();
    products.forEach(product => {
        const category = String(product.category || "").trim() || "Sin categoría";
        if (!productsByCategory.has(category)) productsByCategory.set(category, []);
        productsByCategory.get(category).push(product);
    });

    [...productsByCategory.entries()]
        .sort(([categoryA], [categoryB]) => categoryA.localeCompare(categoryB, "es"))
        .forEach(([category, categoryProducts], categoryIndex) => {
            const section = document.createElement("section");
            section.className = "overflow-hidden rounded-lg border border-slate-200 bg-white";
            const isExpanded = expandedInventoryCategories.has(category);
            const categoryPanelId = `inventory-category-${categoryIndex}`;

            const heading = document.createElement("button");
            heading.type = "button";
            heading.className = "flex min-h-12 w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left transition hover:bg-sky-50/60";
            heading.setAttribute("aria-expanded", String(isExpanded));
            heading.setAttribute("aria-controls", categoryPanelId);
            heading.setAttribute("aria-label", `${isExpanded ? "Contraer" : "Expandir"} categoría ${category}`);
            const title = document.createElement("span");
            title.className = "text-sm font-bold text-slate-800";
            title.textContent = category;
            const count = document.createElement("span");
            count.className = "ml-auto rounded bg-sky-50 px-2 py-1 text-[10px] font-semibold text-slate-600";
            count.textContent = `${categoryProducts.length} ${categoryProducts.length === 1 ? "producto" : "productos"}`;
            const chevron = document.createElement("i");
            chevron.className = `fa-solid fa-chevron-down text-xs text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`;
            chevron.setAttribute("aria-hidden", "true");
            heading.append(title, count, chevron);

            const categoryPanel = document.createElement("div");
            categoryPanel.id = categoryPanelId;
            categoryPanel.className = "space-y-2.5 border-t border-slate-100 p-3";
            categoryPanel.hidden = !isExpanded;
            heading.addEventListener("click", () => {
                if (expandedInventoryCategories.has(category)) expandedInventoryCategories.delete(category);
                else expandedInventoryCategories.add(category);
                renderInventory();
            });

            section.appendChild(heading);
            section.appendChild(categoryPanel);
            container.appendChild(section);

            categoryProducts.forEach(prod => {
                const row = document.createElement("div");
                row.className = "grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto]";
                const unitsPerBoxLabel = getProductUnitLabel(prod);
                row.innerHTML = `
                    <div class="min-w-0">
                        <h3 class="text-sm font-semibold text-slate-900">${escapeInventoryHtml(getProductDisplayName(prod))}</h3>
                        <p class="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">${escapeInventoryHtml(prod.unit)}</p>
                        ${canManageInventory ? `
                            <div class="mt-3 grid grid-cols-2 gap-2">
                                <label class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Precio unidad
                                    <input type="number" min="0" step="0.01" value="${prod.price ?? ""}" placeholder="N/D" aria-label="Precio por unidad de ${escapeInventoryHtml(prod.name)}" onchange="updateProductPrice(${prod.id}, 'price', this.value)" class="mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-sm font-normal normal-case tracking-normal text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10">
                                </label>
                                <label class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Precio caja
                                    <input type="number" min="0" step="0.01" value="${prod.boxPrice ?? ""}" placeholder="N/D" aria-label="Precio por caja de ${escapeInventoryHtml(prod.name)}" onchange="updateProductPrice(${prod.id}, 'boxPrice', this.value)" class="mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-sm font-normal normal-case tracking-normal text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10">
                                </label>
                                <label class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">${unitsPerBoxLabel} por caja
                                    <input id="inventory-units-per-box-${prod.id}" type="number" min="1" step="1" value="${prod.unitsPerBox ?? ""}" placeholder="Configurar" aria-label="${unitsPerBoxLabel} por caja de ${escapeInventoryHtml(prod.name)}" oninput="updateInventoryStockSummary(${prod.id})" onchange="updateProductUnitsPerBox(${prod.id}, this.value)" class="mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-sm font-normal normal-case tracking-normal text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10">
                                </label>
                            </div>
                            <p id="inventory-stock-summary-${prod.id}" class="mt-3 rounded-md bg-slate-50 p-2 text-xs font-medium text-slate-700" aria-live="polite"></p>
                        ` : `<p class="mt-2 text-xs text-slate-600">Unidad: ${prod.price == null ? "Sin precio" : `$${Number(prod.price).toFixed(2)}`} · Caja: ${prod.boxPrice == null ? "Sin precio" : `$${Number(prod.boxPrice).toFixed(2)}`}</p>`}
                    </div>
                    <div class="flex min-w-0 items-start justify-between gap-2 sm:justify-end">
                        ${canManageInventory ? `
                            <label class="flex items-center gap-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">Stock (cajas)
                                <input id="inventory-stock-${prod.id}" type="number" min="0" step="1" value="${prod.stock ?? ""}" placeholder="N/D" aria-label="Stock en cajas de ${escapeInventoryHtml(prod.name)}" oninput="updateInventoryStockSummary(${prod.id})" onchange="updateStock(${prod.id}, this.value)" class="w-20 rounded-md border border-slate-200 bg-white p-2 text-right text-sm font-normal normal-case tracking-normal text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10">
                            </label>
                        ` : `<p class="min-w-0 text-right text-xs font-semibold text-slate-700">Disponible: ${getProductStockSummary(prod)}</p>`}
                        ${canManageInventory ? `<button type="button" onclick="deleteInventoryProduct(${prod.id})" aria-label="Eliminar ${escapeInventoryHtml(prod.name)} del inventario" title="Eliminar del inventario" class="rounded-md p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-700"><i class="fa-solid fa-trash-can"></i></button>` : ""}
                    </div>
                `;
                categoryPanel.appendChild(row);
                if (canManageInventory) updateInventoryStockSummary(prod.id);
            });
        });
}

function renderProducts(list) {
    const container = document.getElementById("products-list");
    container.innerHTML = "";

    if (!selectedProductCategory) return;
    if (list.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500";
        emptyState.textContent = productsLoading
            ? "Cargando productos desde Supabase..."
            : products.length === 0
                ? productLoadError || "No hay productos disponibles en Supabase."
                : "No se encontraron productos en esta categoría.";
        container.appendChild(emptyState);
        return;
    }

    list.forEach(prod => {
        const quantities = cart[prod.id] || { unit: 0, box: 0 };
        const row = document.createElement("button");
        row.type = "button";
        row.className = "flex min-h-16 w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-400 hover:bg-slate-50";
        row.setAttribute("aria-label", `Seleccionar ${prod.name}. Stock: ${getProductStockSummary(prod)}.`);
        row.addEventListener("click", () => openProductQuantityModal(prod.id));

        const details = document.createElement("span");
        details.className = "min-w-0 flex-1";
        const name = document.createElement("span");
        name.className = "block break-words text-sm font-semibold text-slate-900";
        name.textContent = getProductDisplayName(prod);
        const price = document.createElement("span");
        price.className = "mt-1 block text-xs text-slate-500";
        price.textContent = `Unidad: ${prod.price == null ? "Precio pendiente" : `$${Number(prod.price).toFixed(2)}`} · Caja: ${prod.boxPrice == null ? "Precio pendiente" : `$${Number(prod.boxPrice).toFixed(2)}`}`;
        const stock = document.createElement("span");
        stock.className = "mt-1 block text-xs text-slate-600";
        stock.textContent = `Stock: ${getProductStockSummary(prod)}`;
        details.append(name, price, stock);

        const selected = document.createElement("span");
        selected.className = "shrink-0 text-right text-xs font-semibold text-slate-700";
        selected.textContent = quantities.unit || quantities.box
            ? `${quantities.unit} ${getProductUnitLabel(prod).toLowerCase()} · ${quantities.box} ${quantities.box === 1 ? "caja" : "cajas"}`
            : "Elegir";
        const arrow = document.createElement("i");
        arrow.className = "fa-solid fa-chevron-right shrink-0 text-xs text-slate-400";
        arrow.setAttribute("aria-hidden", "true");
        row.append(details, selected, arrow);
        container.appendChild(row);
    });
}

function toggleProductPicker() {
    const panel = document.getElementById("product-picker-panel");
    const toggle = document.getElementById("product-picker-toggle");
    const arrow = document.getElementById("product-picker-arrow");
    const isOpening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !isOpening);
    toggle.setAttribute("aria-expanded", String(isOpening));
    arrow.classList.toggle("fa-chevron-down", !isOpening);
    arrow.classList.toggle("fa-chevron-up", isOpening);
}

function filterProducts() {
    renderProducts(getVisibleProducts());
}

function renderCategoryFilters() {
    const container = document.getElementById("category-filters");
    const categories = [...new Set(products.map(product => product.category).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "es"));
    if (!categories.includes(selectedProductCategory)) selectedProductCategory = "";
    const search = document.getElementById("search-product");
    const categoryProductsPanel = document.getElementById("category-products-panel");
    search.disabled = !selectedProductCategory;
    search.placeholder = selectedProductCategory
        ? `Buscar en ${selectedProductCategory}`
        : "Elige una categoría para buscar productos";
    categoryProductsPanel.classList.toggle("hidden", !selectedProductCategory);
    if (!selectedProductCategory) search.value = "";
    container.innerHTML = "";

    if (categories.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "rounded-md bg-slate-50 p-3 text-sm text-slate-500";
        emptyState.textContent = productsLoading
            ? "Cargando categorías..."
            : productLoadError || "No hay categorías disponibles.";
        container.appendChild(emptyState);
        container.appendChild(categoryProductsPanel);
        return;
    }

    categories.forEach(category => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.category = category;
        const isSelected = category === selectedProductCategory;
        button.setAttribute("aria-pressed", String(isSelected));
        button.setAttribute("aria-expanded", String(isSelected));
        button.className = isSelected
            ? "flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-blue-500 bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-2 text-left text-sm font-semibold text-white"
            : "flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-sky-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:border-blue-400 hover:bg-sky-50";
        const label = document.createElement("span");
        label.className = "min-w-0 truncate";
        label.textContent = category;
        const arrow = document.createElement("i");
        arrow.className = `fa-solid ${isSelected ? "fa-chevron-up" : "fa-chevron-down"} shrink-0 text-xs`;
        arrow.setAttribute("aria-hidden", "true");
        button.append(label, arrow);
        button.addEventListener("click", () => setCategoryFilter(category));
        container.appendChild(button);
        if (isSelected) container.appendChild(categoryProductsPanel);
    });

    if (!selectedProductCategory) container.appendChild(categoryProductsPanel);
}

function setCategoryFilter(category) {
    selectedProductCategory = selectedProductCategory === category ? "" : category;
    document.getElementById("search-product").value = "";
    renderCategoryFilters();
    filterProducts();
}

function returnToCategories() {
    if (selectedProductCategory) setCategoryFilter(selectedProductCategory);
}

function getProductUnitLabel(product) {
    const label = getProductUnitName(product, 2);
    return `${label.charAt(0).toLocaleUpperCase("es")}${label.slice(1)}`;
}

function getProductUnitName(product, quantity) {
    const unit = String(product.unit || "unidad").trim();
    const normalizedUnit = unit.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["bot", "btl", "botella", "botellas"].includes(normalizedUnit)) return quantity === 1 ? "botella" : "botellas";
    if (["unidad", "unidades"].includes(normalizedUnit)) return quantity === 1 ? "unidad" : "unidades";
    return quantity === 1 || normalizedUnit.endsWith("s") ? unit : `${unit}s`;
}

function openProductQuantityModal(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    if (currentUserRole === "seller" && invoiceHistory.some(invoice => invoice.number === activeInvoiceNumber && invoice.userId === currentUserId)) {
        alert("La factura ya fue emitida. El vendedor no puede modificarla.");
        return;
    }

    activeProductId = id;
    const quantities = cart[id] || { unit: 0, box: 0 };
    document.getElementById("product-modal-title").textContent = getProductDisplayName(product);
    document.getElementById("product-modal-stock").textContent = `Stock disponible: ${getProductStockSummary(product)}`;
    document.getElementById("product-modal-price").textContent = `Unidad: ${product.price == null ? "Precio pendiente" : `$${Number(product.price).toFixed(2)}`} · Caja: ${product.boxPrice == null ? "Precio pendiente" : `$${Number(product.boxPrice).toFixed(2)}`}`;
    document.getElementById("product-modal-unit-label").textContent = getProductUnitLabel(product);
    document.getElementById("product-modal-unit-quantity").value = String(quantities.unit || 0);
    document.getElementById("product-modal-box-quantity").value = String(quantities.box || 0);
    document.getElementById("product-modal-status").classList.add("hidden");
    document.getElementById("product-modal-remove-button").classList.toggle("hidden", !cart[id]);

    const modal = document.getElementById("product-quantity-modal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    document.getElementById("product-modal-unit-quantity").focus();
}

function saveProductFromModal() {
    if (activeProductId != null) markProductReady(activeProductId);
}

function markProductReady(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    const unitInput = document.getElementById("product-modal-unit-quantity");
    const boxInput = document.getElementById("product-modal-box-quantity");
    const modalStatus = document.getElementById("product-modal-status");
    const quantities = {
        unit: unitInput.value === "" ? 0 : Number(unitInput.value),
        box: boxInput.value === "" ? 0 : Number(boxInput.value)
    };
    const setError = message => {
        modalStatus.textContent = message;
        modalStatus.classList.remove("hidden");
    };

    if (!Number.isInteger(quantities.unit) || quantities.unit < 0
        || !Number.isInteger(quantities.box) || quantities.box < 0) {
        setError("Ingresa cantidades enteras iguales o mayores que cero.");
        return;
    }
    if (quantities.unit === 0 && quantities.box === 0) {
        setError("Ingresa una cantidad de botellas/unidades o cajas.");
        return;
    }
    if (!Number.isInteger(product.unitsPerBox) || product.unitsPerBox <= 0
        || !Number.isInteger(product.stock) || product.stock < 0) {
        setError("Configura el stock y las unidades por caja antes de agregar este producto.");
        return;
    }

    const looseUnits = Number.isInteger(product.looseUnits) && product.looseUnits >= 0
        ? product.looseUnits
        : 0;
    const availableUnits = product.stock * product.unitsPerBox + looseUnits;
    const requestedUnits = quantities.unit + quantities.box * product.unitsPerBox;
    if (requestedUnits > availableUnits) {
        setError(`Stock insuficiente. ${getProductStockSummary(product)} disponibles.`);
        return;
    }

    cart[id] = { ...quantities };
    delete draftQuantities[id];
    activeInvoiceNumber = null;
    updateTotals();
    renderBilling();
    filterProducts();
    closeProductQuantityModal();
}

function closeProductQuantityModal() {
    const modal = document.getElementById("product-quantity-modal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    activeProductId = null;
}

function handleProductModalBackdrop(event) {
    if (event.target === event.currentTarget) closeProductQuantityModal();
}

function removeProductFromModal() {
    if (activeProductId == null) return;
    const productId = activeProductId;
    closeProductQuantityModal();
    removeFromInvoice(productId);
}

function removeFromInvoice(id) {
    if (currentUserRole === "seller" && invoiceHistory.some(invoice => invoice.number === activeInvoiceNumber && invoice.userId === currentUserId)) {
        alert("La factura ya fue emitida. El vendedor no puede modificarla.");
        return;
    }
    delete cart[id];
    delete draftQuantities[id];
    activeInvoiceNumber = null;
    updateTotals();
    renderBilling();
    filterProducts();
}
