const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

const activityNames = {
    "595083": "BUIKSPIERKWARTIER", "595096": "SPORTYV WANDELEN", "594693": "SPINNING",
    "594694": "PILATES", "595082": "BOKSFIT", "589058": "FITCIRCUIT",
    "594700": "50-FIT", "595091": "HIIT", "594697": "BODYPUMP",
    "594699": "FLOW YOGA", "595095": "60+ KRACHT EN BALANS", "594706": "BODYBALANCE",
    "594704": "BBB", "594703": "GENTLE FLOW YOGA", "594695": "ZUMBA",
    "594701": "BODYSHAPE", "594707": "VINYASA YOGA", "594696": "BOOTCAMP"
};

let lessenCache = [];
let nextSyncTimeout;
let lastSentData = { nu_naam: "", next_naam: "" };

function getAmsterdamNow() {
    return new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
}

async function syncVirtuagym() {
    try {
        const nuNL = getAmsterdamNow();
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
                    display_title: activityNames[e.activity_id] || (e.title ? e.title.toUpperCase() : `NIEUWE LES`),
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5),
                    full_start: eventDate
                };
            });
            console.log(`[${nuNL.toLocaleTimeString()}] Sync OK. ${lessenCache.length} lessen gevonden.`);
        }
    } catch (e) { console.error("Sync Error"); }
    
    // Interval bepalen
    const nu = getAmsterdamNow();
    const tijd = nu.getHours() + (nu.getMinutes() / 60);
    const interval = ((tijd >= 6.5 && tijd < 12) || (tijd >= 17 && tijd < 21.5)) ? 300000 : 900000;
    setTimeout(syncVirtuagym, interval);
}

async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nuDate = getAmsterdamNow();
    const nuStr = nuDate.toLocaleTimeString("nl-NL", {hour: '2-digit', minute: '2-digit', hour12: false});
    const roulatieIndex = Math.floor(nuDate.getSeconds() / 20);

    // Filter alle lessen die vandaag nog moeten komen of morgen gepland staan (marge van 1 uur)
    let alleToekomstig = lessenCache
        .filter(l => l.full_start.getTime() > (nuDate.getTime() - 3600000))
        .sort((a,b) => a.full_start - b.full_start);

    let lessenNu = lessenCache.filter(l => l.is_vandaag && nuStr >= l.start_tijd && nuStr < l.eind_tijd);
    
    let eerstvolgendeTijd = alleToekomstig.length > 0 ? alleToekomstig[0].start_tijd : null;
    let eerstvolgendeDatum = alleToekomstig.length > 0 ? alleToekomstig[0].is_vandaag : true;
    let lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd && l.is_vandaag === eerstvolgendeDatum);

    let rest = alleToekomstig.filter(l => l.start_tijd !== eerstvolgendeTijd || l.is_vandaag !== eerstvolgendeDatum);
    let lessenAfterNext = rest.length > 0 ? rest.filter(l => l.start_tijd === rest[0].start_tijd && l.is_vandaag === rest[0].is_vandaag) : [];

    let data = {
        nu_status: "VRIJ", nu_naam: "*VRIJ TRAINEN*", nu_tijd: "", nu_vrij: 0,
        next_naam: "*GEEN LESSEN*", next_tijd: "", next_bezetting: ""
    };

    if (lessenNu.length > 0) {
        let l = lessenNu[roulatieIndex % lessenNu.length];
        data.nu_status = "LIVE"; 
        data.nu_naam = `*${l.display_title}*`;
        data.nu_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
    } else if (alleToekomstig.length > 0) {
        const diff = Math.round((alleToekomstig[0].full_start - nuDate.getTime()) / 1000 / 60);
        if (diff <= 60) {
            let l = lessenNext[roulatieIndex % lessenNext.length];
            data.nu_status = "VOLGENDE"; 
            data.nu_naam = `*${l.display_title}*`;
            data.nu_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
            data.nu_vrij = Math.min(9, Math.max(0, l.max_places - l.attendees));
        }
    }

    let bron = (data.nu_status === "LIVE" || data.nu_status === "VOLGENDE") ? (lessenAfterNext.length > 0 ? lessenAfterNext : lessenNext) : lessenNext;
    if (bron && bron.length > 0) {
        let l = bron[roulatieIndex % bron.length];
        let v = Math.min(9, Math.max(0, l.max_places - l.attendees));
        data.next_naam = `*${l.display_title}*`; 
        data.next_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
        let b_tekst = v <= 0 ? "VOLGEBOEKT" : (v === 1 ? "NOG 1 PLEK VRIJ" : `NOG ${v} PLEKKEN VRIJ`);
        data.next_bezetting = `*${b_tekst}*`;
    }

    // UPDATE CHECK: We sturen het nu ALTIJD naar Homey als er lessen in de cache zitten
    // Dit dwingt de cache om leeg te spoelen.
    if (HOMEY_URL) {
        try { 
            await axios.get(HOMEY_URL, { params: { tag: JSON.stringify(data) } }); 
            console.log(`[${nuDate.toLocaleTimeString()}] Update: ${data.nu_naam} | ${data.next_naam}`);
        } catch (e) { console.error("Homey Error"); }
    }
}

app.listen(PORT, () => {
    syncVirtuagym();
    setInterval(updateHomeyRotation, 20000);
});
