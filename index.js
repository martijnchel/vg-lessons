const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

// --- DATABASE: LESSEN ---
const activityNames = {
    "595083": "Buikspierkwartier",
    "595096": "SportYV wandelend",
    "594693": "Spinning",
    "594694": "Pilates",
    "595082": "Boksfit",
    "589058": "Fitcircuit",
    "594700": "50-Fit",
    "595091": "HIIT",
    "594697": "Spinning",
    "594699": "Flow Yoga",
    "595095": "60+ Kracht en Balans",
    "594706": "BodyBalance",
    "594704": "BBB",
    "594703": "Gentle Flow Yoga",
    "594695": "Zumba",
    "594701": "BodyShape",
    "594707": "Vinyasa Yoga"
};

let lessenCache = [];
let nextTimeout;

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
                const naam = e.title || activityNames[e.activity_id] || "Extra groepsles";
                return {
                    ...e,
                    display_title: naam,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            console.log(`[${new Date().toLocaleTimeString('nl-NL', {timeZone: 'Europe/Amsterdam'})}] Sync voltooid.`);
            if (HOMEY_URL) updateHomey();
        }
    } catch (e) { console.error("Sync Error:", e.message); }
    
    // Plan de volgende update in op basis van de tijd
    scheduleNextUpdate();
}

function scheduleNextUpdate() {
    const nu = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const uren = nu.getHours();
    const minuten = nu.getMinutes();
    const tijdDecimaal = uren + (minuten / 60);

    let intervalMs;

    // Piekuren: 06:30 - 12:00 OF 17:00 - 21:30
    const isOchtendPiek = (tijdDecimaal >= 6.5 && tijdDecimaal < 12);
    const isAvondPiek = (tijdDecimaal >= 17 && tijdDecimaal < 21.5);

    if (isOchtendPiek || isAvondPiek) {
        intervalMs = 5 * 60 * 1000; // 5 minuten
        console.log("Piekuren: Volgende update over 5 minuten.");
    } else {
        intervalMs = 15 * 60 * 1000; // 15 minuten
        console.log("Daluur: Volgende update over 15 minuten.");
    }

    // Voorkom dubbele timeouts
    if (nextTimeout) clearTimeout(nextTimeout);
    nextTimeout = setTimeout(syncVirtuagym, intervalMs);
}

async function updateHomey() {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    
    let lessenNu = lessenCache.filter(l => nu >= l.start_tijd && nu < l.eind_tijd);
    let roulatieIndex = new Date().getMinutes() % (lessenNu.length || 1);
    let lesNu = lessenNu[roulatieIndex];

    let lesNext = lessenCache.filter(l => l.start_tijd > nu).sort((a,b) => a.start_tijd.localeCompare(b.start_tijd))[0];

    try {
        if (lesNu) {
            await sendTag("Les_Nu_Naam", lesNu.display_title);
            await sendTag("Les_Nu_Bezetting", `BEZETTING: ${lesNu.attendees}/${lesNu.max_places}`);
        } else {
            await sendTag("Les_Nu_Naam", "VRIJ TRAINEN");
            await sendTag("Les_Nu_Bezetting", "");
        }

        if (lesNext) {
            const vrij = lesNext.max_places - lesNext.attendees;
            await sendTag("Les_Next_Naam", lesNext.display_title);
            await sendTag("Les_Next_Tijd", `OM ${lesNext.start_tijd} UUR`);
            await sendTag("Les_Next_Bezetting", vrij <= 0 ? "VOLGEBOEKT" : `NOG ${vrij} PLEKKEN VRIJ`);
        }
    } catch (err) { console.error("Homey Send Error"); }
}

async function sendTag(name, value) {
    if (!HOMEY_URL) return;
    try {
        await axios.get(`${HOMEY_URL}?tag=${encodeURIComponent(name)}&value=${encodeURIComponent(value)}`);
    } catch (e) { /* Negeer Homey fouten */ }
}

app.get('/check', (req, res) => {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">`;
    html += `<h1>YVSPORT Dashboard Check</h1><p>Tijd: ${nu}</p><table border="1" cellpadding="10" style="width:100%; border-collapse:collapse;">`;
    html += `<tr><th>Tijd</th><th>Lesnaam</th><th>Bezetting</th></tr>`;
    lessenCache.forEach(l => {
        const isNu = nu >= l.start_tijd && nu < l.eind_tijd;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}"><td>${l.start_tijd}</td><td>${l.display_title}</td><td>${l.attendees}/${l.max_places}</td></tr>`;
    });
    res.send(html + "</table></body></html>");
});

app.listen(PORT, () => {
    console.log(`Server gestart op poort ${PORT}`);
    syncVirtuagym(); // Start de eerste sync direct
});
