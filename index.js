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
            console.log(`[${new Date().toLocaleTimeString('nl-NL')}] Sync OK.`);
        }
    } catch (e) { console.error("Sync Error:", e.message); }
    scheduleNextSync();
}

function scheduleNextSync() {
    const nu = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const tijdDecimaal = nu.getHours() + (nu.getMinutes() / 60);
    const isPiek = (tijdDecimaal >= 6.5 && tijdDecimaal < 12) || (tijdDecimaal >= 17 && tijdDecimaal < 21.5);
    if (nextSyncTimeout) clearTimeout(nextSyncTimeout);
    nextSyncTimeout = setTimeout(syncVirtuagym, isPiek ? 300000 : 900000);
}

async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nuDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const nuStr = nuDate.toLocaleTimeString("nl-NL", {hour: '2-digit', minute: '2-digit', hour12: false});
    const roulatieIndex = Math.floor(nuDate.getSeconds() / 20);

    let lessenNu = lessenCache.filter(l => l.is_vandaag && nuStr >= l.start_tijd && nuStr < l.eind_tijd);
    let alleToekomstig = lessenCache.filter(l => l.full_start > nuDate).sort((a,b) => a.full_start - b.full_start);
    
    let eerstvolgendeTijd = alleToekomstig.length > 0 ? alleToekomstig[0].start_tijd : null;
    let eerstvolgendeDatum = alleToekomstig.length > 0 ? alleToekomstig[0].is_vandaag : true;
    let lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd && l.is_vandaag === eerstvolgendeDatum);

    let tweedeLes = alleToekomstig.find(l => l.start_tijd !== eerstvolgendeTijd || l.is_vandaag !== eerstvolgendeDatum);
    let lessenAfterNext = tweedeLes ? alleToekomstig.filter(l => l.start_tijd === tweedeLes.start_tijd && l.is_vandaag === tweedeLes.is_vandaag) : [];

    let data = {
        nu_status: "VRIJ", nu_naam: "VRIJ TRAINEN", nu_tijd: "", nu_promo_bezetting: "",
        next_naam: "GEEN LESSEN", next_tijd: "", next_bezetting: ""
    };

    // BOVENSTE VAK LOGICA
    if (lessenNu.length > 0) {
        let l = lessenNu[roulatieIndex % lessenNu.length];
        data.nu_status = "LIVE"; 
        data.nu_naam = l.display_title; 
        data.nu_tijd = `${l.start_tijd} - ${l.eind_tijd}`;
        data.nu_promo_bezetting = ""; // Altijd leeg bij LIVE les
    } else if (eerstvolgendeTijd && eerstvolgendeDatum) {
        const diff = Math.round((alleToekomstig[0].full_start - nuDate.getTime()) / 1000 / 60);
        if (diff <= 60) {
            let l = lessenNext[roulatieIndex % lessenNext.length];
            const vrij = l.max_places - l.attendees;
            data.nu_status = "VOLGENDE"; 
            data.nu_naam = l.display_title; 
            data.nu_tijd = `${l.start_tijd} - ${l.eind_tijd}`;
            data.nu_promo_bezetting = vrij <= 0 ? "VOLGEBOEKT" : `NOG ${vrij} PLEKKEN VRIJ`;
        }
    }

    // ONDERSTE VAK LOGICA
    let bron = (lessenNu.length > 0 || data.nu_status === "VOLGENDE") ? (lessenAfterNext.length > 0 ? lessenAfterNext : lessenNext) : lessenNext;
    if (bron && bron.length > 0) {
        let l = bron[roulatieIndex % bron.length];
        const vrij = l.max_places - l.attendees;
        data.next_naam = l.display_title; 
        data.next_tijd = (l.is_vandaag ? "" : "MORGEN ") + `${l.start_tijd} - ${l.eind_tijd}`;
        data.next_bezetting = vrij <= 0 ? "VOLGEBOEKT" : `NOG ${vrij} PLEKKEN VRIJ`;
    }

    if (HOMEY_URL) {
        try { await axios.get(HOMEY_URL, { params: { tag: "yvsport_data", value: JSON.stringify(data) } }); } 
        catch (e) { console.error("Homey Webhook Error"); }
    }
}

app.get('/check', (req, res) => {
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;"><h1>YVSPORT Monitor</h1><table border="1" cellpadding="10" style="border-collapse:collapse; width:100%;">`;
    lessenCache.forEach(l => {
        html += `<tr><td>${l.is_vandaag ? 'VANDAAG' : 'MORGEN'}</td><td>${l.start_tijd}</td><td>${l.display_title}</td><td>${l.attendees}/${l.max_places}</td></tr>`;
    });
    res.send(html + "</table></body></html>");
});

app.listen(PORT, () => { syncVirtuagym(); setInterval(updateHomeyRotation, 20000); });
