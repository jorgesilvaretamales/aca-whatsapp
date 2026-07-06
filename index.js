// ═══════════════════════════════════════════════════════════════
//  ACA CHILE — Servidor WhatsApp v2
// ═══════════════════════════════════════════════════════════════

const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors    = require('cors');
const qrcode  = require('qrcode');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'aca-chile-2025';

// IDs de los grupos ACA
const GRUPOS_ACA = {
  'grupo1': '120363164836037021@g.us',
  'grupo2': '120363045938690023@g.us',
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Auth middleware
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/qr') return next();
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (key !== API_KEY) return res.status(401).json({ error: 'No autorizado' });
  next();
});

// Estado global
let QR_DATA   = null;
let WA_READY  = false;
let WA_CLIENT = null;
let LOG_ACC   = [];

function log(msg) {
  const entry = { ts: new Date().toISOString(), msg };
  LOG_ACC.unshift(entry);
  if (LOG_ACC.length > 200) LOG_ACC.pop();
  console.log(`[${entry.ts}] ${msg}`);
}

// Normalizar número chileno → 569XXXXXXXX
function normalizarNumero(num) {
  // Solo limpiar dígitos — no agregar código de país
  // Los números en el Sheet ya tienen código de país sin el +
  let n = String(num).replace(/\D/g, '');
  return n;
}

