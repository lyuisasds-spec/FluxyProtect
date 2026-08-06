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
// CONEXIÓN A MONGODB (Recomendado para Render)
// ============================================
// Si usas MongoDB Atlas (gratis)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/securehub')
    .then(() => console.log('✅ Conectado a MongoDB'))
    .catch(err => console.error('❌ Error MongoDB:', err));

// Modelo de Usuario (opcional)
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
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Configuración de sesión para Render
const MongoStore = require('connect-mongodb-session')(session);
const store = new MongoStore({
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/securehub',
    collection: 'sessions'
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
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

// Passport
app.use(passport.initialize());
app.use(passport.session());

// ============================================
// ESTRATEGIA DE DISCORD
// ============================================
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/api/auth/discord/callback`,
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Buscar o crear usuario en MongoDB
        let user = await User.findOne({ discordId: profile.id });
        if (!user) {
            user = new User({
                discordId: profile.id,
                username: profile.username,
                avatar: profile.avatar
            });
            await user.save();
        }
        return done(null, {
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar,
            discriminator: profile.discriminator,
            accessToken: accessToken,
            plan: user.plan,
            obfuscationsUsed: user.obfuscationsUsed
        });
    } catch (err) {
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
// RUTAS DE AUTENTICACIÓN
// ============================================
app.get('/api/auth/discord', passport.authenticate('discord'));

app.get('/api/auth/discord/callback',
    passport.authenticate('discord', { 
        failureRedirect: '/login',
        failureMessage: true 
    }),
    (req, res) => {
        const user = req.user;
        if (user) {
            res.redirect(`/?user=${encodeURIComponent(user.username)}&id=${user.id}&avatar=${user.avatar || '0'}`);
        } else {
            res.redirect('/login');
        }
    }
);

app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) { console.error(err); }
        res.redirect('/');
    });
});

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
};

// ============================================
// RUTAS DE LA API
// ============================================
app.get('/api/data', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        // Buscar usuario en la base de datos
        const user = await User.findOne({ discordId: userId });
        
        res.json({
            scripts: [], // Tus scripts aquí
            panels: [],  // Tus paneles aquí
            keys: [],    // Tus keys aquí
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
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================
// SERVIR EL FRONTEND
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.redirect('/');
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
});
