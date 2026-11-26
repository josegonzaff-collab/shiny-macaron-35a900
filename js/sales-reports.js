// Resumenes e informes de ventas.
function renderSalesReports() {
    const periods = getSalesReportPeriods();
    document.getElementById("sales-weekly-period").textContent = periods.weekly.label;
    document.getElementById("sales-monthly-period").textContent = periods.monthly.label;

    renderSalesRouteSummary(
        document.getElementById("sales-weekly-routes"),
        getInvoicesInSalesPeriod(periods.weekly)
    );
    renderSalesRouteSummary(
        document.getElementById("sales-monthly-routes"),
        getInvoicesInSalesPeriod(periods.monthly)
    );
    renderSoldProductsSummary(
        document.getElementById("sales-weekly-products"),
        getInvoicesInSalesPeriod(periods.weekly)
    );
    renderSoldProductsSummary(
        document.getElementById("sales-monthly-products"),
        getInvoicesInSalesPeriod(periods.monthly)
    );
}

function getInvoicesInSalesPeriod(period) {
    return invoiceHistory.filter(invoice => {
        const date = new Date(invoice.date);
        if (!Number.isFinite(date.getTime())) return false;
        const dateKey = getCaracasDateKey(date);
        return dateKey >= period.start && dateKey <= period.end;
    });
}

function renderSalesRouteSummary(container, invoices) {
    container.innerHTML = "";
    if (invoices.length === 0) {
        container.innerHTML = '<p class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 sm:col-span-2">No hay ventas registradas en este período.</p>';
        return;
    }

    const routeTotals = new Map();
    invoices.forEach(invoice => {
        const route = String(invoice.clientRoute || "").trim() || "Sin ruta";
        if (!routeTotals.has(route)) {
            routeTotals.set(route, {
                cash: 0,
                credit: 0,
                other: 0,
                invoiceCount: 0,
                unpricedCount: 0
            });
        }

        const totals = routeTotals.get(route);
        totals.invoiceCount += 1;
        const amount = invoice.total == null || String(invoice.total).trim() === ""
            ? NaN
            : Number(invoice.total);
        if (!Number.isFinite(amount) || amount < 0) {
            totals.unpricedCount += 1;
            return;
        }

        const paymentMethod = String(invoice.paymentMethod || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase();
        if (paymentMethod === "contado") totals.cash += amount;
        else if (paymentMethod === "credito") totals.credit += amount;
        else totals.other += amount;
    });

    [...routeTotals.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "es"))
        .forEach(([route, totals]) => {
            const card = document.createElement("details");
            card.className = "sales-route-accordion overflow-hidden rounded-lg border border-slate-200 bg-white";
            const summary = document.createElement("summary");
            summary.className = "flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";
            const heading = document.createElement("span");
            heading.className = "min-w-0 truncate text-sm font-bold text-slate-900";
            heading.textContent = route;
            const summaryDetails = document.createElement("span");
            summaryDetails.className = "flex shrink-0 items-center gap-2";
            const invoiceCount = document.createElement("span");
            invoiceCount.className = "rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600";
            invoiceCount.textContent = `${totals.invoiceCount} factura${totals.invoiceCount === 1 ? "" : "s"}`;
            const chevron = document.createElement("i");
            chevron.className = "fa-solid fa-chevron-down sales-accordion-chevron text-xs text-slate-500";
            chevron.setAttribute("aria-hidden", "true");
            summaryDetails.append(invoiceCount, chevron);
            summary.append(heading, summaryDetails);

            const values = document.createElement("dl");
            values.className = "grid grid-cols-2 gap-3 text-xs sm:grid-cols-4";
            const metrics = [
                ["Contado", totals.cash],
                ["Crédito", totals.credit],
                ["Total", totals.cash + totals.credit + totals.other]
            ];
            if (totals.other > 0) metrics.splice(2, 0, ["Otros", totals.other]);
            metrics.forEach(([label, amount]) => {
                const item = document.createElement("div");
                item.className = "rounded-md bg-slate-50 p-2";
                const term = document.createElement("dt");
                term.className = "text-slate-500";
                term.textContent = label;
                const value = document.createElement("dd");
                value.className = "mt-1 font-bold text-slate-900";
                value.textContent = `$${Number(amount).toFixed(2)}`;
                item.append(term, value);
                values.appendChild(item);
            });

            const note = document.createElement("p");
            note.className = "mt-3 text-xs text-slate-500";
            note.textContent = totals.unpricedCount
                ? `${totals.unpricedCount} factura${totals.unpricedCount === 1 ? "" : "s"} sin monto, excluida${totals.unpricedCount === 1 ? "" : "s"} del total.`
                : "";
            const content = document.createElement("div");
            content.className = "border-t border-slate-100 p-3 sm:p-4";
            content.appendChild(values);
            if (totals.unpricedCount) content.appendChild(note);
            card.append(summary, content);
            container.appendChild(card);
        });
}

