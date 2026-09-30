// Convierte un PDF, EPUB o TXT en páginas de texto y las guarda en IndexedDB.

const LARGO_PAGINA = 2500;

export async function leerArchivo(archivo) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".pdf")) return leerPDF(archivo);
  if (nombre.endsWith(".epub")) return paginar(await leerEPUB(archivo));
  if (nombre.endsWith(".txt") || nombre.endsWith(".md")) return paginar([await archivo.text()]);
  throw new Error("Por ahora se pueden abrir archivos PDF, EPUB o TXT.");
}

async function leerPDF(archivo) {
  const pdfjs = await import("/vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;

  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const contenido = await (await doc.getPage(n)).getTextContent();
    const texto = contenido.items
      .map((item) => item.str + (item.hasEOL ? "\n" : ""))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (texto) paginas.push(texto);
  }
  if (!paginas.length) {
    throw new Error("Este PDF no tiene texto seleccionable (puede ser un escaneo). Probá con otra edición.");
  }
  return paginas;
}

async function leerEPUB(archivo) {
  if (!window.JSZip) await cargarScript("/vendor/jszip.js");
  const zip = await window.JSZip.loadAsync(archivo);
  const xml = (texto) => new DOMParser().parseFromString(texto, "application/xml");

  const contenedor = await zip.file("META-INF/container.xml")?.async("string");
  if (!contenedor) throw new Error("El EPUB no es válido.");
  const rutaOpf = xml(contenedor).querySelector("rootfile")?.getAttribute("full-path");
  const opf = xml(await zip.file(rutaOpf).async("string"));
  const base = rutaOpf.includes("/") ? rutaOpf.slice(0, rutaOpf.lastIndexOf("/") + 1) : "";

  const manifiesto = new Map();
  opf.querySelectorAll("manifest > item").forEach((item) => manifiesto.set(item.getAttribute("id"), item.getAttribute("href")));

  const capitulos = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const href = manifiesto.get(ref.getAttribute("idref"));
    const entrada = href && zip.file(base + decodeURIComponent(href.split("#")[0]));
    if (!entrada) continue;
    const html = new DOMParser().parseFromString(await entrada.async("string"), "text/html");
    const bloques = [...html.body.querySelectorAll("h1, h2, h3, h4, p, li, blockquote")]
      .map((b) => b.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const texto = bloques.length ? bloques.join("\n\n") : html.body.textContent.trim();
    if (texto) capitulos.push(texto);
  }
  if (!capitulos.length) throw new Error("No se encontró texto en este EPUB.");
  return capitulos;
}

function cargarScript(src) {
  return new Promise((resolver, rechazar) => {
    const s = Object.assign(document.createElement("script"), { src, onload: resolver, onerror: rechazar });
    document.head.append(s);
  });
}

// Corta cada capítulo en páginas de largo parecido, sin partir párrafos.
function paginar(capitulos) {
  const paginas = [];
  for (const capitulo of capitulos) {
    let actual = "";
    for (const parrafo of capitulo.split(/\n\s*\n/)) {
      if (actual && actual.length + parrafo.length > LARGO_PAGINA) {
        paginas.push(actual.trim());
        actual = "";
      }
      actual += parrafo.trim() + "\n\n";
    }
    if (actual.trim()) paginas.push(actual.trim());
  }
  return paginas;
}

/* ---------- Almacenamiento de textos (IndexedDB) ---------- */

const memoria = new Map();
let db;

function abrirDB() {
  db ??= new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open("lectura-reflexiva", 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore("textos");
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
  return db;
}

async function operacion(modo, accion) {
  const base = await abrirDB();
  return new Promise((resolver, rechazar) => {
    const pedido = accion(base.transaction("textos", modo).objectStore("textos"));
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

export async function guardarTexto(idLibro, datos) {
  memoria.set(idLibro, datos);
  try {
    await operacion("readwrite", (s) => s.put(datos, idLibro));
  } catch {
    // Sin IndexedDB el texto queda disponible solo durante esta sesión.
  }
}

export async function obtenerTexto(idLibro) {
  if (memoria.has(idLibro)) return memoria.get(idLibro);
  try {
    const datos = await operacion("readonly", (s) => s.get(idLibro));
    if (datos) memoria.set(idLibro, datos);
    return datos;
  } catch {
    return undefined;
  }
}

export async function borrarTexto(idLibro) {
  memoria.delete(idLibro);
  try {
    await operacion("readwrite", (s) => s.delete(idLibro));
  } catch {
    // Nada que borrar.
  }
}
