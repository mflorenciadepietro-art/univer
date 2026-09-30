# 📖 Lectura Reflexiva

Una app para leer libros acompañada por Claude: te devuelve frases clave, preguntas reflexivas y conexiones con tu vida, para que te conectes con el libro y con vos.

## Qué hace

- **Biblioteca**: guardás los libros que estás leyendo y, si querés, qué buscás en cada lectura.
- **Reflexionar**: pegás un fragmento (y opcionalmente lo que te despertó) y recibís:
  - frases clave del pasaje y por qué importan,
  - la idea central,
  - tres preguntas que van del texto hacia vos (podés responderlas y quedan en tu diario),
  - una conexión con tu vida,
  - una frase para llevar durante el día.
- **Conversar**: un chat sobre el libro que responde en tiempo real y recuerda tus notas recientes.
- **Mi diario**: tus respuestas y reflexiones libres, por libro.
- **Mis frases**: las frases que guardaste.

Tus libros, diario y frases se guardan en tu navegador (`localStorage`); solo se envía a Claude el fragmento, tu nota y tus últimas entradas del diario de ese libro.

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

- `server.js`: servidor Node sin framework que sirve `public/` y expone dos rutas:
  - `POST /api/reflexionar`: una llamada a Claude con salida JSON estructurada (frases, preguntas, conexión).
  - `POST /api/conversar`: conversación con respuesta en streaming (Server-Sent Events).
- `public/`: interfaz en HTML, CSS y JavaScript sin dependencias.

Usa el modelo `claude-opus-5-5` con el mecanismo de *fallback* por defecto de la API: si Claude declina una solicitud, se reintenta automáticamente con el modelo recomendado.
