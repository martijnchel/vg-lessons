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
        const end = start + (2 * 24 * 60 * 60) - 1; 

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, timestamp_start: start, timestamp_end: end }
        });

        if (response.data && response.data.result) {
            lessenCache = response.data.result.filter(e => e.canceled === false).map(e => {
                const eventDate = new Date(e.start);
                return {
                    ...e,
                    is_vandaag: eventDate.getDate() === nuNL.getDate(),
                    display_title: e.title || activityNames[e.activity_id] || "Extra groepsles",
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5),
                    full_start: eventDate
                };
            });
            console.log(`[${new Date().toLocaleTimeString('nl-NL', {timeZone: 'Europe/Amsterdam'})}] Sync OK.`);
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

async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nuDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const nuStr = nuDate.toLocaleTimeString("nl-NL", {hour: '2-digit', minute: '2-digit', hour12: false});
    const seconden = nuDate.getSeconds();
    const roulatieIndex = Math.floor(seconden / 20);

    let lessenNu = lessenCache.filter(l => l.is_vandaag && nuStr >= l.start_tijd && nuStr < l.eind_tijd);
    let alleToekomstig = lessenCache.filter(l => l.full_start > nuDate).sort((a,b) => a.full_start - b.full_start);
    
    let eerstvolgendeTijd = alleToekomstig.length > 0 ? alleToekomstig[0].start_tijd : null;
    let eerstvolgendeDatum = alleToekomstig.length > 0 ? alleToekomstig[0].is_vandaag : true;
    let lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd && l.is_vandaag === eerstvolgendeDatum);

    let tweedeLes = alleToekomstig.find(l => l.start_tijd !== eerstvolgendeTijd || l.is_vandaag !== eerstvolgendeDatum);
    let lessenAfterNext = tweedeLes ? alleToekomstig.filter(l => l.start_tijd === tweedeLes.start_tijd && l.is_vandaag === tweedeLes.is_vandaag) : [];

    try {
        // --- BOVENSTE VAK ---
        if (lessenNu.length > 0) {
            let lesNu = lessenNu[roulatieIndex % lessenNu.length];
            await sendTag("Les_Nu_Status", "LIVE");
            await sendTag("Les_Nu_Naam", lesNu.display_title);
            await sendTag("Les_Nu_Tijd", `${lesNu.start_tijd} - ${lesNu.eind_tijd}`);
            await sendTag("Les_Nu_Bezetting", `BEZETTING: ${lesNu.attendees}/${lesNu.max_places}`);
        } else if (eerstvolgendeTijd && eerstvolgendeDatum) {
            const diff = (alleToekomstig[0].full_start - nuDate.getTime()) / 1000 / 60;
            if (diff <= 60) {
                let lesPromoot = lessenNext[roulatieIndex % lessenNext.length];
                await sendTag("Les_Nu_Status", "VOLGENDE");
                await sendTag("Les_Nu_Naam", lesPromoot.display_title);
                await sendTag("Les_Nu_Tijd", `${lesPromoot.start_tijd} - ${lesPromoot.eind_tijd}`);
                await sendTag("Les_Nu_Bezetting", `START OVER ${Math.round(diff)} MIN`);
            } else {
                await sendTag("Les_Nu_Status", "VRIJ");
                await sendTag("Les_Nu_Naam", "VRIJ TRAINEN");
                await sendTag("Les_Nu_Tijd", ""); // TIJD LEEG BIJ VRIJ TRAINEN
                await sendTag("Les_Nu_Bezetting", ""); // BEZETTING LEEG BIJ VRIJ TRAINEN
            }
        } else {
            await sendTag("Les_Nu_Status", "VRIJ");
            await sendTag("Les_Nu_Naam", "VRIJ TRAINEN");
            await sendTag("Les_Nu_Tijd", "");
            await sendTag("Les_Nu_Bezetting", "");
        }

        // --- ONDERSTE VAK ---
        let bronLijst = (lessenNu.length > 0 || (eerstvolgendeDatum && (alleToekomstig[0].full_start - nuDate.getTime()) / 1000 / 60 <= 60)) 
                        ? lessenNext : (lessenAfterNext.length > 0 ? lessenAfterNext : lessenNext);
        
        if (bronLijst && bronLijst.length > 0) {
            let lesOnder = bronLijst[roulatieIndex % bronLijst.length];
            const vrij = lesOnder.max_places - lesOnder.attendees;
            const prefix = lesOnder.is_vandaag ? "" : "MORGEN ";
            
            await sendTag("Les_Next_Naam", lesOnder.display_title);
            await sendTag("Les_Next_Tijd", `${prefix}${lesOnder.start_tijd} - ${lesOnder.eind_tijd}`);
            await sendTag("Les_Next_Bezetting", vrij <= 0 ? "VOLGEBOEKT" : `NOG ${vrij} PLEKKEN VRIJ`);
        } else {
            await sendTag("Les_Next_Naam", "GEEN LESSEN GEPLAND");
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
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;"><h1>YVSPORT Check (48u)</h1><table border="1" cellpadding="10" style="width:100%; border-collapse:collapse;">`;
    lessenCache.forEach(l => {
        html += `<tr><td>${l.is_vandaag ? 'VANDAAG' : 'MORGEN'}</td><td>${l.start_tijd}-${l.eind_tijd}</td><td>${l.display_title}</td><td>${l.attendees}/${l.max_places}</td></tr>`;
    });
    res.send(html + "</table></body></html>");
});

app.listen(PORT, () => { 
    syncVirtuagym(); 
    setInterval(updateHomeyRotation, 20 * 1000);
});
