const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

const activityNames = {
    "595083": "Buikspierkwartier", "595096": "SportYV wandelend", "594693": "Spinning",
    "594694": "Pilates", "595082": "Boksfit", "589058": "Fitcircuit",
    "594700": "50-Fit", "595091": "HIIT", "594697": "Spinning",
    "594699": "Flow Yoga", "595095": "60+ Kracht en Balans", "594706": "BodyBalance",
    "594704": "BBB", "594703": "Gentle Flow Yoga", "594695": "Zumba",
    "594701": "BodyShape", "594707": "Vinyasa Yoga"
};

let lessenCache = [];
let nextSyncTimeout;

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
                return {
                    ...e,
                    display_title: e.title || activityNames[e.activity_id] || "Extra groepsles",
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            console.log(`[${new Date().toLocaleTimeString('nl-NL', {timeZone: 'Europe/Amsterdam'})}] API Sync OK.`);
        }
    } catch (e) { console.error("Sync Error:", e.message); }
    scheduleNextSync();
}

function scheduleNextSync() {
    const nu = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const tijdDecimaal = nu.getHours() + (nu.getMinutes() / 60);
    const intervalMs = ((tijdDecimaal >= 6.5 && tijdDecimaal < 12) || (tijdDecimaal >= 17 && tijdDecimaal < 21.5)) ? 5 * 60 * 1000 : 15 * 60 * 1000;
    if (nextSyncTimeout) clearTimeout(nextSyncTimeout);
    nextSyncTimeout = setTimeout(syncVirtuagym, intervalMs);
}

// --- ROULEER LOGICA VOOR HOMEY (Elke 20 seconden) ---
async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    const seconden = new Date().getSeconds();
    const roulatieIndex = Math.floor(seconden / 20); // Geeft 0, 1 of 2

    // 1. Zoek alle lessen die NU bezig zijn
    let lessenNu = lessenCache.filter(l => nu >= l.start_tijd && nu < l.eind_tijd);
    let lesNu = lessenNu[roulatieIndex % (lessenNu.length || 1)];

    // 2. Zoek alle lessen die als EERSTVOLGENDE starten
    let alleToekomstig = lessenCache.filter(l => l.start_tijd > nu).sort((a,b) => a.start_tijd.localeCompare(b.start_tijd));
    let eerstvolgendeTijd = alleToekomstig.length > 0 ? alleToekomstig[0].start_tijd : null;
    let lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd);
    let lesNext = lessenNext[roulatieIndex % (lessenNext.length || 1)];

    try {
        if (lesNu) {
            await sendTag("Les_Nu_Naam", lesNu.display_title);
            await sendTag("Les_Nu_Tijd", `${lesNu.start_tijd} - ${lesNu.eind_tijd}`);
            await sendTag("Les_Nu_Bezetting", `BEZETTING: ${lesNu.attendees}/${lesNu.max_places}`);
        } else {
            await sendTag("Les_Nu_Naam", "VRIJ TRAINEN");
            await sendTag("Les_Nu_Tijd", "");
            await sendTag("Les_Nu_Bezetting", "");
        }

        if (lesNext) {
            const vrij = lesNext.max_places - lesNext.attendees;
            await sendTag("Les_Next_Naam", lesNext.display_title);
            await sendTag("Les_Next_Tijd", `${lesNext.start_tijd} - ${lesNext.eind_tijd}`);
            await sendTag("Les_Next_Bezetting", vrij <= 0 ? "VOLGEBOEKT" : `NOG ${vrij} PLEKKEN VRIJ`);
        } else {
            await sendTag("Les_Next_Naam", "GEEN LESSEN MEER");
            await sendTag("Les_Next_Tijd", "");
            await sendTag("Les_Next_Bezetting", "");
        }
    } catch (err) { console.error("Homey Send Error"); }
}

async function sendTag(name, value) {
    if (!HOMEY_URL) return;
    try { await axios.get(`${HOMEY_URL}?tag=${encodeURIComponent(name)}&value=${encodeURIComponent(value)}`); } catch (e) {}
}

app.get('/check', (req, res) => {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;"><h1>YVSPORT Check</h1>`;
    html += `<table border="1" cellpadding="10" style="width:100%; border-collapse:collapse;"><tr><th>Tijd</th><th>Lesnaam</th><th>Bezetting</th></tr>`;
    lessenCache.forEach(l => {
        const isNu = nu >= l.start_tijd && nu < l.eind_tijd;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}"><td>${l.start_tijd}-${l.eind_tijd}</td><td>${l.display_title}</td><td>${l.attendees}/${l.max_places}</td></tr>`;
    });
    res.send(html + "</table></body></html>");
});

app.listen(PORT, () => { 
    syncVirtuagym(); 
    // Start de roulatie-cyclus elke 20 seconden
    setInterval(updateHomeyRotation, 20 * 1000);
});
