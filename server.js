app.post('/api/send-panel/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const panel = await Panel.findOne({ _id: id, userId });
        if (!panel) {
            return res.status(404).json({ error: 'Panel no encontrado' });
        }

        // Llamar al bot via la API interna
        const botUrl = process.env.BOT_INTERNAL_URL || 'http://localhost:10000';
        
        try {
            const response = await fetch(`${botUrl}/api/bot/send-panel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ panelId: panel._id.toString() })
            });
            
            const data = await response.json();
            
            if (data.success) {
                res.json({ 
                    success: true, 
                    message: 'Panel enviado a Discord',
                    panelKey: panel.panelKey
                });
            } else {
                res.status(500).json({ error: data.error || 'Error enviando panel' });
            }
        } catch (error) {
            console.error('Error llamando al bot:', error);
            res.status(500).json({ error: 'Error conectando con el bot' });
        }
    } catch (err) {
        console.error('Error enviando panel:', err);
        res.status(500).json({ error: err.message });
    }
});
