const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const UPDATE_INTERVAL_MS = 5 * 60 * 1000; // Elke 5 min sync voor bezetting

// Environment Variables van Railway
const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const HOMEY_URL = process.env.HOMEY_URL; 

let lessenCache = [];

// API Sync Functie
async function syncVirtuagym() {
    try {
        const start = Math.floor(new Date().setHours(0,0,0,0) / 1000);
        const end = Math.floor(new Date().setHours(23,59,59,999) / 1000);

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: {
                api_key: API_KEY,
                club_secret: CLUB_SECRET,
                timestamp_start: start,
                timestamp_end: end
            }
        });

        if (response.data && response.data.result) {
            lessenCache = response.data.result.filter(e => e.canceled === false);
            console.log(`[${new Date().toISOString()}] Sync succesvol: ${lessenCache.length} lessen.`);
        }
    } catch (e) {
        console.error("Sync Error:", e.message);
    }
}

// Debug pagina om live data te zien
app.get('/check', (req, res) => {
    const nu = new Date();
    const tijdNu = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');
    
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">`;
    html += `<h1>YVSPORT Lessons Debug</h1><p>Tijd: ${tijdNu}</p><table border="1" cellpadding="10" style="border-collapse:collapse; width:100%;">`;
    html += `<tr style="background:#333;"><th>Tijd</th><th>Les</th><th>Bezetting</th><th>Status</th></tr>`;
    
    lessenCache.forEach(l => {
        const s = l.start.split(' ')[1].substring(0, 5);
        const e = l.end.split(' ')[1].substring(0, 5);
        const isNu = tijdNu >= s && tijdNu < e;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}"><td>${s}-${e}</td><td>${l.title}</td><td>${l.attendees}/${l.max_places}</td><td>${isNu ? 'NU BEZIG' : 'GEPLAND'}</td></tr>`;
    });
    
    html += `</table></body></html>`;
    res.send(html);
});

app.get('/', (req, res) => res.send('YVSPORT Lessons Service Online. Go to /check for data.'));

app.listen(PORT, () => {
    console.log(`Server gestart op poort ${PORT}`);
    syncVirtuagym();
    setInterval(syncVirtuagym, UPDATE_INTERVAL_MS);
});