function aWaId(num) {
  // Convertir número limpio a ID de WhatsApp (con @c.us)
  return normalizarNumero(num) + '@c.us';
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function delayAntiBan() {
  const ms = Math.floor(Math.random() * 4000) + 4000;
  return delay(ms);
}

// ── Inicializar WhatsApp ──────────────────────────────────────
function iniciarCliente() {
  WA_CLIENT = new Client({
    authStrategy: new LocalAuth({ clientId: 'aca-chile' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    }
  });

  WA_CLIENT.on('qr', async (qr) => {
    log('QR generado');
    QR_DATA  = await qrcode.toDataURL(qr);
    WA_READY = false;
  });

  WA_CLIENT.on('ready', () => {
    log('✓ WhatsApp conectado');
    WA_READY = true;
    QR_DATA  = null;
  });

  WA_CLIENT.on('auth_failure', () => { log('✗ Auth failure'); WA_READY = false; });

  WA_CLIENT.on('disconnected', (r) => {
    log('Desconectado: ' + r);
    WA_READY = false;
    setTimeout(iniciarCliente, 10000);
  });

  WA_CLIENT.initialize();
}

// ── ENDPOINTS ─────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true, conectado: WA_READY }));

app.get('/qr', (req, res) => {
  if (WA_READY) return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#1a1a1a;color:#c8a96e"><h2>✅ WhatsApp conectado</h2><a href="/estado?apikey=${API_KEY}" style="color:#c8a96e">Ver estado</a></body></html>`);
  if (!QR_DATA) return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#1a1a1a;color:#c8a96e"><h2>⏳ Generando QR...</h2><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
  res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial,sans-serif;text-align:center;padding:30px;background:#1a1a1a;color:#c8a96e;margin:0}img{border:4px solid #c8a96e;border-radius:12px;max-width:280px}.steps{background:#2a2a2a;border-radius:8px;padding:15px;margin:20px auto;max-width:320px;text-align:left;color:#ccc;font-size:.85rem}.steps li{margin:6px 0}</style></head><body><h1>🔥 ACA Chile — WhatsApp</h1><p>Escanea para vincular</p><img src="${QR_DATA}"><div class="steps"><ol><li>Abre WhatsApp</li><li>Dispositivos vinculados</li><li>Vincular un dispositivo</li><li>Escanea el QR</li></ol></div><script>setTimeout(()=>location.reload(),5000)</script></body></html>`);
});

app.get('/estado', (req, res) => res.json({ conectado: WA_READY, log: LOG_ACC.slice(0,30) }));

app.post('/cerrar-sesion', async (req, res) => {
  try { if (WA_CLIENT) await WA_CLIENT.logout(); WA_READY = false; QR_DATA = null; log('Sesión cerrada'); res.json({ ok: true }); }
  catch(e) { res.json({ error: e.message }); }
});

// Listar grupos
app.get('/grupos', async (req, res) => {
  if (!WA_READY) return res.json({ error: 'WhatsApp no conectado' });
  try {
    const chats  = await WA_CLIENT.getChats();
    const grupos = chats.filter(c => c.isGroup).map(c => ({
      id: c.id._serialized, nombre: c.name, miembros: c.participants?.length || 0
    }));
    res.json({ ok: true, grupos });
  } catch(e) { res.json({ error: e.message }); }
});

// Miembros de un grupo
app.get('/grupo/:id/miembros', async (req, res) => {
  if (!WA_READY) return res.json({ error: 'WhatsApp no conectado' });
  try {
    const chat = await WA_CLIENT.getChatById(req.params.id);
    if (!chat.isGroup) return res.json({ error: 'No es un grupo' });
    const miembros = chat.participants.map(p => ({
      numero: p.id.user, esAdmin: p.isAdmin
    }));
    res.json({ ok: true, nombre: chat.name, total: miembros.length, miembros });
  } catch(e) { res.json({ error: e.message }); }
});

// COMPARADOR: recibe lista de números, devuelve cuáles están/no están en el grupo
app.post('/grupo/:id/comparar', async (req, res) => {
  if (!WA_READY) return res.json({ error: 'WhatsApp no conectado' });
  const { numeros } = req.body;
  if (!numeros?.length) return res.json({ error: 'Sin números' });
  try {
    const chat = await WA_CLIENT.getChatById(req.params.id);
    if (!chat.isGroup) return res.json({ error: 'No es un grupo' });

    // Set de miembros actuales
    const enGrupo = new Set(chat.participants.map(p => p.id.user));

    const enElGrupo    = [];
    const fueraDelGrupo = [];
    const noReconocidos = []; // están en el grupo pero no en la lista dada

    // Números de la lista que están o no en el grupo
    numeros.forEach(num => {
      const n = normalizarNumero(num);
      if (enGrupo.has(n)) enElGrupo.push(n);
      else fueraDelGrupo.push(n);
    });

    // Miembros del grupo que NO están en la lista dada
    const numerosNorm = new Set(numeros.map(n => normalizarNumero(n)));
    chat.participants.forEach(p => {
      if (!numerosNorm.has(p.id.user)) noReconocidos.push(p.id.user);
    });

    res.json({
      ok: true,
      grupoNombre:   chat.name,
      totalGrupo:    chat.participants.length,
      enElGrupo,
      fueraDelGrupo,
      noReconocidos, // en el grupo pero no en tu lista
    });
  } catch(e) { res.json({ error: e.message }); }
});

// AGREGAR miembros (con anti-ban, con progreso via SSE)
app.post('/grupo/:id/agregar', async (req, res) => {
  if (!WA_READY) return res.json({ error: 'WhatsApp no conectado' });
  const { numeros } = req.body;
  if (!numeros?.length) return res.json({ error: 'Sin números' });
  try {
    const chat = await WA_CLIENT.getChatById(req.params.id);
    if (!chat.isGroup) return res.json({ error: 'No es un grupo' });
    const me  = WA_CLIENT.info.wid._serialized;
    const bot = chat.participants.find(p => p.id._serialized === me);
    if (!bot?.isAdmin) return res.json({ error: 'El bot no es administrador del grupo' });

    const resultados = [];
    for (let i = 0; i < numeros.length; i++) {
      const n  = normalizarNumero(numeros[i]);
      const id = aWaId(numeros[i]);
      try {
        await chat.addParticipants([id]);
        resultados.push({ numero: n, ok: true });
        log('➕ Agregado: ' + n);
      } catch(e) {
        resultados.push({ numero: n, ok: false, error: e.message });
        log('✗ Error agregando ' + n + ': ' + e.message);
      }
      if (i < numeros.length - 1) await delayAntiBan();
    }
    res.json({ ok: true, resultados });
  } catch(e) { res.json({ error: e.message }); }
});

// ELIMINAR miembros (con anti-ban)
app.post('/grupo/:id/eliminar', async (req, res) => {
  if (!WA_READY) return res.json({ error: 'WhatsApp no conectado' });
  const { numeros } = req.body;
  if (!numeros?.length) return res.json({ error: 'Sin números' });
  try {
    const chat = await WA_CLIENT.getChatById(req.params.id);
    if (!chat.isGroup) return res.json({ error: 'No es un grupo' });
    const me  = WA_CLIENT.info.wid._serialized;
    const bot = chat.participants.find(p => p.id._serialized === me);
    if (!bot?.isAdmin) return res.json({ error: 'El bot no es administrador del grupo' });

    const resultados = [];
    for (let i = 0; i < numeros.length; i++) {
      const n  = normalizarNumero(numeros[i]);
      const id = aWaId(numeros[i]);
      try {
        await chat.removeParticipants([id]);
        resultados.push({ numero: n, ok: true });
        log('➖ Eliminado: ' + n);
      } catch(e) {
        resultados.push({ numero: n, ok: false, error: e.message });
        log('✗ Error eliminando ' + n + ': ' + e.message);
      }
      if (i < numeros.length - 1) await delayAntiBan();
    }
    res.json({ ok: true, resultados });
  } catch(e) { res.json({ error: e.message }); }
});

// Log de actividad
app.get('/log', (req, res) => res.json({ log: LOG_ACC }));

app.listen(PORT, () => {
  log('Servidor ACA WhatsApp en puerto ' + PORT);
  iniciarCliente();
});
