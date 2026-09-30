// Interfaz de Lectura Reflexiva. Todo se guarda en este navegador (localStorage e IndexedDB).
import { leerArchivo, guardarTexto, obtenerTexto, borrarTexto } from "./lector.js";

const CLAVE = "lectura-reflexiva:v1";
const $ = (sel, raiz = document) => raiz.querySelector(sel);

let estado = cargar();
let libroActual = null;

function cargar() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) || { libros: [] };
  } catch {
    return { libros: [] };
  }
}

function guardar() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    // Sin almacenamiento disponible: la sesión sigue funcionando en memoria.
  }
}

const id = () => Math.random().toString(36).slice(2, 10);
const fecha = (ms) => new Date(ms).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
const libro = () => estado.libros.find((l) => l.id === libroActual);
const hoy = () => new Date().toLocaleDateString("sv"); // AAAA-MM-DD en hora local

// Campos agregados después de la primera versión; se completan en libros viejos.
for (const l of estado.libros) {
  l.reflexiones ??= [];
  l.pagina ??= 0;
}

async function pedir(ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || "Algo salió mal. Intentá de nuevo.");
  return datos;
}

function el(tag, props = {}, ...hijos) {
  const nodo = Object.assign(document.createElement(tag), props);
  nodo.append(...hijos.filter((h) => h != null));
  return nodo;
}

// Lo que se manda a Claude como contexto del libro: datos básicos y el diario reciente.
function contexto(l) {
  return {
    titulo: l.titulo,
    autor: l.autor,
    intencion: l.intencion,
    recuerdos: l.diario.slice(0, 6).map((e) => (e.pregunta ? `${e.pregunta} → ${e.texto}` : e.texto)),
  };
}

/* ---------- Navegación ---------- */

function mostrarBiblioteca() {
  libroActual = null;
  $("#vista-libro").hidden = true;
  $("#vista-biblioteca").hidden = false;
  const lista = $("#lista-libros");
  lista.replaceChildren(
    ...estado.libros.map((l) =>
      el(
        "li",
        {},
        el(
          "button",
          { className: "libro", type: "button", onclick: () => abrirLibro(l.id) },
          el("strong", { textContent: l.titulo }),
          el("span", { textContent: l.autor || "" }),
          el("small", {
            textContent: `${l.resumen ? "✓ Terminado · " : ""}${l.diario.length} notas · ${l.frases.length} frases · desde ${fecha(l.creado)}`,
          }),
        ),
      ),
    ),
  );
  $("#biblioteca-vacia").hidden = estado.libros.length > 0;
  pintarFraseDelDia();
}

function abrirLibro(idLibro) {
  libroActual = idLibro;
  const l = libro();
  $("#vista-biblioteca").hidden = true;
  $("#vista-libro").hidden = false;
  $("#libro-titulo").textContent = l.titulo;
  $("#libro-autor").textContent = l.autor || "";
  $("#libro-intencion").textContent = l.intencion ? `Busco: ${l.intencion}` : "";
  $("#resultado").replaceChildren();
  cambiarPestana("leer");
  pintarLector();
  pintarCierre();
  pintarChat();
  pintarDiario();
  pintarFrases();
}

function cambiarPestana(nombre) {
  document.querySelectorAll("[data-pestana]").forEach((b) => b.setAttribute("aria-selected", b.dataset.pestana === nombre));
  document.querySelectorAll(".pestana").forEach((p) => (p.hidden = p.id !== `pestana-${nombre}`));
  actualizarSeleccion();
}

/* ---------- Biblioteca ---------- */

$("#form-libro").addEventListener("submit", (e) => {
  e.preventDefault();
  const datos = new FormData(e.target);
  const nuevo = {
    id: id(),
    titulo: datos.get("titulo").trim(),
    autor: datos.get("autor").trim(),
    intencion: datos.get("intencion").trim(),
    creado: Date.now(),
    diario: [],
    frases: [],
    chat: [],
    reflexiones: [],
    pagina: 0,
  };
  estado.libros.unshift(nuevo);
  guardar();
  e.target.reset();
  abrirLibro(nuevo.id);
});

