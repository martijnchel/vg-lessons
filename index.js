const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

// --- DE HOOFD-DATABASE (VUL DEZE AAN MET DE DATA VAN /SCAN) ---
const activityNames = {
    "594697": "Spinning",
    "589058": "Spinning",
    "594693": "Fitcircuit",
    "595083": "Buikspierkwartier"
};

let lessenCache = [];

// FUNCTIE: Synchroniseer met Virtuagym voor VANDAAG
async function syncVirtuagym() {
    try {
        const nuNL = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
        const start = Math.floor(new Date(nuNL).setHours(0,0,0,0) / 1000);
        const end = Math.floor(new Date(nuNL).setHours(23,59,59,999) / 1000);

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, timestamp_start: start, timestamp_end: end }
        });

        if (response.data && response.data.result) {
            lessenCache = response.data.result.filter(e => e.canceled === false).map(e => {
                const naam = e.title || activityNames[e.activity_id] || `Onbekende Les (${e.activity_id})`;
                return {
                    ...e,
                    display_title: naam,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            console.log("Sync voltooid.");
        }
    } catch (e) { console.error("Sync Error:", e.message); }
}

// ROUTE: SCAN (Bekijk alle ID's van de komende week)
app.get('/scan', async (req, res) => {
    try {
        const nu = Math.floor(Date.now() / 1000);
        const weekVerder = nu + (7 * 24 * 60 * 60);

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, timestamp_start: nu, timestamp_end: weekVerder }
        });

        let html = `<html><body style="font-family:sans-serif; padding:40px; background:#f0f0f0;">`;
        html += `<h1>YVSPORT Les Scanner</h1><p>Kopieer deze lijst naar Gemini om de namen te koppelen:</p><table border="1" cellpadding="10" style="border-collapse:collapse; background:white;">`;
        html += `<tr><th>Dag</th><th>Tijd</th><th>ID</th><th>Huidige Naam</th></tr>`;

        response.data.result.forEach(e => {
            const dag = new Date(e.start).toLocaleDateString('nl-NL', {weekday: 'long'});
            const tijd = e.start.split(' ')[1].substring(0, 5);
            html += `<tr><td>${dag}</td><td>${tijd}</td><td><strong>${e.activity_id}</strong></td><td>${e.title || activityNames[e.activity_id] || '---'}</td></tr>`;
        });

        res.send(html + "</table></body></html>");
    } catch (e) { res.status(500).send("Scan Fout: " + e.message); }
});

// ROUTE: CHECK (Voor het dashboard debuggen)
app.get('/check', (req, res) => {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    let html = `<h1>Vandaag</h1><table border="1">`;
    lessenCache.forEach(l => {
        html += `<tr><td>${l.start_tijd}</td><td>${l.display_title}</td></tr>`;
    });
    res.send(html + "</table>");
});

app.get('/', (req, res) => res.send('Service is online. Ga naar /scan om ID\'s te koppelen.'));

app.listen(PORT, () => {
    console.log(`Poort: ${PORT}`);
    syncVirtuagym();
    setInterval(syncVirtuagym, 5 * 60 * 1000);
});
