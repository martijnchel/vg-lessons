const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const UPDATE_INTERVAL_MS = 5 * 60 * 1000; 

// Railway Environment Variables
const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;

let lessenCache = [];

// --- SYNC FUNCTIE ---
async function syncVirtuagym() {
    try {
        // Tijd in Nederland forceren voor de API-aanvraag
        const nuNL = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
        const start = Math.floor(new Date(nuNL).setHours(0,0,0,0) / 1000);
        const end = Math.floor(new Date(nuNL).setHours(23,59,59,999) / 1000);

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: {
                api_key: API_KEY,
                club_secret: CLUB_SECRET,
                timestamp_start: start,
                timestamp_end: end
            }
        });

        if (response.data && response.data.result) {
            lessenCache = response.data.result.filter(e => e.canceled === false).map(e => {
                // TITEL FIX: Probeer title, dan activity_name, anders fallback
                const naam = e.title || e.activity_name || "Groepsles";
                
                return {
                    ...e,
                    display_title: naam,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            console.log(`[${new Date().toLocaleTimeString()}] Sync succesvol: ${lessenCache.length} lessen.`);
        }
    } catch (e) {
        console.error("Sync Error:", e.message);
    }
}

// --- ROUTES ---

app.get('/check', (req, res) => {
    // Huidige tijd in NL
    const nu = new Date().toLocaleString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit'});
    
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">`;
    html += `<h1>YVSPORT Lessons Debug</h1><p>Huidige tijd (NL): <strong>${nu}</strong></p>`;
    html += `<table border="1" cellpadding="10" style="border-collapse:collapse; width:100%;">`;
    html += `<tr style="background:#333;"><th>Tijd</th><th>Les (Naam)</th><th>Bezetting</th><th>Status</th></tr>`;
    
    lessenCache.forEach(l => {
        const isNu = nu >= l.start_tijd && nu < l.eind_tijd;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}">
                    <td>${l.start_tijd}-${l.eind_tijd}</td>
                    <td>${l.display_title}</td>
                    <td>${l.attendees}/${l.max_places}</td>
                    <td>${isNu ? '<strong>NU BEZIG</strong>' : 'GEPLAND'}</td>
                 </tr>`;
    });
    
    html += `</table><p style="color:gray; margin-top:20px;">Ps: Als namen leeg blijven, stuur me de ruwe data via /raw</p></body></html>`;
    res.send(html);
});

// Extra route om de ruwe data te inspecteren mochten de namen leeg blijven
app.get('/raw', (req, res) => {
    res.json(lessenCache);
});

app.get('/', (req, res) => res.send('YVSPORT Lessons Service Online. Check /check voor het rooster.'));

app.listen(PORT, () => {
    console.log(`Server gestart op poort ${PORT}`);
    syncVirtuagym();
    setInterval(syncVirtuagym, UPDATE_INTERVAL_MS);
});
