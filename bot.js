// bot.js - Bot de Discord para FluxyProtect
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');
const axios = require('axios');

// ============================================
// CONFIGURACION
// ============================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://fluxyprotect.onrender.com';

// ============================================
// CONEXION A MONGODB
// ============================================
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Bot conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error MongoDB:', err.message));

// Modelos
const PanelSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    channelId: { type: String, required: true },
    scriptId: { type: String, required: true },
    hwidCooldown: { type: Number, default: 0 },
    panelKey: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now }
});
const Panel = mongoose.model('Panel', PanelSchema);

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

const BlacklistSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    discordId: { type: String, required: true },
    panelId: { type: String, required: true },
    reason: { type: String, default: 'Sin razon' },
    createdAt: { type: Date, default: Date.now }
});
const Blacklist = mongoose.model('Blacklist', BlacklistSchema);

// ============================================
// CLIENTE DE DISCORD
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ============================================
// EVENTOS DEL BOT
// ============================================
client.once('clientReady', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`📡 Servidor en: ${FRONTEND_URL}`);
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function generateKey() {
    return Math.random().toString(36).substring(2, 10).toUpperCase() + 
           Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePanelKey() {
    return 'FP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function getScriptName(scriptId) {
    try {
        const script = await Script.findOne({ _id: scriptId });
        return script ? script.name : 'Script no encontrado';
    } catch {
        return 'Script no encontrado';
    }
}

async function getPanelKeys(panelId) {
    const total = await Key.countDocuments({ panelId: panelId });
    const used = await Key.countDocuments({ panelId: panelId, used: true });
    return { total, used, available: total - used };
}

// ============================================
// FUNCION PARA ENVIAR PANEL A DISCORD
// ============================================
async function sendPanelToDiscord(panelId, channelId) {
    try {
        const panel = await Panel.findOne({ _id: panelId });
        if (!panel) return { success: false, error: 'Panel no encontrado' };

        const script = await Script.findOne({ _id: panel.scriptId });
        if (!script) return { success: false, error: 'Script no encontrado' };

        const stats = await getPanelKeys(panel._id.toString());

        // Crear embed
        const embed = new EmbedBuilder()
            .setTitle(`${panel.name}`)
            .setDescription(panel.description || 'Panel de proteccion FluxyProtect')
            .setColor('#00d4ff')
            .addFields(
                { name: 'Script', value: `\`${script.name}\``, inline: true },
                { name: 'Panel Key', value: `\`${panel.panelKey}\``, inline: true },
                { name: 'Cooldown', value: `${panel.hwidCooldown || 0} segundos`, inline: true },
                { name: 'Keys Disponibles', value: `${stats.available}`, inline: true },
                { name: 'Keys Usadas', value: `${stats.used}`, inline: true },
                { name: 'Total Keys', value: `${stats.total}`, inline: true }
            )
            .setFooter({ text: 'FluxyProtect - Advanced Protection' })
            .setTimestamp();

        // Botones
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Ver Script')
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId(`view_script_${script._id}`),
                new ButtonBuilder()
                    .setLabel('Redimir Key')
                    .setStyle(ButtonStyle.Success)
                    .setCustomId(`redeem_key_${panel._id}`),
                new ButtonBuilder()
                    .setLabel('Stats')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`stats_${panel._id}`),
                new ButtonBuilder()
                    .setLabel('Reset HWID')
                    .setStyle(ButtonStyle.Danger)
                    .setCustomId(`reset_hwid_${panel._id}`)
            );

        // Enviar al canal
        const channel = await client.channels.fetch(channelId);
        if (!channel) return { success: false, error: 'Canal no encontrado' };

        await channel.send({ embeds: [embed], components: [row] });
        return { success: true };

    } catch (error) {
        console.error('Error enviando panel:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// COMANDOS SLASH
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, channel, options } = interaction;

    // ============================================
    // COMANDO: /keygen
    // ============================================
    if (commandName === 'keygen') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panelKey = options.getString('panelkey');
            const duration = options.getString('duration') || 'permanent';
            const note = options.getString('note') || '';

            const panel = await Panel.findOne({ panelKey: panelKey });
            if (!panel) {
                return interaction.editReply({
                    content: 'Panel no encontrado. Verifica la Panel Key.'
                });
            }

            const newKey = generateKey();
            let expiresAt = null;
            if (duration !== 'permanent') {
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

            const key = new Key({
                userId: panel.userId,
                panelId: panel._id.toString(),
                key: newKey,
                note: note,
                duration: duration,
                expiresAt: expiresAt
            });

            await key.save();

            const embed = new EmbedBuilder()
                .setTitle('Key Generada')
                .setDescription(`Key para panel **${panel.name}**`)
                .addFields(
                    { name: 'Key', value: `\`${newKey}\``, inline: false },
                    { name: 'Panel', value: panel.name, inline: true },
                    { name: 'Duracion', value: duration, inline: true },
                    { name: 'Nota', value: note || 'N/A', inline: true },
                    { name: 'Expira', value: expiresAt ? new Date(expiresAt).toLocaleString() : 'Nunca', inline: true }
                )
                .setColor('#00d4ff')
                .setFooter({ text: 'FluxyProtect - Key Generator' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error en keygen:', error);
            await interaction.editReply({
                content: 'Error al generar la key: ' + error.message
            });
        }
    }

    // ============================================
    // COMANDO: /blacklist
    // ============================================
    if (commandName === 'blacklist') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = options.getUser('usuario');
            const panelKey = options.getString('panelkey');
            const reason = options.getString('razon') || 'Sin razon';

            const panel = await Panel.findOne({ panelKey: panelKey });
            if (!panel) {
                return interaction.editReply({
                    content: 'Panel no encontrado. Verifica la Panel Key.'
                });
            }

            // Verificar si ya esta blacklistado
            const existing = await Blacklist.findOne({
                discordId: targetUser.id,
                panelId: panel._id.toString()
            });

            if (existing) {
                return interaction.editReply({
                    content: `El usuario ${targetUser.tag} ya esta en la blacklist de este panel.`
                });
            }

            const blacklist = new Blacklist({
                userId: panel.userId,
                discordId: targetUser.id,
                panelId: panel._id.toString(),
                reason: reason
            });

            await blacklist.save();

            const embed = new EmbedBuilder()
                .setTitle('Usuario Blacklistado')
                .setDescription(`El usuario ha sido agregado a la blacklist`)
                .addFields(
                    { name: 'Usuario', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
                    { name: 'Panel', value: panel.name, inline: true },
                    { name: 'Razon', value: reason, inline: true }
                )
                .setColor('#ff4757')
                .setFooter({ text: 'FluxyProtect - Blacklist' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error en blacklist:', error);
            await interaction.editReply({
                content: 'Error al blacklistear: ' + error.message
            });
        }
    }

    // ============================================
    // COMANDO: /resethwid
    // ============================================
    if (commandName === 'resethwid') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = options.getUser('usuario');
            const panelKey = options.getString('panelkey');

            const panel = await Panel.findOne({ panelKey: panelKey });
            if (!panel) {
                return interaction.editReply({
                    content: 'Panel no encontrado. Verifica la Panel Key.'
                });
            }

            // Buscar keys usadas por este usuario
            const keys = await Key.find({
                panelId: panel._id.toString(),
                usedBy: targetUser.id
            });

            if (keys.length === 0) {
                return interaction.editReply({
                    content: `El usuario ${targetUser.tag} no tiene keys redimidas en este panel.`
                });
            }

            let resetCount = 0;
            for (const key of keys) {
                key.used = false;
                key.usedBy = null;
                key.usedAt = null;
                key.hwid = null;
                await key.save();
                resetCount++;
            }

            const embed = new EmbedBuilder()
                .setTitle('HWID Reseteado')
                .setDescription(`Se han reseteado las keys del usuario`)
                .addFields(
                    { name: 'Usuario', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
                    { name: 'Panel', value: panel.name, inline: true },
                    { name: 'Keys Reseteadas', value: `${resetCount}`, inline: true }
                )
                .setColor('#2ed573')
                .setFooter({ text: 'FluxyProtect - Reset HWID' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error en resethwid:', error);
            await interaction.editReply({
                content: 'Error al resetear HWID: ' + error.message
            });
        }
    }

    // ============================================
    // BOTONES
    // ============================================
    if (interaction.isButton()) {
        const { customId, user } = interaction;

        // Ver Script
        if (customId.startsWith('view_script_')) {
            await interaction.deferReply({ ephemeral: true });
            try {
                const scriptId = customId.replace('view_script_', '');
                const script = await Script.findOne({ _id: scriptId });
                
                if (!script) {
                    return interaction.editReply({ content: 'Script no encontrado.' });
                }

                const loadstring = `loadstring(game:HttpGet('${FRONTEND_URL}/loader/${script._id}'))()`;
                
                const embed = new EmbedBuilder()
                    .setTitle(`Script: ${script.name}`)
                    .setDescription(`Codigo de carga:\n\`\`\`lua\n${loadstring}\n\`\`\``)
                    .addFields(
                        { name: 'Key del Script', value: `\`${script.scriptKey || 'N/A'}\``, inline: true },
                        { name: 'FFA Mode', value: script.ffaMode ? 'Activado' : 'Desactivado', inline: true },
                        { name: 'Compress Mode', value: script.compressMode ? 'Activado' : 'Desactivado', inline: true },
                        { name: 'Estado', value: script.status === 'active' ? 'Activo' : 'Desactivado', inline: true }
                    )
                    .setColor('#00d4ff');

                await interaction.editReply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                console.error('Error en view_script:', error);
                await interaction.editReply({ content: 'Error al cargar el script.' });
            }
        }

        // Redimir Key
        if (customId.startsWith('redeem_key_')) {
            await interaction.deferReply({ ephemeral: true });
            try {
                const panelId = customId.replace('redeem_key_', '');
                
                const panel = await Panel.findOne({ _id: panelId });
                if (!panel) {
                    return interaction.editReply({ content: 'Panel no encontrado.' });
                }

                // Verificar blacklist
                const blacklisted = await Blacklist.findOne({
                    discordId: user.id,
                    panelId: panel._id.toString()
                });

                if (blacklisted) {
                    return interaction.editReply({
                        content: 'Estas blacklistado de este panel. Contacta al administrador.'
                    });
                }

                const key = await Key.findOne({ 
                    panelId: panel._id.toString(),
                    used: false
                });

                if (!key) {
                    return interaction.editReply({
                        content: 'No hay keys disponibles para este panel.'
                    });
                }

                key.used = true;
                key.usedBy = user.id;
                key.usedAt = new Date();
                await key.save();

                const embed = new EmbedBuilder()
                    .setTitle('Key Redimida')
                    .setDescription('Tu key ha sido redimida exitosamente')
                    .addFields(
                        { name: 'Key', value: `\`${key.key}\``, inline: false },
                        { name: 'Panel', value: panel.name, inline: true },
                        { name: 'Duracion', value: key.duration || 'Permanent', inline: true },
                        { name: 'Nota', value: key.note || 'N/A', inline: true }
                    )
                    .setColor('#2ed573');

                await interaction.editReply({ embeds: [embed], ephemeral: true });

            } catch (error) {
                console.error('Error en redeem_key:', error);
                await interaction.editReply({ content: 'Error al redimir la key.' });
            }
        }

        // Stats
        if (customId.startsWith('stats_')) {
            await interaction.deferReply({ ephemeral: true });
            try {
                const panelId = customId.replace('stats_', '');
                const panel = await Panel.findOne({ _id: panelId });
                
                if (!panel) {
                    return interaction.editReply({ content: 'Panel no encontrado.' });
                }

                const stats = await getPanelKeys(panel._id.toString());

                const embed = new EmbedBuilder()
                    .setTitle(`Estadisticas: ${panel.name}`)
                    .addFields(
                        { name: 'Total Keys', value: `${stats.total}`, inline: true },
                        { name: 'Keys Usadas', value: `${stats.used}`, inline: true },
                        { name: 'Keys Disponibles', value: `${stats.available}`, inline: true },
                        { name: 'Cooldown', value: `${panel.hwidCooldown || 0} segundos`, inline: true },
                        { name: 'Script', value: await getScriptName(panel.scriptId), inline: true }
                    )
                    .setColor('#ffa502');

                await interaction.editReply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                console.error('Error en stats:', error);
                await interaction.editReply({ content: 'Error al cargar estadisticas.' });
            }
        }

        // Reset HWID
        if (customId.startsWith('reset_hwid_')) {
            await interaction.deferReply({ ephemeral: true });
            try {
                const panelId = customId.replace('reset_hwid_', '');
                
                const keys = await Key.find({ 
                    panelId: panelId,
                    usedBy: user.id
                });

                if (keys.length === 0) {
                    return interaction.editReply({
                        content: 'No tienes keys redimidas en este panel para resetear.'
                    });
                }

                let resetCount = 0;
                for (const key of keys) {
                    key.used = false;
                    key.usedBy = null;
                    key.usedAt = null;
                    key.hwid = null;
                    await key.save();
                    resetCount++;
                }

                await interaction.editReply({
                    content: `Se han reseteado ${resetCount} key(s) para este panel. Puedes redimir una nueva key.`
                });

            } catch (error) {
                console.error('Error en reset_hwid:', error);
                await interaction.editReply({ content: 'Error al resetear HWID.' });
            }
        }
    }
});

// ============================================
// REGISTRAR COMANDOS SLASH
// ============================================
async function registerCommands() {
    try {
        const commands = [
            {
                name: 'keygen',
                description: 'Genera una key para un panel',
                options: [
                    {
                        name: 'panelkey',
                        description: 'La key del panel',
                        type: 3,
                        required: true
                    },
                    {
                        name: 'duration',
                        description: 'Duracion de la key',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '1 Hora', value: '1h' },
                            { name: '1 Dia', value: '1d' },
                            { name: '1 Semana', value: '1w' },
                            { name: '1 Mes', value: '1m' },
                            { name: '1 Año', value: '1y' },
                            { name: 'Permanente', value: 'permanent' }
                        ]
                    },
                    {
                        name: 'note',
                        description: 'Nota para la key',
                        type: 3,
                        required: false
                    }
                ]
            },
            {
                name: 'blacklist',
                description: 'Agrega un usuario a la blacklist de un panel',
                options: [
                    {
                        name: 'usuario',
                        description: 'El usuario a blacklistear',
                        type: 6,
                        required: true
                    },
                    {
                        name: 'panelkey',
                        description: 'La key del panel',
                        type: 3,
                        required: true
                    },
                    {
                        name: 'razon',
                        description: 'Razon del blacklist',
                        type: 3,
                        required: false
                    }
                ]
            },
            {
                name: 'resethwid',
                description: 'Resetea el HWID de un usuario en un panel',
                options: [
                    {
                        name: 'usuario',
                        description: 'El usuario a resetear',
                        type: 6,
                        required: true
                    },
                    {
                        name: 'panelkey',
                        description: 'La key del panel',
                        type: 3,
                        required: true
                    }
                ]
            }
        ];

        await client.application.commands.set(commands);
        console.log('Comandos slash registrados globalmente');
        console.log('Los comandos globales pueden tardar hasta 1 hora en aparecer');

    } catch (error) {
        console.error('Error registrando comandos:', error);
    }
}

// ============================================
// API: Enviar panel desde el dashboard
// ============================================
const express = require('express');
const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

app.post('/api/bot/send-panel', async (req, res) => {
    try {
        const { panelId } = req.body;
        const panel = await Panel.findOne({ _id: panelId });
        
        if (!panel) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }

        const result = await sendPanelToDiscord(panel._id.toString(), panel.channelId);
        
        if (result.success) {
            res.json({ success: true, message: 'Panel enviado a Discord' });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error en /api/bot/send-panel:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.send('Bot is running');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Health check server running on port ${port}`);
});

// ============================================
// INICIAR EL BOT
// ============================================
client.login(DISCORD_BOT_TOKEN)
    .then(async () => {
        console.log('Bot iniciado');
        await registerCommands();
    })
    .catch(err => console.error('Error al iniciar bot:', err));

// ============================================
// MANEJO DE ERRORES
// ============================================
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});
