const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

// Dit is onze vertaallijst die we nu gaan vullen
const activityNames = {
    "594697": "Spinning",
    "589058": "Spinning",
    "594693": "Fitcircuit",
    "595083": "Buikspierkwartier"
};

let lessenCache = [];

// SCAN ROUTE: Haalt alle ID's op voor de komende 7 dagen
app.get('/scan', async (req, res) => {
    try {
        const nu = Math.floor(Date.now() / 1000);
        const weekVerder = nu + (7 * 24 * 60 * 60);

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, timestamp_start: nu, timestamp_end: weekVerder }
        });

        let lijst = response.data.result.map(e => ({
            dag: new Date(e.start).toLocaleDateString('nl-NL', {weekday: 'long'}),
            tijd: e.start.split(' ')[1].substring(0, 5),
            id: e.activity_id,
            titel: e.title || "GEEN TITEL"
        }));

        // Filter dubbele ID's eruit zodat we een schone lijst overhouden
        let uniekeIds = [];
        let cleanLijst = lijst.filter(item => {
            if (!uniekeIds.includes(item.id)) {
                uniekeIds.push(item.id);
                return true;
            }
            return false;
        });

        res.send(`<h1>Les-ID Scanner</h1><pre>${JSON.stringify(cleanLijst, null, 2)}</pre>`);
    } catch (e) { res.send("Fout: " + e.message); }
});

// De rest van de logica voor /check en /raw (zoals in vorig script)
// ... (Zorg dat je de syncVirtuagym en app.listen functies behoudt)
