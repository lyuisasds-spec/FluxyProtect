// bot.js - Bot de Discord para FluxyProtect
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const mongoose = require('mongoose');
const axios = require('axios');

// ============================================
// CONFIGURACIÓN
// ============================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://fluxyprotect.onrender.com';

// ============================================
// CONEXIÓN A MONGODB
// ============================================
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Bot conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error MongoDB:', err.message));

// Modelos (igual que en server.js)
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
client.once('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`📡 Servidor en: ${FRONTEND_URL}`);
});

// ============================================
// COMANDO SLASH: /link
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, channel } = interaction;

    if (commandName === 'link') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const panelKey = interaction.options.getString('key');
            
            if (!panelKey) {
                return interaction.editReply({
                    content: '❌ Debes proporcionar una key de panel válida.',
                    ephemeral: true
                });
            }

            // Buscar el panel por su key
            const panel = await Panel.findOne({ panelKey: panelKey });
            if (!panel) {
                return interaction.editReply({
                    content: '❌ Key de panel inválida. Verifica que sea correcta.',
                    ephemeral: true
                });
            }

            // Verificar que el canal coincida
            if (panel.channelId !== channel.id) {
                return interaction.editReply({
                    content: `❌ Este panel está configurado para el canal <#${panel.channelId}>. Usa el comando en ese canal.`,
                    ephemeral: true
                });
            }

            // Buscar el script asociado
            const script = await Script.findOne({ _id: panel.scriptId });
            if (!script) {
                return interaction.editReply({
                    content: '❌ El script asociado a este panel no existe.',
                    ephemeral: true
                });
            }

            // Generar link del panel
            const panelLink = `${FRONTEND_URL}/panel/${panel.panelKey}`;

            // Crear embed
            const embed = new EmbedBuilder()
                .setTitle(`📋 ${panel.name}`)
                .setDescription(panel.description || 'Panel de protección FluxyProtect')
                .setColor('#00d4ff')
                .addFields(
                    { name: '📜 Script', value: `\`${script.name}\``, inline: true },
                    { name: '🔑 Panel Key', value: `\`${panel.panelKey}\``, inline: true },
                    { name: '⏱️ Cooldown', value: `${panel.hwidCooldown || 0} segundos`, inline: true },
                    { name: '🔗 Link del Panel', value: `[Haz clic aquí](${panelLink})`, inline: false }
                )
                .setFooter({ text: 'FluxyProtect - Advanced Protection', iconURL: 'https://fluxyprotect.onrender.com/favicon.ico' })
                .setTimestamp();

            // Crear botones
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('📜 Ver Script')
                        .setStyle(ButtonStyle.Primary)
                        .setCustomId(`view_script_${script._id}`),
                    new ButtonBuilder()
                        .setLabel('🔑 Redimir Key')
                        .setStyle(ButtonStyle.Success)
                        .setCustomId(`redeem_key_${panel._id}`),
                    new ButtonBuilder()
                        .setLabel('📊 Stats')
                        .setStyle(ButtonStyle.Secondary)
                        .setCustomId(`stats_${panel._id}`),
                    new ButtonBuilder()
                        .setLabel('🔄 Reset HWID')
                        .setStyle(ButtonStyle.Danger)
                        .setCustomId(`reset_hwid_${panel._id}`)
                );

            // Enviar el mensaje
            await interaction.channel.send({
                embeds: [embed],
                components: [row]
            });

            await interaction.editReply({
                content: '✅ Panel enviado correctamente al canal.',
                ephemeral: true
            });

        } catch (error) {
            console.error('❌ Error en /link:', error);
            await interaction.editReply({
                content: '❌ Hubo un error al procesar tu solicitud.',
                ephemeral: true
            });
        }
    }
});

