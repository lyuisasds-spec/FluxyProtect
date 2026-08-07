require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// VARIABLES DE ENTORNO
// ============================================
const MONGODB_URI = process.env.MONGODB_URI;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'clave-segura-cambiala';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

console.log('🚀 Iniciando FluxyProtect...');

// ============================================
// CONEXION A MONGODB
// ============================================
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error MongoDB:', err.message));

// ============================================
// MODELOS
// ============================================
const UserSchema = new mongoose.Schema({
    discordId: { type: String, unique: true },
    username: String,
    avatar: String,
    plan: { type: String, default: 'basic' },
    obfuscationsUsed: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const ScriptSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    rawCode: { type: String },
    status: { type: String, default: 'active' },
    ffaMode: { type: Boolean, default: false },
    compressMode: { type: Boolean, default: false },
    scriptKey: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Script = mongoose.model('Script', ScriptSchema);

const PanelSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    channelId: { type: String, required: true },
    scriptId: { type: String, required: true },
    hwidCooldown: { type: Number, default: 0 },
    panelKey: { type: String, unique: true },
    pendingSend: { type: Boolean, default: false },
    sentToDiscord: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Panel = mongoose.model('Panel', PanelSchema);

const KeySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    panelId: { type: String, required: true },
    key: { type: String, unique: true, required: true },
    note: { type: String, default: '' },
    duration: { type: String, default: 'permanent' },
    expiresAt: { type: Date, default: null },
    used: { type: Boolean, default: false },
    usedBy: { type: String, default: null },
    usedAt: { type: Date, default: null },
    hwid: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const Key = mongoose.model('Key', KeySchema);

const HwidBanSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    hwid: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now }
});
const HwidBan = mongoose.model('HwidBan', HwidBanSchema);

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

const MongoStore = require('connect-mongodb-session')(session);
const store = new MongoStore({
    uri: MONGODB_URI,
    collection: 'sessions',
    touchAfter: 24 * 3600
});

app.use(session({
    secret: SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    store: store,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        httpOnly: true
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// ============================================
// ESTRATEGIA DE DISCORD
// ============================================
passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: `${FRONTEND_URL}/api/auth/discord/callback`,
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('👤 Usuario Discord:', profile.username);
        let user = await User.findOne({ discordId: profile.id });
        if (!user) {
            user = new User({
                discordId: profile.id,
                username: profile.username,
                avatar: profile.avatar
            });
            await user.save();
            console.log('✅ Nuevo usuario guardado');
        }
        return done(null, {
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar,
            plan: user.plan
        });
    } catch (err) {
        console.error('❌ Error:', err);
        return done(err, null);
    }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ============================================
// MIDDLEWARE DE AUTENTICACION
// ============================================
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
};

// ============================================
// RUTAS DE AUTENTICACION
// ============================================
app.get('/api/auth/discord', passport.authenticate('discord'));

app.get('/api/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        const user = req.user;
        if (user) {
            req.session.save((err) => {
                if (err) console.error('❌ Error guardando sesion:', err);
                res.redirect(`/?user=${encodeURIComponent(user.username)}&id=${user.id}&avatar=${user.avatar || '0'}`);
            });
        } else {
            res.redirect('/');
        }
    }
);

app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error(err);
        res.redirect('/');
    });
});

app.get('/api/check-session', (req, res) => {
    res.json({
        hasUser: !!req.user,
        user: req.user ? req.user.username : null,
        sessionID: req.sessionID
    });
});