/* ---------- Reflexionar ---------- */

$("#form-fragmento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const datos = new FormData(form);
  const fragmento = datos.get("fragmento").trim();
  const boton = $("button", form);
  const resultado = $("#resultado");

  boton.disabled = true;
  resultado.replaceChildren(el("p", { className: "pensando", textContent: "Leyendo con calma tu fragmento…" }));

  try {
    const l = libro();
    const cuerpo = await pedir("/api/reflexionar", { libro: contexto(l), fragmento, nota: datos.get("nota").trim() });
    l.reflexiones.push({ fragmento: fragmento.slice(0, 400), idea: cuerpo.idea_central, creado: Date.now() });
    guardar();
    resultado.replaceChildren(pintarReflexion(cuerpo, fragmento));
  } catch (err) {
    resultado.replaceChildren(el("p", { className: "error", textContent: err.message }));
  } finally {
    boton.disabled = false;
  }
});

function pintarReflexion(r, fragmento) {
  const nodo = $("#tpl-reflexion").content.cloneNode(true);

  $(".frases-clave", nodo).append(
    ...r.frases_clave.map((f) =>
      el(
        "li",
        {},
        el("q", { textContent: f.frase }),
        el("p", { textContent: f.por_que }),
        botonGuardarFrase(f.frase),
      ),
    ),
  );
  $(".idea", nodo).textContent = r.idea_central;
  $(".preguntas", nodo).append(...r.preguntas.map((p) => el("li", {}, el("p", { textContent: p }), formRespuesta(p, fragmento))));
  $(".conexion", nodo).textContent = r.conexion_personal;
  $(".para-llevar", nodo).append(el("span", { textContent: r.frase_para_llevar }), botonGuardarFrase(r.frase_para_llevar));
  return nodo;
}

function botonGuardarFrase(frase) {
  const ya = () => libro().frases.some((f) => f.texto === frase);
  const boton = el("button", { type: "button", className: "enlace" });
  const actualizar = () => {
    boton.textContent = ya() ? "✓ Guardada" : "☆ Guardar frase";
    boton.disabled = ya();
  };
  boton.onclick = () => {
    guardarFrase(frase);
    actualizar();
  };
  actualizar();
  return boton;
}

function guardarFrase(frase) {
  const l = libro();
  if (l.frases.some((f) => f.texto === frase)) return;
  l.frases.unshift({ id: id(), texto: frase, creado: Date.now() });
  guardar();
  pintarFrases();
}

function formRespuesta(pregunta, fragmento) {
  const area = el("textarea", { rows: 2, required: true, placeholder: "Tu respuesta, sin apuro…" });
  const form = el("form", { className: "respuesta" }, area, el("button", { type: "submit", textContent: "Guardar en mi diario" }));
  form.onsubmit = (e) => {
    e.preventDefault();
    libro().diario.unshift({ id: id(), pregunta, fragmento, texto: area.value.trim(), creado: Date.now() });
    guardar();
    pintarDiario();
    form.replaceChildren(el("p", { className: "guardado", textContent: `“${area.value.trim()}” — guardado en tu diario.` }));
  };
  return form;
}

/* ---------- Conversar ---------- */

function pintarChat() {
  const chat = $("#chat");
  const mensajes = libro().chat;
  if (!mensajes.length) {
    chat.replaceChildren(
      el("p", {
        className: "vacio",
        textContent: "Podés contar qué te está pasando con el libro, una escena que no te suelta o una pregunta que te dejó.",
      }),
    );
    return;
  }
  chat.replaceChildren(...mensajes.map((m) => burbuja(m.role, m.content)));
  chat.scrollTop = chat.scrollHeight;
}

function burbuja(rol, texto) {
  return el("div", { className: `burbuja ${rol}`, textContent: texto });
}

