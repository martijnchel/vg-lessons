const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const UPDATE_INTERVAL_MS = 5 * 60 * 1000; 

const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

let lessenCache = [];
let activityMap = {}; // Hier slaan we de ID -> Naam koppeling op

// 1. Haal de namen van ALLE activiteiten op
async function fetchActivityDefinitions() {
    try {
        const response = await axios.get(`https://api.virtuagym.com/api/v0/activity/definition`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET }
        });
        if (response.data && response.data.result) {
            response.data.result.forEach(def => {
                activityMap[def.id] = def.name;
            });
            console.log(`[INIT] ${Object.keys(activityMap).length} activiteit-namen geladen.`);
        }
    } catch (e) {
        console.error("Fout bij ophalen definities:", e.message);
    }
}

// 2. Haal de actuele lessen op
async function syncVirtuagym() {
    try {
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
                // Gebruik e.title als die er is, anders de naam uit de activityMap, anders fallback
                const naam = e.title || activityMap[e.activity_id] || "Groepsles";
                return {
                    ...e,
                    display_title: naam,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            console.log(`[SYNC] ${lessenCache.length} lessen bijgewerkt.`);
            
            // Als alles klopt, stuur de boel naar Homey
            if (HOMEY_URL) updateHomey();
        }
    } catch (e) { console.error("Sync Error:", e.message); }
}

// 3. De logica voor het dashboard (Nu/Next)
async function updateHomey() {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    
    // NU BEZIG
    let lessenNu = lessenCache.filter(l => nu >= l.start_tijd && nu < l.eind_tijd);
    let roulatieIndex = new Date().getMinutes() % (lessenNu.length || 1);
    let lesNu = lessenNu[roulatieIndex];

    // VOLGENDE
    let lesNext = lessenCache.filter(l => l.start_tijd > nu).sort((a,b) => a.start_tijd.localeCompare(b.start_tijd))[0];

    try {
        if (lesNu) {
            await sendTag("Les_Nu_Naam", lesNu.display_title);
            await sendTag("Les_Nu_Bezetting", `${lesNu.attendees}/${lesNu.max_places}`);
        }
        if (lesNext) {
            await sendTag("Les_Next_Naam", lesNext.display_title);
            await sendTag("Les_Next_Tijd", `OM ${lesNext.start_tijd} UUR`);
            await sendTag("Les_Next_Bezetting", `NOG ${lesNext.max_places - lesNext.attendees} PLEKKEN`);
        }
    } catch (err) { console.error("Homey Send Error"); }
}

async function sendTag(name, value) {
    await axios.get(`${HOMEY_URL}?tag=${encodeURIComponent(name)}&value=${encodeURIComponent(value)}`);
}

// Routes voor controle
app.get('/check', (req, res) => {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">`;
    html += `<h1>YVSPORT Lessons</h1><p>Tijd (NL): ${nu}</p><table border="1" cellpadding="10" style="width:100%; border-collapse:collapse;">`;
    html += `<tr><th>Tijd</th><th>Lesnaam</th><th>Bezetting</th><th>Status</th></tr>`;
    lessenCache.forEach(l => {
        const isNu = nu >= l.start_tijd && nu < l.eind_tijd;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}"><td>${l.start_tijd}</td><td>${l.display_title}</td><td>${l.attendees}/${l.max_places}</td><td>${isNu ? 'NU' : (nu > l.eind_tijd ? 'KLAAR' : 'WACHT')}</td></tr>`;
    });
    res.send(html + "</table></body></html>");
});

app.listen(PORT, async () => {
    console.log("Server online.");
    await fetchActivityDefinitions(); // Haal eerst de namen op!
    syncVirtuagym();
    setInterval(syncVirtuagym, UPDATE_INTERVAL_MS);
});