// ============================================
// BOTONES INTERACTIVOS
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const { customId, user, channel } = interaction;

    // ===== VER SCRIPT =====
    if (customId.startsWith('view_script_')) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const scriptId = customId.replace('view_script_', '');
            const script = await Script.findOne({ _id: scriptId });
            
            if (!script) {
                return interaction.editReply({ content: '❌ Script no encontrado.', ephemeral: true });
            }

            const loadstring = `loadstring(game:HttpGet('${FRONTEND_URL}/loader/${script._id}'))()`;
            
            const embed = new EmbedBuilder()
                .setTitle(`📜 ${script.name}`)
                .setDescription(`**Código de carga:**\n\`\`\`lua\n${loadstring}\n\`\`\``)
                .addFields(
                    { name: '🔑 Key del Script', value: `\`${script.scriptKey || 'N/A'}\``, inline: true },
                    { name: '📌 FFA Mode', value: script.ffaMode ? '✅ Activado' : '❌ Desactivado', inline: true },
                    { name: '📦 Compress Mode', value: script.compressMode ? '✅ Activado' : '❌ Desactivado', inline: true },
                    { name: '📊 Estado', value: script.status === 'active' ? '✅ Activo' : '❌ Desactivado', inline: true }
                )
                .setColor('#00d4ff')
                .setFooter({ text: 'FluxyProtect - Advanced Protection' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('❌ Error en view_script:', error);
            await interaction.editReply({ content: '❌ Error al cargar el script.', ephemeral: true });
        }
    }

    // ===== REDIMIR KEY =====
    if (customId.startsWith('redeem_key_')) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const panelId = customId.replace('redeem_key_', '');
            
            // Buscar panel
            const panel = await Panel.findOne({ _id: panelId });
            if (!panel) {
                return interaction.editReply({ content: '❌ Panel no encontrado.', ephemeral: true });
            }

            // Buscar una key disponible para este panel
            const key = await Key.findOne({ 
                panelId: panel._id.toString(),
                used: false
            });

            if (!key) {
                return interaction.editReply({ 
                    content: '❌ No hay keys disponibles para este panel. Contacta al administrador.',
                    ephemeral: true 
                });
            }

            // Marcar key como usada
            key.used = true;
            key.usedBy = user.id;
            key.usedAt = new Date();
            await key.save();

            const embed = new EmbedBuilder()
                .setTitle('🔑 Key Redimida')
                .setDescription(`**Tu key ha sido redimida exitosamente**`)
                .addFields(
                    { name: '🔑 Key', value: `\`${key.key}\``, inline: false },
                    { name: '📦 Panel', value: panel.name, inline: true },
                    { name: '⏳ Duración', value: key.duration || 'Permanent', inline: true },
                    { name: '📝 Nota', value: key.note || 'N/A', inline: true }
                )
                .setColor('#2ed573')
                .setFooter({ text: 'Guarda esta key, la necesitarás para el script' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('❌ Error en redeem_key:', error);
            await interaction.editReply({ content: '❌ Error al redimir la key.', ephemeral: true });
        }
    }

    // ===== STATS =====
    if (customId.startsWith('stats_')) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const panelId = customId.replace('stats_', '');
            const panel = await Panel.findOne({ _id: panelId });
            
            if (!panel) {
                return interaction.editReply({ content: '❌ Panel no encontrado.', ephemeral: true });
            }

            const totalKeys = await Key.countDocuments({ panelId: panel._id.toString() });
            const usedKeys = await Key.countDocuments({ panelId: panel._id.toString(), used: true });
            const availableKeys = totalKeys - usedKeys;

            const embed = new EmbedBuilder()
                .setTitle(`📊 Estadísticas de ${panel.name}`)
                .addFields(
                    { name: '🔑 Total de Keys', value: `${totalKeys}`, inline: true },
                    { name: '✅ Keys Usadas', value: `${usedKeys}`, inline: true },
                    { name: '🟢 Keys Disponibles', value: `${availableKeys}`, inline: true },
                    { name: '⏱️ Cooldown', value: `${panel.hwidCooldown || 0} segundos`, inline: true },
                    { name: '📜 Script', value: await getScriptName(panel.scriptId), inline: true }
                )
                .setColor('#ffa502')
                .setFooter({ text: 'FluxyProtect - Advanced Protection' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('❌ Error en stats:', error);
            await interaction.editReply({ content: '❌ Error al cargar estadísticas.', ephemeral: true });
        }
    }

    // ===== RESET HWID =====
    if (customId.startsWith('reset_hwid_')) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const panelId = customId.replace('reset_hwid_', '');
            
            // Buscar keys usadas por este usuario para este panel
            const keys = await Key.find({ 
                panelId: panelId,
                usedBy: user.id
            });

            if (keys.length === 0) {
                return interaction.editReply({ 
                    content: '❌ No tienes keys redimidas en este panel para resetear.',
                    ephemeral: true 
                });
            }

            // Resetear las keys
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
                content: `✅ Se han reseteado ${resetCount} key(s) para este panel. Puedes redimir una nueva key.`,
                ephemeral: true
            });

        } catch (error) {
            console.error('❌ Error en reset_hwid:', error);
            await interaction.editReply({ content: '❌ Error al resetear HWID.', ephemeral: true });
        }
    }
});

// ============================================
// FUNCIÓN AUXILIAR
// ============================================
async function getScriptName(scriptId) {
    try {
        const script = await Script.findOne({ _id: scriptId });
        return script ? script.name : 'Script no encontrado';
    } catch {
        return 'Script no encontrado';
    }
}

// ============================================
// REGISTRAR COMANDOS SLASH
// ============================================
async function registerCommands() {
    try {
        const commands = [
            {
                name: 'link',
                description: 'Vincula un panel a este canal usando su key',
                options: [
                    {
                        name: 'key',
                        description: 'La key del panel que quieres vincular',
                        type: 3, // STRING
                        required: true
                    }
                ]
            },
            {
                name: 'panel',
                description: 'Obtén información sobre un panel',
                options: [
                    {
                        name: 'key',
                        description: 'La key del panel',
                        type: 3,
                        required: true
                    }
                ]
            }
        ];

        // Registrar comandos globalmente (tarda hasta 1 hora en propagarse)
        // Para desarrollo, usa guild commands:
        // const guild = client.guilds.cache.get('TU_GUILD_ID');
        // await guild.commands.set(commands);

        // Para producción (global):
        await client.application.commands.set(commands);
        console.log('✅ Comandos slash registrados globalmente');
        console.log('⚠️ Los comandos globales pueden tardar hasta 1 hora en aparecer');
        console.log('💡 Para pruebas rápidas, usa comandos de guild');
    } catch (error) {
        console.error('❌ Error registrando comandos:', error);
    }
}

// ============================================
// INICIAR EL BOT
// ============================================
client.login(DISCORD_BOT_TOKEN)
    .then(async () => {
        console.log('🤖 Bot iniciado');
        await registerCommands();
    })
    .catch(err => console.error('❌ Error al iniciar bot:', err));

// ============================================
// MANEJO DE ERRORES
// ============================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});