$("#form-chat").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const area = form.elements.mensaje;
  const texto = area.value.trim();
  if (!texto) return;

  const l = libro();
  l.chat.push({ role: "user", content: texto });
  guardar();
  area.value = "";
  pintarChat();

  const chat = $("#chat");
  const respuesta = burbuja("assistant", "…");
  chat.append(respuesta);
  const boton = $("button", form);
  boton.disabled = true;

  let acumulado = "";
  try {
    const r = await fetch("/api/conversar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libro: contexto(l), mensajes: l.chat }),
    });
    if (!r.ok || !r.body) throw new Error("No se pudo conectar con tu compañero de lectura.");

    const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      buffer += value;
      const eventos = buffer.split("\n\n");
      buffer = eventos.pop();
      for (const bruto of eventos) {
        const tipo = /^event: (.*)$/m.exec(bruto)?.[1];
        const datos = /^data: (.*)$/m.exec(bruto)?.[1];
        if (tipo === "texto") {
          acumulado += JSON.parse(datos);
          respuesta.textContent = acumulado;
          chat.scrollTop = chat.scrollHeight;
        } else if (tipo === "error") {
          throw new Error(JSON.parse(datos));
        }
      }
    }
    if (acumulado) {
      l.chat.push({ role: "assistant", content: acumulado });
      guardar();
    }
  } catch (err) {
    // Se descarta el último mensaje para que la conversación no quede con dos turnos seguidos del usuario.
    if (!acumulado) l.chat.pop();
    guardar();
    respuesta.replaceWith(el("p", { className: "error", textContent: err.message }));
  } finally {
    boton.disabled = false;
  }
});

$("#borrar-chat").addEventListener("click", () => {
  if (!confirm("¿Empezar una conversación nueva? La actual se borrará.")) return;
  libro().chat = [];
  guardar();
  pintarChat();
});

/* ---------- Diario y frases ---------- */

$("#form-diario").addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = e.target.elements.texto.value.trim();
  if (!texto) return;
  libro().diario.unshift({ id: id(), texto, creado: Date.now() });
  guardar();
  e.target.reset();
  pintarDiario();
});

function borrarDe(lista, idItem, pintar) {
  return el("button", {
    type: "button",
    className: "enlace borrar",
    textContent: "Borrar",
    onclick: () => {
      const l = libro();
      l[lista] = l[lista].filter((x) => x.id !== idItem);
      guardar();
      pintar();
    },
  });
}

function pintarDiario() {
  const entradas = libro().diario;
  $("#lista-diario").replaceChildren(
    ...(entradas.length
      ? entradas.map((e) =>
          el(
            "li",
            {},
            el("small", { textContent: fecha(e.creado) }),
            e.pregunta ? el("p", { className: "pregunta", textContent: e.pregunta }) : null,
            el("p", { textContent: e.texto }),
            borrarDe("diario", e.id, pintarDiario),
          ),
        )
      : [el("li", { className: "vacio", textContent: "Tu diario está esperando. Respondé una pregunta o escribí libremente." })]),
  );
}

function pintarFrases() {
  const frases = libro().frases;
  $("#lista-frases").replaceChildren(
    ...(frases.length
      ? frases.map((f) => el("li", {}, el("q", { textContent: f.texto }), borrarDe("frases", f.id, pintarFrases)))
      : [el("li", { className: "vacio", textContent: "Guardá las frases que quieras recordar desde “Reflexionar”." })]),
  );
}

/* ---------- Leer el libro ---------- */

let paginas = null;

async function pintarLector() {
  const idLibro = libroActual;
  const datos = await obtenerTexto(idLibro);
  if (idLibro !== libroActual) return;
  paginas = datos?.paginas ?? null;
  $("#subir").hidden = !!paginas;
  $("#lector").hidden = !paginas;
  $("#estado-archivo").hidden = true;
  if (paginas) mostrarPagina(libro().pagina);
}