// ============================================
// RUTAS DE DATOS
// ============================================
app.get('/api/data', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findOne({ discordId: userId });
        const scripts = await Script.find({ userId });
        const panels = await Panel.find({ userId });
        const keys = await Key.find({ userId });
        const bannedHWIDs = await HwidBan.find({ userId });

        const scriptsFormatted = scripts.map(s => ({
            ...s.toObject(),
            id: s._id.toString()
        }));
        const panelsFormatted = panels.map(p => ({
            ...p.toObject(),
            id: p._id.toString()
        }));
        const keysFormatted = keys.map(k => ({
            ...k.toObject(),
            id: k._id.toString()
        }));

        res.json({
            scripts: scriptsFormatted,
            panels: panelsFormatted,
            keys: keysFormatted,
            bannedHWIDs: bannedHWIDs.map(b => b.hwid) || [],
            obfuscationsLeft: user ? 10 - user.obfuscationsUsed : 10,
            maxObfuscations: user?.plan === 'premium' ? Infinity : 10,
            plan: user?.plan || 'basic',
            serverTime: Date.now(),
            apiKey: null,
            apiKeyExpiry: null
        });
    } catch (err) {
        console.error('Error en /api/data:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ============================================
// RUTAS DE SCRIPTS
// ============================================
function generateScriptKey() {
    return Math.random().toString(36).substring(2, 10).toUpperCase() + 
           Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.post('/api/create-script', requireAuth, async (req, res) => {
    try {
        const { name, code, compressMode, ffaMode } = req.body;
        const userId = req.user.id;

        if (!name || !code) {
            return res.status(400).json({ error: 'Nombre y codigo son requeridos' });
        }

        const scriptKey = generateScriptKey();
        
        const script = new Script({
            userId,
            name,
            code,
            rawCode: code,
            compressMode: compressMode || false,
            ffaMode: ffaMode || false,
            scriptKey: scriptKey
        });

        await script.save();

        await User.findOneAndUpdate(
            { discordId: userId },
            { $inc: { obfuscationsUsed: 1 } }
        );

        res.json({ 
            success: true, 
            script: {
                ...script.toObject(),
                id: script._id.toString()
            }
        });
    } catch (err) {
        console.error('Error creando script:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/update-script', requireAuth, async (req, res) => {
    try {
        const { id, name, code, compressMode, ffaMode } = req.body;
        const userId = req.user.id;

        const script = await Script.findOne({ _id: id, userId });
        if (!script) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

        script.name = name || script.name;
        script.code = code || script.code;
        script.compressMode = compressMode !== undefined ? compressMode : script.compressMode;
        script.ffaMode = ffaMode !== undefined ? ffaMode : script.ffaMode;
        script.updatedAt = new Date();

        await script.save();
        res.json({ 
            success: true, 
            script: {
                ...script.toObject(),
                id: script._id.toString()
            }
        });
    } catch (err) {
        console.error('Error actualizando script:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/toggle-script/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const script = await Script.findOne({ _id: id, userId });
        if (!script) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

        script.status = script.status === 'active' ? 'disabled' : 'active';
        await script.save();

        res.json({ 
            success: true, 
            script: {
                ...script.toObject(),
                id: script._id.toString()
            }
        });
    } catch (err) {
        console.error('Error toggling script:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/toggle-ffa/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const script = await Script.findOne({ _id: id, userId });
        if (!script) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

        script.ffaMode = !script.ffaMode;
        await script.save();

        res.json({ 
            success: true, 
            script: {
                ...script.toObject(),
                id: script._id.toString()
            }
        });
    } catch (err) {
        console.error('Error toggling FFA:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/delete-script/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await Script.findOneAndDelete({ _id: id, userId });
        if (!result) {
            return res.status(404).json({ error: 'Script no encontrado' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error eliminando script:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/loader/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const script = await Script.findOne({ _id: id });
        
        if (!script || script.status === 'disabled') {
            return res.status(404).send('-- Script no disponible');
        }

        if (script.ffaMode) {
            res.setHeader('Content-Type', 'text/plain');
            return res.send(script.rawCode || script.code);
        }

        const loaderTemplate = `
--[[ PROTECTED BY FLUXYPROTECT ]]
-- Este script requiere una key valida
local FluxyProtect = {
    _key = nil,
    _scriptId = "${script._id.toString()}",
    _scriptKey = "${script.scriptKey}",
    _validated = false
}

function FluxyProtect:validateKey(key)
    if not key or key == "" then
        return false, "Key no proporcionada"
    end
    if key == self._scriptKey then
        self._validated = true
        return true, "Key valida"
    end
    return false, "Key invalida"
end

function FluxyProtect:execute(key)
    local valid, msg = self:validateKey(key)
    if not valid then
        game:GetService("StarterGui"):SetCore("SendNotification", {
            Title = "FluxyProtect",
            Text = "Key invalida",
            Duration = 5
        })
        return
    end
    local scriptContent = game:HttpGet("${FRONTEND_URL}/api/script-content/${script._id.toString()}")
    loadstring(scriptContent)()
end

print("Script protegido por FluxyProtect")
print("Usa: FluxyProtect:execute('TU_KEY')")
`;
        res.setHeader('Content-Type', 'text/plain');
        res.send(loaderTemplate);
        
    } catch (err) {
        console.error('Error en loader:', err);
        res.status(500).send('-- Error cargando script');
    }
});

app.get('/api/script-content/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const script = await Script.findOne({ _id: id });
        
        if (!script || script.status === 'disabled') {
            return res.status(404).send('-- Script no disponible');
        }

        res.setHeader('Content-Type', 'text/plain');
        res.send(script.rawCode || script.code);
        
    } catch (err) {
        console.error('Error en script-content:', err);
        res.status(500).send('-- Error cargando script');
    }
});

// ============================================
// RUTAS DE PANELS
// ============================================
function generatePanelKey() {
    return 'FP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.post('/api/create-panel', requireAuth, async (req, res) => {
    try {
        const { name, description, channelId, scriptId, hwidCooldown } = req.body;
        const userId = req.user.id;

        if (!name || !channelId || !scriptId) {
            return res.status(400).json({ error: 'Nombre, channelId y scriptId son requeridos' });
        }

        const panelKey = generatePanelKey();

        const panel = new Panel({
            userId,
            name,
            description: description || '',
            channelId,
            scriptId,
            hwidCooldown: Number(hwidCooldown) || 0,
            panelKey: panelKey,
            pendingSend: true
        });

        await panel.save();
        res.json({ 
            success: true, 
            panel: {
                ...panel.toObject(),
                id: panel._id.toString()
            },
            message: 'Panel creado. El bot lo enviara a Discord automaticamente.'
        });
    } catch (err) {
        console.error('Error creando panel:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/update-panel', requireAuth, async (req, res) => {
    try {
        const { id, name, description, channelId, scriptId, hwidCooldown } = req.body;
        const userId = req.user.id;

        const panel = await Panel.findOne({ _id: id, userId });
        if (!panel) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }

        panel.name = name || panel.name;
        panel.description = description !== undefined ? description : panel.description;
        panel.channelId = channelId || panel.channelId;
        panel.scriptId = scriptId || panel.scriptId;
        panel.hwidCooldown = hwidCooldown !== undefined ? Number(hwidCooldown) : panel.hwidCooldown;
        panel.pendingSend = true;
        panel.sentToDiscord = false;

        await panel.save();
        res.json({ 
            success: true, 
            panel: {
                ...panel.toObject(),
                id: panel._id.toString()
            }
        });
    } catch (err) {
        console.error('Error actualizando panel:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/delete-panel/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await Panel.findOneAndDelete({ _id: id, userId });
        if (!result) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }

        await Key.deleteMany({ panelId: id, userId });

        res.json({ success: true });
    } catch (err) {
        console.error('Error eliminando panel:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTA PARA ENVIAR PANEL - VERSION CORREGIDA
// ============================================
app.post('/api/send-panel/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const panel = await Panel.findOne({ _id: id, userId });
        if (!panel) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }

        // Marcar panel como pendiente de envio
        panel.pendingSend = true;
        panel.sentToDiscord = false;
        await panel.save();

        res.json({ 
            success: true, 
            message: 'Panel marcado para enviar a Discord. El bot lo enviara en los proximos segundos.',
            panelKey: panel.panelKey,
            panelName: panel.name
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTAS DE KEYS
// ============================================
function generateKey() {
    return Math.random().toString(36).substring(2, 10).toUpperCase() + 
           Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.post('/api/generate-key', requireAuth, async (req, res) => {
    try {
        const { panelId, duration, note } = req.body;
        const userId = req.user.id;

        if (!panelId) {
            return res.status(400).json({ error: 'panelId es requerido' });
        }

        const panel = await Panel.findOne({ _id: panelId, userId });
        if (!panel) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }

        const key = generateKey();

        let expiresAt = null;
        if (duration && duration !== 'permanent') {
            const now = new Date();
            const durationMap = {
                '1h': 1 * 60 * 60 * 1000,
                '1d': 24 * 60 * 60 * 1000,
                '1w': 7 * 24 * 60 * 60 * 1000,
                '1m': 30 * 24 * 60 * 60 * 1000,
                '1y': 365 * 24 * 60 * 60 * 1000
            };
            expiresAt = new Date(now.getTime() + (durationMap[duration] || 0));
        }

        const newKey = new Key({
            userId,
            panelId: panel._id.toString(),
            key,
            note: note || '',
            duration: duration || 'permanent',
            expiresAt
        });

        await newKey.save();
        res.json({ 
            success: true, 
            key: {
                ...newKey.toObject(),
                id: newKey._id.toString()
            }
        });
    } catch (err) {
        console.error('Error generando key:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/delete-key/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        let result = await Key.findOneAndDelete({ _id: id, userId });
        if (!result) {
            result = await Key.findOneAndDelete({ key: id, userId });
            if (!result) {
                return res.status(404).json({ error: 'Key no encontrada' });
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error eliminando key:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTAS DE HWID
// ============================================
app.post('/api/ban-hwid', requireAuth, async (req, res) => {
    try {
        const { hwid } = req.body;
        const userId = req.user.id;

        if (!hwid) {
            return res.status(400).json({ error: 'HWID es requerido' });
        }

        const existing = await HwidBan.findOne({ hwid });
        if (existing) {
            return res.status(400).json({ error: 'HWID ya esta baneado' });
        }

        const ban = new HwidBan({ userId, hwid });
        await ban.save();

        res.json({ success: true, ban });
    } catch (err) {
        console.error('Error baneando HWID:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/unban-hwid/:hwid', requireAuth, async (req, res) => {
    try {
        const { hwid } = req.params;
        const userId = req.user.id;

        const result = await HwidBan.findOneAndDelete({ hwid, userId });
        if (!result) {
            return res.status(404).json({ error: 'HWID no encontrado' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error desbaneando HWID:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RUTAS DE API KEYS
// ============================================
app.post('/api/claim-key', requireAuth, async (req, res) => {
    res.json({ success: false, error: 'API Keys no implementadas aun' });
});

app.post('/api/remove-key', requireAuth, async (req, res) => {
    res.json({ success: false, error: 'API Keys no implementadas aun' });
});

// ============================================
// SERVIR EL FRONTEND
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// MANEJO DE ERRORES GLOBAL
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Error global:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`🔗 URL: ${FRONTEND_URL}`);
});
