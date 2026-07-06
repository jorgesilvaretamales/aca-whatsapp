# ACA Chile — Servidor WhatsApp

## Instalación local
```bash
npm install
node index.js
```
Luego abre http://localhost:3000/qr para vincular tu WhatsApp.

## Deploy en Railway
1. Sube este proyecto a GitHub
2. Conecta Railway con el repo
3. Agrega la variable de entorno: API_KEY=tu-clave-secreta
4. Deploy automático

## Endpoints
- GET  /health          → Estado del servidor
- GET  /qr              → Página para escanear QR
- GET  /grupos          → Lista tus grupos
- GET  /grupo/:id/miembros → Miembros de un grupo
- POST /grupo/:id/agregar  → Agregar números {numeros:[...]}
- POST /grupo/:id/eliminar → Eliminar números {numeros:[...]}
- POST /verificar          → Verificar si números tienen WA
- POST /cerrar-sesion      → Cerrar sesión
