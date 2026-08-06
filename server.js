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

const MONGODB_URI = process.env.MONGODB_URI;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'clave-segura-cambiala';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

console.log('🚀 Iniciando FluxyProtect...');

// ============================================
// CONEXIÓN A MONGODB
// ============================================
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error MongoDB:', err.message));

const UserSchema = new mongoose.Schema({
    discordId: { type: String, unique: true },
    username: String,
    avatar: String,
    plan: { type: String, default: 'basic' },
    obfuscationsUsed: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// ============================================
// MIDDLEWARE - CONFIGURACIÓN CRÍTICA
// ============================================
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// SESIÓN CON CONFIGURACIÓN ESPECÍFICA PARA RENDER
const MongoStore = require('connect-mongodb-session')(session);
const store = new MongoStore({
    uri: MONGODB_URI,
    collection: 'sessions',
    touchAfter: 24 * 3600 // 1 día
});

app.use(session({
    secret: SESSION_SECRET,
    resave: true,  // CAMBIADO A TRUE
    saveUninitialized: true,  // CAMBIADO A TRUE
    store: store,
    cookie: {
        secure: false,  // CAMBIADO A FALSE PARA PRUEBAS
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
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
        } else {
            console.log('✅ Usuario existente');
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

passport.serializeUser((user, done) => {
    console.log('📦 Serializando usuario:', user.username);
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log('📦 Deserializando usuario:', user.username);
    done(null, user);
});

// ============================================
// MIDDLEWARE PARA VERIFICAR AUTENTICACIÓN
// ============================================
const requireAuth = (req, res, next) => {
    console.log('🔍 Verificando autenticación...');
    console.log('📌 req.user:', req.user ? req.user.username : 'NO');
    console.log('📌 req.session:', req.session ? 'EXISTE' : 'NO');
    console.log('📌 req.sessionID:', req.sessionID);
    
    if (!req.user) {
        console.log('❌ No autenticado');
        return res.status(401).json({ error: 'No autenticado' });
    }
    console.log('✅ Autenticado');
    next();
};

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================
app.get('/api/auth/discord', passport.authenticate('discord'));

app.get('/api/auth/discord/callback',
    passport.authenticate('discord', { 
        failureRedirect: '/',
        failureMessage: true 
    }),
    (req, res) => {
        console.log('🔑 Callback ejecutado');
        console.log('📌 Usuario:', req.user ? req.user.username : 'NO');
        console.log('📌 Session ID:', req.sessionID);
        
        // GUARDAR SESIÓN EXPLÍCITAMENTE
        req.session.save((err) => {
            if (err) {
                console.error('❌ Error guardando sesión:', err);
                return res.redirect('/');
            }
            console.log('✅ Sesión guardada correctamente');
            const user = req.user;
            const redirectUrl = `/?user=${encodeURIComponent(user.username)}&id=${user.id}&avatar=${user.avatar || '0'}`;
            console.log('🔄 Redirigiendo a:', redirectUrl);
            res.redirect(redirectUrl);
        });
    }
);

// ============================================
// RUTAS DE LA API
// ============================================
app.get('/api/data', requireAuth, async (req, res) => {
    try {
        const user = await User.findOne({ discordId: req.user.id });
        res.json({
            scripts: [],
            panels: [],
            keys: [],
            bannedHWIDs: [],
            obfuscationsLeft: user ? 10 - user.obfuscationsUsed : 10,
            maxObfuscations: user?.plan === 'premium' ? Infinity : 10,
            plan: user?.plan || 'basic',
            serverTime: Date.now(),
            apiKey: null,
            apiKeyExpiry: null
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error(err);
        res.redirect('/');
    });
});

// ============================================
// RUTA PARA VERIFICAR SESIÓN (DEBUG)
// ============================================
app.get('/api/check-session', (req, res) => {
    res.json({
        hasUser: !!req.user,
        user: req.user ? req.user.username : null,
        sessionID: req.sessionID,
        session: req.session ? 'EXISTE' : 'NO'
    });
});

// ============================================
// SERVIR EL FRONTEND
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`🔗 URL: ${FRONTEND_URL}`);
});