function mostrarPagina(n) {
  const l = libro();
  l.pagina = Math.max(0, Math.min(n, paginas.length - 1));
  guardar();
  $("#lector-texto").replaceChildren(
    ...paginas[l.pagina].split(/\n\s*\n/).map((p) => el("p", { textContent: p.trim() })),
  );
  $("#pagina-num").textContent = `Página ${l.pagina + 1} de ${paginas.length}`;
  for (const sufijo of ["", "-2"]) {
    $(`#pagina-anterior${sufijo}`).disabled = l.pagina === 0;
    $(`#pagina-siguiente${sufijo}`).disabled = l.pagina === paginas.length - 1;
  }
}

function pasarPagina(delta) {
  mostrarPagina(libro().pagina + delta);
  $("#lector").scrollIntoView({ block: "start" });
}

$("#pagina-anterior").onclick = $("#pagina-anterior-2").onclick = () => pasarPagina(-1);
$("#pagina-siguiente").onclick = $("#pagina-siguiente-2").onclick = () => pasarPagina(1);

document.addEventListener("keydown", (e) => {
  if ($("#pestana-leer").hidden || $("#vista-libro").hidden || !paginas || e.target.closest("input, textarea")) return;
  if (e.key === "ArrowRight") pasarPagina(1);
  if (e.key === "ArrowLeft") pasarPagina(-1);
});

$("#input-archivo").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const idLibro = libroActual;
  const aviso = $("#estado-archivo");
  aviso.hidden = false;
  aviso.className = "vacio";
  aviso.textContent = "Abriendo el libro…";
  try {
    const nuevas = await leerArchivo(archivo);
    await guardarTexto(idLibro, { nombre: archivo.name, paginas: nuevas });
    const l = estado.libros.find((x) => x.id === idLibro);
    l.pagina = 0;
    guardar();
    if (idLibro === libroActual) pintarLector();
  } catch (err) {
    aviso.className = "error";
    aviso.textContent = err.message || "No se pudo abrir el archivo.";
  } finally {
    e.target.value = "";
  }
});

$("#cambiar-archivo").addEventListener("click", async () => {
  if (!confirm("¿Quitar el archivo de este libro? Tus notas y frases se conservan.")) return;
  await borrarTexto(libroActual);
  pintarLector();
});

// Al seleccionar texto del libro aparece una barra para reflexionar o guardar la frase.
function textoSeleccionado() {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !$("#lector-texto").contains(sel.anchorNode)) return "";
  return sel.toString().replace(/\s+/g, " ").trim();
}

function actualizarSeleccion() {
  $("#barra-seleccion").hidden = !textoSeleccionado() || $("#pestana-leer").hidden;
}

document.addEventListener("selectionchange", actualizarSeleccion);

$("#sel-reflexionar").addEventListener("click", () => {
  const texto = textoSeleccionado();
  if (!texto) return;
  const form = $("#form-fragmento");
  form.elements.fragmento.value = texto;
  form.elements.nota.value = "";
  $("#resultado").replaceChildren();
  document.getSelection().removeAllRanges();
  cambiarPestana("reflexionar");
  form.elements.nota.focus();
});

$("#sel-guardar").addEventListener("click", () => {
  const texto = textoSeleccionado();
  if (!texto) return;
  guardarFrase(texto);
  document.getSelection().removeAllRanges();
  actualizarSeleccion();
  avisar("Frase guardada ✓");
});

function avisar(texto) {
  const nodo = el("div", { className: "aviso", textContent: texto, role: "status" });
  document.body.append(nodo);
  setTimeout(() => nodo.remove(), 1800);
}

/* ---------- Frase del día ---------- */

let pidiendoFrase = false;

