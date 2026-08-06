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
console.log('📌 FRONTEND_URL:', FRONTEND_URL);

// ============================================
// CONEXIÓN A MONGODB
// ============================================
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error MongoDB:', err.message));

// Modelo de Usuario
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
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Sesión con MongoDB Store
const MongoStore = require('connect-mongodb-session')(session);
const store = new MongoStore({
    uri: MONGODB_URI,
    collection: 'sessions',
    touchAfter: 24 * 3600 // 1 día
});

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
        sameSite: 'lax',
        httpOnly: true
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// ============================================
// ESTRATEGIA DE DISCORD (CORREGIDA)
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
            console.log('✅ Nuevo usuario guardado:', profile.username);
        } else {
            console.log('✅ Usuario existente:', profile.username);
        }
        return done(null, {
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar,
            plan: user.plan,
            obfuscationsUsed: user.obfuscationsUsed
        });
    } catch (err) {
        console.error('❌ Error en estrategia Discord:', err);
        return done(err, null);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// ============================================
// RUTAS DE AUTENTICACIÓN (CORREGIDAS)
// ============================================
app.get('/api/auth/discord', passport.authenticate('discord'));

app.get('/api/auth/discord/callback',
    passport.authenticate('discord', { 
        failureRedirect: '/',
        failureMessage: true 
    }),
    (req, res) => {
        console.log('🔑 Callback ejecutado, usuario:', req.user ? req.user.username : 'NO');
        const user = req.user;
        if (user) {
            const redirectUrl = `/?user=${encodeURIComponent(user.username)}&id=${user.id}&avatar=${user.avatar || '0'}`;
            console.log('🔄 Redirigiendo a:', redirectUrl);
            res.redirect(redirectUrl);
        } else {
            console.log('❌ No hay usuario en callback');
            res.redirect('/');
        }
    }
);

// ============================================
// RUTAS DE LA API
// ============================================
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
};

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
        console.error('Error en /api/data:', err);
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
// SERVIR EL FRONTEND
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Error global:', err);
    res.status(500).send('Error interno del servidor');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`🔗 URL: ${FRONTEND_URL}`);
});
