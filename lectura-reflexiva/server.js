// Servidor de Lectura Reflexiva: sirve la interfaz y conversa con Claude.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MODEL = "claude-opus-5-5";

// Si Claude declina una solicitud, la API la reintenta con el modelo recomendado.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const client = new Anthropic();

const SYSTEM = `Sos un compañero de lectura cálido, curioso y profundo. Acompañás a una persona mientras lee un libro para que se conecte con el texto y consigo misma.

Cómo acompañás:
- Escribís en español, con un tono cercano y sereno. Sin sermones ni frases de autoayuda vacías.
- Partís siempre de lo que la persona leyó o escribió; citás sus palabras cuando ayuda.
- Hacés preguntas abiertas que invitan a mirar hacia adentro: emociones, recuerdos, decisiones, valores.
- Conectás ideas del libro con la vida cotidiana, sin imponer interpretaciones: ofrecés posibilidades.
- Si no conocés bien el libro, trabajás con el fragmento compartido y no inventás tramas ni citas.
- Las frases clave deben ser textuales del fragmento cuando existan; si proponés una frase propia, que sea breve y evocadora.
- Respetás el ritmo: respuestas breves, a lo sumo una o dos preguntas por turno en la conversación.`;

const REFLEXION_SCHEMA = {
  type: "object",
  properties: {
    frases_clave: {
      type: "array",
      description: "2 a 4 frases del fragmento (o muy cercanas a él) que condensan su sentido.",
      items: {
        type: "object",
        properties: {
          frase: { type: "string" },
          por_que: { type: "string", description: "Una línea sobre por qué esta frase importa." },
        },
        required: ["frase", "por_que"],
        additionalProperties: false,
      },
    },
    idea_central: { type: "string", description: "La idea del fragmento en una o dos oraciones." },
    preguntas: {
      type: "array",
      description: "3 preguntas reflexivas, de lo más cercano al texto a lo más personal.",
      items: { type: "string" },
    },
    conexion_personal: {
      type: "string",
      description: "Un párrafo breve que conecta el fragmento con la nota o la vida de la persona.",
    },
    frase_para_llevar: { type: "string", description: "Una frase corta para recordar durante el día." },
  },
  required: ["frases_clave", "idea_central", "preguntas", "conexion_personal", "frase_para_llevar"],
  additionalProperties: false,
};

function contextoLibro(libro) {
  const partes = [`Libro: "${libro?.titulo || "sin título"}"`];
  if (libro?.autor) partes.push(`Autor/a: ${libro.autor}`);
  if (libro?.intencion) partes.push(`Lo que la persona busca con esta lectura: ${libro.intencion}`);
  return partes.join("\n");
}

function recuerdos(libro) {
  const notas = (libro?.recuerdos || []).slice(-6);
  if (!notas.length) return "";
  return `\n\nReflexiones anteriores de la persona sobre este libro:\n${notas.map((n) => `- ${n}`).join("\n")}`;
}

// Una llamada a Claude cuya respuesta debe ajustarse a un esquema JSON.
async function pedirJSON(pedido, schema, effort = "medium") {
  const response = await client.beta.messages.create({
    ...FALLBACK,
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort, format: { type: "json_schema", schema } },
    system: SYSTEM,
    messages: [{ role: "user", content: pedido }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude prefirió no responder a esto. Probá con otro texto.");
  }
  const texto = response.content.find((b) => b.type === "text")?.text;
  if (!texto) throw new Error("La respuesta llegó vacía. Intentá de nuevo.");
  return JSON.parse(texto);
}

async function reflexionar({ libro, fragmento, nota }) {
  const pedido = `${contextoLibro(libro)}${recuerdos(libro)}

Fragmento que acabo de leer:
"""
${fragmento}
"""
${nota ? `\nLo que me despertó: ${nota}` : ""}

Ayudame a reflexionar sobre este fragmento.`;
  return pedirJSON(pedido, REFLEXION_SCHEMA);
}

const FRASE_DIA_SCHEMA = {
  type: "object",
  properties: {
    frase: { type: "string", description: "La frase del día: breve y evocadora." },
    origen: {
      type: "string",
      description: "De dónde sale: el libro (si es textual de lo que la persona guardó) o 'inspirada en <libro>'.",
    },
    reflexion: { type: "string", description: "Dos o tres oraciones que abren la frase hacia el día de hoy." },
    pregunta: { type: "string", description: "Una pregunta para llevar durante el día." },
  },
  required: ["frase", "origen", "reflexion", "pregunta"],
  additionalProperties: false,
};

async function fraseDelDia({ libros = [], fecha, excluir = [] }) {
  const resumenLibros = libros
    .slice(0, 8)
    .map((l) => {
      const frases = (l.frases || []).slice(0, 8).map((f) => `  · "${f}"`).join("\n");
      const notas = (l.recuerdos || []).slice(0, 3).map((n) => `  · ${n}`).join("\n");
      return `- "${l.titulo}"${l.autor ? ` de ${l.autor}` : ""}${l.intencion ? ` (busca: ${l.intencion})` : ""}${
        frases ? `\n  Frases guardadas:\n${frases}` : ""
      }${notas ? `\n  Notas recientes:\n${notas}` : ""}`;
    })
    .join("\n");

  const pedido = `Hoy es ${fecha || "hoy"}. Estos son los libros que estoy leyendo y lo que fui guardando:
${resumenLibros || "(todavía no agregué libros)"}
${excluir.length ? `\nNo repitas estas frases: ${excluir.map((f) => `"${f}"`).join(", ")}` : ""}

Elegí o inspirate en una frase para acompañarme hoy. Si hay frases guardadas, preferí una de ellas (textual) y conectala con lo que vengo escribiendo. Si no hay libros, proponé una frase de un clásico que conozcas bien, con su autor.`;
  return pedirJSON(pedido, FRASE_DIA_SCHEMA, "low");
}

const RESUMEN_SCHEMA = {
  type: "object",
  properties: {
    lo_que_te_dejo: { type: "string", description: "Un párrafo sobre lo que este libro le dejó a la persona." },
    temas: {
      type: "array",
      description: "2 a 4 temas que se repitieron en sus reflexiones.",
      items: {
        type: "object",
        properties: { tema: { type: "string" }, como_aparecio: { type: "string" } },
        required: ["tema", "como_aparecio"],
        additionalProperties: false,
      },
    },
    tu_recorrido: { type: "string", description: "Cómo fue cambiando la mirada de la persona a lo largo de la lectura." },
    frases_que_te_acompanan: {
      type: "array",
      description: "Hasta 3 frases (de las guardadas o del diario) que resumen la experiencia.",
      items: { type: "string" },
    },
    pregunta_para_seguir: { type: "string", description: "Una pregunta abierta para seguir pensando después del libro." },
    proxima_lectura: { type: "string", description: "Una sugerencia de lectura siguiente y por qué, en una o dos oraciones." },
  },
  required: ["lo_que_te_dejo", "temas", "tu_recorrido", "frases_que_te_acompanan", "pregunta_para_seguir", "proxima_lectura"],
  additionalProperties: false,
};

async function resumen({ libro, diario = [], frases = [], reflexiones = [] }) {
  const lista = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "(nada)");
  const pedido = `${contextoLibro(libro)}

Terminé de leer este libro. Esto es lo que fui guardando mientras leía, en orden cronológico.

Fragmentos sobre los que reflexioné (con su idea central):
${lista(reflexiones)}

Mi diario:
${lista(diario)}

Frases que guardé:
${lista(frases.map((f) => `"${f}"`))}

Ayudame a cerrar la lectura: qué me dejó, qué temas se repitieron en mí y cómo fue cambiando mi mirada. Basate en lo que escribí; no inventes cosas que no dije.`;
  return pedirJSON(pedido, RESUMEN_SCHEMA, "high");
}