function renderSoldProductsSummary(container, invoices) {
    container.innerHTML = "";
    const productUnitsPerBox = new Map(products.map(product => [
        String(product.id),
        Number.isInteger(Number(product.unitsPerBox)) && Number(product.unitsPerBox) > 0
            ? Number(product.unitsPerBox)
            : null
    ]));
    const productTotals = new Map();

    invoices.forEach(invoice => {
        if (!Array.isArray(invoice.items)) return;
        invoice.items.forEach(item => {
            const name = String(item.name || "Producto sin nombre").trim();
            const key = item.productId == null ? name.toLocaleLowerCase() : String(item.productId);
            const units = Math.max(0, Number(item.quantityUnit) || 0);
            const boxes = Math.max(0, Number(item.quantityBox) || 0);
            if (units + boxes === 0) return;

            const savedUnitsPerBox = Number(item.unitsPerBox);
            const unitsPerBox = Number.isInteger(savedUnitsPerBox) && savedUnitsPerBox > 0
                ? savedUnitsPerBox
                : productUnitsPerBox.get(String(item.productId)) || null;
            if (!productTotals.has(key)) {
                productTotals.set(key, {
                    name,
                    units: 0,
                    boxes: 0,
                    equivalentUnits: 0,
                    unconvertedBoxes: 0
                });
            }

            const totals = productTotals.get(key);
            totals.units += units;
            totals.boxes += boxes;
            totals.equivalentUnits += units + boxes * (unitsPerBox || 1);
            if (boxes && !unitsPerBox) totals.unconvertedBoxes += boxes;
        });
    });

    if (productTotals.size === 0) {
        container.innerHTML = '<p class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">No hay productos vendidos en este período.</p>';
        return;
    }

    const list = document.createElement("ol");
    list.className = "divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white";
    const sortedProducts = [...productTotals.values()]
        .sort((left, right) => right.equivalentUnits - left.equivalentUnits || left.name.localeCompare(right.name, "es"));
    sortedProducts.forEach((product, index) => {
        const row = document.createElement("li");
        row.className = "flex items-start gap-3 p-3";
        const rank = document.createElement("span");
        rank.className = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700";
        rank.textContent = String(index + 1);
        const details = document.createElement("div");
        details.className = "min-w-0 flex-1";
        const name = document.createElement("p");
        name.className = "break-words text-sm font-semibold text-slate-900";
        name.textContent = product.name;
        const quantity = document.createElement("p");
        quantity.className = "mt-1 text-xs text-slate-600";
        quantity.textContent = `${product.units} unidades · ${product.boxes} cajas · ${product.equivalentUnits} unidades equivalentes`;
        if (product.unconvertedBoxes) {
            quantity.title = "Las cajas sin equivalencia registrada cuentan como una presentación para el orden.";
        }
        details.append(name, quantity);
        row.append(rank, details);
        list.appendChild(row);
    });
    container.appendChild(list);
    if (sortedProducts.some(product => product.unconvertedBoxes > 0)) {
        const note = document.createElement("p");
        note.className = "mt-2 text-xs text-amber-700";
        note.textContent = "En facturas antiguas sin unidades por caja, cada caja cuenta como una presentación para ordenar.";
        container.appendChild(note);
    }
}
