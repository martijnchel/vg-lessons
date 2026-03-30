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
                const t = e.start.split(/[- :]/);
                const d = new Date(t[0], t[1]-1, t[2], t[3], t[4]); 
                return {
                    ...e,
                    full_start: d,
                    datum_str: e.start.split(' ')[0],
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5),
                    display_title: activityNames[e.activity_id] || (e.title ? e.title.toUpperCase() : `LES`)
                };
            });
            console.log(`[${nuNL.toLocaleTimeString()}] Sync OK: ${lessenCache.length} lessen.`);
        }
    } catch (e) { console.error("Sync Error"); }
    
    const nu = getAmsterdamNow();
    const tijd = nu.getHours() + (nu.getMinutes() / 60);
    const interval = ((tijd >= 6.5 && tijd < 12) || (tijd >= 17 && tijd < 21.5)) ? 300000 : 900000;
    setTimeout(syncVirtuagym, interval);
}

async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nuDate = getAmsterdamNow();
    const nuStr = nuDate.toLocaleTimeString("nl-NL", {hour: '2-digit', minute: '2-digit', hour12: false});
    const vandaagStr = nuDate.toISOString().split('T')[0];
    const roulatieIndex = Math.floor(nuDate.getSeconds() / 20);

    // FIX: Filter niet op milliseconden, maar op alles wat nog niet afgelopen is VANDAAG of MORGEN
    let alleToekomstig = lessenCache
        .filter(l => {
            if (l.datum_str > vandaagStr) return true; // Alles van morgen/overmorgen is toekomst
            return l.eind_tijd > nuStr; // Vandaag: alleen als de eindtijd nog niet bereikt is
        })
        .sort((a, b) => a.full_start - b.full_start);

    if (alleToekomstig.length === 0) return;

    const eerstvolgendeTijd = alleToekomstig[0].start_tijd;
    const eerstvolgendeDatum = alleToekomstig[0].datum_str;
    const lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd && l.datum_str === eerstvolgendeDatum);
    
    const rest = alleToekomstig.filter(l => l.start_tijd !== eerstvolgendeTijd || l.datum_str !== eerstvolgendeDatum);
    const lessenAfterNext = rest.length > 0 ? rest.filter(l => l.start_tijd === rest[0].start_tijd && l.datum_str === rest[0].datum_str) : [];

    let lessenNu = lessenCache.filter(l => l.datum_str === vandaagStr && nuStr >= l.start_tijd && nuStr < l.eind_tijd);

    let data = {
        nu_status: "VRIJ", nu_naam: "*VRIJ TRAINEN*", nu_tijd: "", nu_vrij: 0,
        next_naam: "*GEEN LESSEN*", next_tijd: "", next_bezetting: ""
    };

    // Bovenste blok
    if (lessenNu.length > 0) {
        let l = lessenNu[roulatieIndex % lessenNu.length];
        data.nu_status = "LIVE";
        data.nu_naam = `*${l.display_title}*`;
        data.nu_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
    } else {
        const diff = Math.round((alleToekomstig[0].full_start - nuDate.getTime()) / 1000 / 60);
        if (diff <= 60 && diff > -5) { // Extra marge voor lessen die net gestart zijn
            let l = lessenNext[roulatieIndex % lessenNext.length];
            data.nu_status = "VOLGENDE";
            data.nu_naam = `*${l.display_title}*`;
            data.nu_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
            data.nu_vrij = Math.min(9, Math.max(0, l.max_places - l.attendees));
        }
    }

    // Onderste blok: Altijd de volgende groep die niet bovenin staat
    let bron = (data.nu_status === "LIVE" || data.nu_status === "VOLGENDE") ? lessenAfterNext : lessenNext;
    
    if (bron && bron.length > 0) {
        let l = bron[roulatieIndex % bron.length];
        let v = Math.min(9, Math.max(0, l.max_places - l.attendees));
        data.next_naam = `*${l.display_title}*`;
        data.next_tijd = `*${l.start_tijd} - ${l.eind_tijd}*`;
        data.next_bezetting = v <= 0 ? "*VOLGEBOEKT*" : (v === 1 ? "*NOG 1 PLEK VRIJ*" : `*NOG ${v} PLEKKEN VRIJ*`);
    }

    if (data.nu_naam !== lastSentData.nu_naam || data.next_naam !== lastSentData.next_naam || (bron && bron.length > 1)) {
        if (HOMEY_URL) {
            try {
                await axios.get(HOMEY_URL, { params: { tag: JSON.stringify(data) } });
                lastSentData = { nu_naam: data.nu_naam, next_naam: data.next_naam };
            } catch (e) { console.error("Homey Error"); }
        }
    }
}

app.listen(PORT, () => {
    syncVirtuagym();
    setInterval(updateHomeyRotation, 20000);
});
