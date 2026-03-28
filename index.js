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

// --- DATABASE: INSTRUCTEURS ---
// Vul hier de namen aan zodra je ze ziet op /check
const instructorNames = {
    "16925839": "Instructeur A", 
    "13932460": "Instructeur B",
    "33449952": "Instructeur C",
    "33453831": "Instructeur D"
};

let lessenCache = [];

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
                const docent = instructorNames[e.instructor_id] || `Trainer (${e.instructor_id})`;
                
                return {
                    ...e,
                    display_title: naam,
                    display_instructor: docent,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            if (HOMEY_URL) updateHomey();
        }
    } catch (e) { console.error("Sync Error:", e.message); }
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
            await sendTag("Les_Nu_Trainer", lesNu.display_instructor);
        } else {
            await sendTag("Les_Nu_Naam", "VRIJ TRAINEN");
            await sendTag("Les_Nu_Bezetting", "");
            await sendTag("Les_Nu_Trainer", "");
        }

        if (lesNext) {
            const vrij = lesNext.max_places - lesNext.attendees;
            await sendTag("Les_Next_Naam", lesNext.display_title);
            await sendTag("Les_Next_Tijd", `OM ${lesNext.start_tijd} UUR`);
            await sendTag("Les_Next_Bezetting", vrij <= 0 ? "VOLGEBOEKT" : `NOG ${vrij} PLEKKEN VRIJ`);
            await sendTag("Les_Next_Trainer", lesNext.display_instructor);
        }
    } catch (err) { console.error("Homey Send Error"); }
}

async function sendTag(name, value) {
    if (!HOMEY_URL) return;
    await axios.get(`${HOMEY_URL}?tag=${encodeURIComponent(name)}&value=${encodeURIComponent(value)}`);
}

app.get('/check', (req, res) => {
    const nu = new Date().toLocaleTimeString("nl-NL", {timeZone: "Europe/Amsterdam", hour: '2-digit', minute: '2-digit', hour12: false});
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">`;
    html += `<h1>YVSPORT Dashboard Check</h1><p>Tijd: ${nu}</p><table border="1" cellpadding="10" style="width:100%; border-collapse:collapse;">`;
    html += `<tr><th>Tijd</th><th>Lesnaam</th><th>Trainer</th><th>Bezetting</th></tr>`;
    lessenCache.forEach(l => {
        const isNu = nu >= l.start_tijd && nu < l.eind_tijd;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}"><td>${l.start_tijd}</td><td>${l.display_title}</td><td>${l.display_instructor}</td><td>${l.attendees}/${l.max_places}</td></tr>`;
    });
    res.send(html + "</table></body></html>");
});

app.get('/scan', (req, res) => res.redirect('/check')); // Scan is niet meer nodig, maar we houden de route voor de zekerheid

app.listen(PORT, () => {
    syncVirtuagym();
    setInterval(syncVirtuagym, 5 * 60 * 1000);
});
