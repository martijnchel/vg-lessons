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

app.get('/check', (req, res) => {
    const nu = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const morgen = new Date(nu.getTime() + (24 * 60 * 60 * 1000));
    const overzicht = lessenCache
        .filter(l => l.full_start >= nu && l.full_start <= morgen)
        .map(l => ({
            tijd: l.start_tijd,
            naam: l.display_title,
            vandaag: l.is_vandaag,
            timestamp: l.full_start
        }));
    res.json({ systeem_tijd: nu.toLocaleTimeString('nl-NL'), lessen_gevonden: overzicht.length, rooster: overzicht });
});

function scheduleNextSync() {
    const nu = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const tijdDecimaal = nu.getHours() + (nu.getMinutes() / 60);
    const isPiek = (tijdDecimaal >= 6.5 && tijdDecimaal < 12) || (tijdDecimaal >= 17 && tijdDecimaal < 21.5);
    const interval = isPiek ? 300000 : 900000; 
    if (nextSyncTimeout) clearTimeout(nextSyncTimeout);
    nextSyncTimeout = setTimeout(syncVirtuagym, interval);
}

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
                const endDate = new Date(e.end);
                return {
                    ...e,
                    is_vandaag: eventDate.getDate() === nuNL.getDate(),
                    display_title: activityNames[e.activity_id] || (e.title ? e.title.toUpperCase() : `NIEUWE LES`),
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5),
                    full_start: eventDate,
                    full_end: endDate
                };
            });
            console.log(`[${new Date().toLocaleTimeString('nl-NL')}] Sync OK. ${lessenCache.length} lessen in cache.`);
        }
    } catch (e) { console.error("Sync Error"); }
    scheduleNextSync();
}

async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nuDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const roulatieIndex = Math.floor(nuDate.getSeconds() / 20);

    // 1. Wat is er nu LIVE
    let lessenNu = lessenCache.filter(l => nuDate >= l.full_start && nuDate < l.full_end);
    
    // 2. Wat is de toekomst
    let alleToekomstig = lessenCache
        .filter(l => l.full_start > nuDate)
        .sort((a,b) => a.full_start - b.full_start);
    
    let eerstvolgendeFullStart = alleToekomstig.length > 0 ? alleToekomstig[0].full_start : null;

    let data = {
        nu_status: "VRIJ", nu_naam: "*VRIJ TRAINEN*", nu_tijd: "", nu_vrij: 0,
        next_naam: "*GEEN LESSEN*", next_tijd: "", next_bezetting: ""
    };

    // --- BOVENSTE BLOK ---
    let getoondBovenTijdstip = null;

    if (lessenNu.length > 0) {
        let l = lessenNu[roulatieIndex % lessenNu.length];
        data.nu_status = "LIVE"; 
        data.nu_naam = `*${l.display_title}*`;
        data.nu_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
        getoondBovenTijdstip = l.full_start.getTime();
    } else if (eerstvolgendeFullStart) {
        const diff = Math.round((eerstvolgendeFullStart - nuDate.getTime()) / 1000 / 60);
        if (diff <= 60) {
            let lessenNext = alleToekomstig.filter(l => l.full_start.getTime() === eerstvolgendeFullStart.getTime());
            let l = lessenNext[roulatieIndex % lessenNext.length];
            data.nu_status = "VOLGENDE"; 
            data.nu_naam = `*${l.display_title}*`;
            data.nu_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
            data.nu_vrij = Math.min(9, Math.max(0, l.max_places - l.attendees));
            getoondBovenTijdstip = eerstvolgendeFullStart.getTime();
        }
    }

    // --- ONDERSTE BLOK ---
    // Filter alle lessen die al in het bovenste blok getoond worden (op basis van starttijd)
    let bronLessen = alleToekomstig;
    if (getoondBovenTijdstip) {
        bronLessen = alleToekomstig.filter(l => l.full_start.getTime() > getoondBovenTijdstip);
    }

    if (bronLessen.length > 0) {
        let volgendeMoment = bronLessen[0].full_start.getTime();
        let displayLessen = bronLessen.filter(l => l.full_start.getTime() === volgendeMoment);
        
        let l = displayLessen[roulatieIndex % displayLessen.length];
        let v = Math.min(9, Math.max(0, l.max_places - l.attendees));
        data.next_naam = `*${l.display_title}*`; 
        data.next_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
        let b_tekst = v <= 0 ? "VOLGEBOEKT" : (v === 1 ? "NOG 1 PLEK VRIJ" : `NOG ${v} PLEKKEN VRIJ`);
        data.next_bezetting = `*${b_tekst}*`;
    }

    // --- VERZENDEN ---
    const naamVeranderd = (data.nu_naam !== lastSentData.nu_naam || data.next_naam !== lastSentData.next_naam);
    const moetRoulatie = (lessenNu.length > 1 || (getoondBovenTijdstip && alleToekomstig.filter(l => l.full_start.getTime() === getoondBovenTijdstip).length > 1));

    if (naamVeranderd || moetRoulatie) {
        if (HOMEY_URL) {
            try { 
                await axios.get(HOMEY_URL, { params: { tag: JSON.stringify(data) } }); 
                lastSentData = { nu_naam: data.nu_naam, next_naam: data.next_naam };
                console.log(`[${nuDate.toLocaleTimeString('nl-NL')}] Update: ${data.nu_naam} | ${data.next_naam}`);
            } catch (e) { console.error("Homey Error"); }
        }
    }
}

app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
    syncVirtuagym();
    setInterval(updateHomeyRotation, 20000);
});
