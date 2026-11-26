// Configuracion publica e inicializacion del cliente Supabase.
const SUPABASE_URL = "https://qndywonxdblgnbsugubu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6cpZd1vU5RMeLVS4Z0V6zQ_IHm5yetr";
let supabaseClient = null;

async function loadSupabaseClient() {
    const scriptUrls = [
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
        "https://unpkg.com/@supabase/supabase-js@2"
    ];
    let lastError = null;

    for (const url of scriptUrls) {
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        try {
            await new Promise((resolve, reject) => {
                const timeoutId = window.setTimeout(
                    () => reject(new Error(`Se agotó el tiempo de espera al cargar ${url}.`)),
                    15000
                );
                script.onload = () => {
                    window.clearTimeout(timeoutId);
                    resolve();
                };
                script.onerror = () => {
                    window.clearTimeout(timeoutId);
                    reject(new Error(`No se pudo cargar ${url}.`));
                };
                document.head.appendChild(script);
            });
            if (typeof window.supabase?.createClient !== "function") {
                throw new Error("El SDK de Supabase no está disponible en esta dirección.");
            }
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            return;
        } catch (error) {
            script.remove();
            lastError = error;
        }
    }

    console.error("No se pudo cargar el SDK de Supabase desde los CDN:", lastError);
    throw new Error("No se pudo cargar la biblioteca de Supabase. Comprueba internet y vuelve a cargar la app.");
}