async function conversar({ libro, mensajes }, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const enviar = (evento, datos) => res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);

  const stream = client.beta.messages.stream({
    ...FALLBACK,
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: `${SYSTEM}\n\n${contextoLibro(libro)}${recuerdos(libro)}`,
    messages: mensajes
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => ({ role: m.role, content: String(m.content) })),
  });

  stream.on("text", (delta) => enviar("texto", delta));
  res.on("close", () => stream.abort());

  try {
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      enviar("error", "Claude prefirió no seguir por este camino. Probá reformular.");
    }
    enviar("fin", {});
  } catch (err) {
    if (!res.writableEnded) enviar("error", mensajeDeError(err));
  }
  res.end();
}

function mensajeDeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Falta una API key válida (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "Demasiadas solicitudes seguidas. Esperá un momento.";
  if (err instanceof Anthropic.APIError) return `Error del servicio (${err.status}). Intentá de nuevo.`;
  if (!process.env.ANTHROPIC_API_KEY) return "Falta configurar ANTHROPIC_API_KEY en el servidor.";
  return err?.message || "Algo salió mal.";
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function leerJSON(req) {
  let cuerpo = "";
  for await (const trozo of req) {
    cuerpo += trozo;
    if (cuerpo.length > 2_000_000) throw new Error("El texto es demasiado largo.");
  }
  return JSON.parse(cuerpo || "{}");
}

// Librerías del navegador para leer PDF y EPUB, servidas desde node_modules.
const VENDOR = {
  "/vendor/pdf.mjs": "node_modules/pdfjs-dist/build/pdf.min.mjs",
  "/vendor/pdf.worker.mjs": "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "/vendor/jszip.js": "node_modules/jszip/dist/jszip.min.js",
};

const RUTAS_JSON = {
  "/api/reflexionar": (datos) => {
    if (!datos.fragmento?.trim()) throw new ErrorDeUso("Pegá un fragmento para reflexionar.");
    return reflexionar(datos);
  },
  "/api/frase-del-dia": fraseDelDia,
  "/api/resumen": (datos) => {
    if (!datos.diario?.length && !datos.frases?.length && !datos.reflexiones?.length) {
      throw new ErrorDeUso("Todavía no hay reflexiones de este libro para resumir.");
    }
    return resumen(datos);
  },
};

class ErrorDeUso extends Error {}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && RUTAS_JSON[url.pathname]) {
      const resultado = await RUTAS_JSON[url.pathname](await leerJSON(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(resultado));
    }
    if (req.method === "POST" && url.pathname === "/api/conversar") {
      return await conversar(await leerJSON(req), res);
    }
    if (req.method === "GET" && VENDOR[url.pathname]) {
      const ruta = path.join(here, VENDOR[url.pathname]);
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(ruta)], "Cache-Control": "max-age=86400" });
      return res.end(await readFile(ruta));
    }
    if (req.method === "GET") {
      const ruta = path.normalize(path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname));
      if (!ruta.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end();
      }
      const contenido = await readFile(ruta);
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(ruta)] || "application/octet-stream" });
      return res.end(contenido);
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404);
      return res.end("No encontrado");
    }
    if (err instanceof ErrorDeUso) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: mensajeDeError(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`📖 Lectura Reflexiva lista en http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("⚠️  ANTHROPIC_API_KEY no está definida: Claude no podrá responder.");
});