async function pintarFraseDelDia(otra = false) {
  const caja = $("#frase-dia");
  const guardada = estado.fraseDelDia;

  if (guardada?.fecha === hoy() && !otra) {
    const f = guardada.datos;
    caja.replaceChildren(
      el("small", { textContent: "Frase del día" }),
      el("blockquote", { textContent: f.frase }),
      el("p", { className: "origen", textContent: f.origen }),
      el("p", { textContent: f.reflexion }),
      el("p", { className: "pregunta", textContent: f.pregunta }),
      el("button", { type: "button", className: "enlace", textContent: "Otra frase", onclick: () => pintarFraseDelDia(true) }),
    );
    return;
  }
  if (pidiendoFrase) return;

  pidiendoFrase = true;
  caja.replaceChildren(el("p", { className: "pensando", textContent: "Buscando una frase para hoy…" }));
  try {
    const datos = await pedir("/api/frase-del-dia", {
      fecha: new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
      libros: estado.libros.map((l) => ({ ...contexto(l), frases: l.frases.map((f) => f.texto) })),
      excluir: otra && guardada ? [guardada.datos.frase] : [],
    });
    estado.fraseDelDia = { fecha: hoy(), datos };
    guardar();
    pidiendoFrase = false;
    pintarFraseDelDia();
  } catch (err) {
    pidiendoFrase = false;
    caja.replaceChildren(
      el("p", { className: "vacio", textContent: `No pude traer la frase del día: ${err.message}` }),
      el("button", { type: "button", className: "enlace", textContent: "Intentar de nuevo", onclick: () => pintarFraseDelDia(otra) }),
    );
  }
}

/* ---------- Cierre del libro ---------- */

function pintarCierre() {
  const l = libro();
  $("#generar-cierre").textContent = l.resumen ? "Volver a generar mi cierre" : "Terminé el libro: generar mi cierre";
  $("#cierre").replaceChildren(l.resumen ? vistaCierre(l.resumen) : "");
}

function vistaCierre(r) {
  return el(
    "article",
    { className: "reflexion" },
    el("section", { className: "bloque" }, el("h3", { textContent: "Lo que este libro te dejó" }), el("p", { textContent: r.lo_que_te_dejo })),
    el(
      "section",
      { className: "bloque" },
      el("h3", { textContent: "Temas que se repitieron en vos" }),
      el("ul", { className: "temas" }, ...r.temas.map((t) => el("li", {}, el("strong", { textContent: t.tema }), el("p", { textContent: t.como_aparecio })))),
    ),
    el("section", { className: "bloque" }, el("h3", { textContent: "Tu recorrido" }), el("p", { textContent: r.tu_recorrido })),
    el(
      "section",
      { className: "bloque" },
      el("h3", { textContent: "Frases que te acompañan" }),
      el("ul", { className: "frases-clave" }, ...r.frases_que_te_acompanan.map((f) => el("li", {}, el("q", { textContent: f })))),
    ),
    el("blockquote", { className: "para-llevar" }, el("span", { textContent: r.pregunta_para_seguir })),
    el("section", { className: "bloque" }, el("h3", { textContent: "Para tu próxima lectura" }), el("p", { textContent: r.proxima_lectura })),
  );
}

$("#generar-cierre").addEventListener("click", async (e) => {
  const boton = e.currentTarget;
  const l = libro();
  boton.disabled = true;
  $("#cierre").replaceChildren(el("p", { className: "pensando", textContent: "Releyendo todo lo que fuiste escribiendo…" }));
  try {
    const orden = (a, b) => a.creado - b.creado;
    l.resumen = await pedir("/api/resumen", {
      libro: contexto(l),
      reflexiones: [...l.reflexiones].sort(orden).map((r) => `"${r.fragmento}" → ${r.idea}`),
      diario: [...l.diario].sort(orden).map((d) => (d.pregunta ? `${d.pregunta} → ${d.texto}` : d.texto)),
      frases: [...l.frases].sort(orden).map((f) => f.texto),
    });
    guardar();
    pintarCierre();
  } catch (err) {
    $("#cierre").replaceChildren(el("p", { className: "error", textContent: err.message }));
  } finally {
    boton.disabled = false;
  }
});

/* ---------- Arranque ---------- */

document.querySelectorAll("[data-pestana]").forEach((b) => b.addEventListener("click", () => cambiarPestana(b.dataset.pestana)));
$("#volver").addEventListener("click", mostrarBiblioteca);
$("#ir-inicio").addEventListener("click", mostrarBiblioteca);
mostrarBiblioteca();
