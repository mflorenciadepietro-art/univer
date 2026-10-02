# 📖 Lectura Reflexiva

Una app para leer libros acompañada por Claude: te devuelve frases clave, preguntas reflexivas y conexiones con tu vida, para que te conectes con el libro y con vos.

## Qué hace

- **Frase del día**: al abrir la app, una frase (de las que guardaste o inspirada en tus libros) con una breve reflexión y una pregunta para llevar durante el día. Se renueva cada día y podés pedir otra.
- **Biblioteca**: guardás los libros que estás leyendo y, si querés, qué buscás en cada lectura.
- **Leer**: subís el libro en PDF, EPUB o TXT y lo leés en la app, que recuerda en qué página ibas. Al seleccionar un pasaje podés reflexionar con él o guardarlo como frase.
- **Reflexionar**: pegás un fragmento (y opcionalmente lo que te despertó) y recibís:
  - frases clave del pasaje y por qué importan,
  - la idea central,
  - tres preguntas que van del texto hacia vos (podés responderlas y quedan en tu diario),
  - una conexión con tu vida,
  - una frase para llevar durante el día.
- **Conversar**: un chat sobre el libro que responde en tiempo real y recuerda tus notas recientes.
- **Mi diario**: tus respuestas y reflexiones libres, por libro.
- **Mis frases**: las frases que guardaste.
- **Cierre**: cuando terminás el libro, Claude reúne tus reflexiones, tu diario y tus frases en un cierre: lo que el libro te dejó, los temas que se repitieron, cómo fue cambiando tu mirada, una pregunta para seguir y una sugerencia de próxima lectura.

Tus libros, diario y frases se guardan en tu navegador (`localStorage`) y los archivos de los libros en IndexedDB; el libro completo nunca se envía a Claude. Solo se envía lo necesario para cada función: el fragmento y tu nota, tus últimas entradas del diario, tus frases guardadas (para la frase del día) o todo lo que escribiste sobre un libro (para el cierre).

## Cómo usarla

Necesitás Node 18+ y una API key de Anthropic.

```bash
cd lectura-reflexiva
npm install
export ANTHROPIC_API_KEY=tu-api-key
npm start
```

Abrí <http://localhost:3000>.

## Cómo está hecha

- `server.js`: servidor Node sin framework que sirve `public/` y expone estas rutas:
  - `POST /api/reflexionar`: frases clave, preguntas y conexión para un fragmento (salida JSON estructurada).
  - `POST /api/frase-del-dia`: la frase del día a partir de tus libros y frases guardadas.
  - `POST /api/resumen`: el cierre de un libro a partir de todo lo que escribiste.
  - `POST /api/conversar`: conversación con respuesta en streaming (Server-Sent Events).
- `public/`: interfaz en HTML, CSS y JavaScript. `lector.js` convierte PDF (con pdf.js) y EPUB (con JSZip) en páginas de texto, dentro del navegador.

Usa el modelo `claude-opus-5-5` con el mecanismo de *fallback* por defecto de la API: si Claude declina una solicitud, se reintenta automáticamente con el modelo recomendado.

## Versión para claude.ai (sin instalar nada)

`claude-ai.html` es la misma app publicada como página de claude.ai. No necesita servidor ni API key: consulta a Claude con la cuenta de quien la abre y guarda los libros, el diario y las frases en un espacio privado de esa cuenta. Los archivos de los libros quedan en el dispositivo donde se subieron.
