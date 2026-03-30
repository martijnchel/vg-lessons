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

// Geheugen om onnodige updates naar Homey te voorkomen
let lastSentData = { nu_naam: "", next_naam: "" };

function scheduleNextSync() {
    const nu = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const tijdDecimaal = nu.getHours() + (nu.getMinutes() / 60);
    const isPiek = (tijdDecimaal >= 6.5 && tijdDecimaal < 12) || (tijdDecimaal >= 17 && tijdDecimaal < 21.5);
    const interval = isPiek ? 300000 : 900000; 

    if (nextSyncTimeout) clearTimeout(nextSyncTimeout);
    nextSyncTimeout = setTimeout(syncVirtuagym, interval);
    console.log(`[${nu.toLocaleTimeString('nl-NL')}] Volgende sync over ${interval/60000} min.`);
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
                let displayTitle = activityNames[e.activity_id] || (e.title ? e.title.toUpperCase() : `NIEUWE LES`);

                return {
                    ...e,
                    is_vandaag: eventDate.getDate() === nuNL.getDate(),
                    display_title: displayTitle,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5),
                    full_start: eventDate
                };
            });
            console.log(`[${new Date().toLocaleTimeString('nl-NL')}] Sync OK.`);
        }
    } catch (e) { console.error("Sync Error"); }
    scheduleNextSync();
}

async function updateHomeyRotation() {
    if (lessenCache.length === 0) return;

    const nuDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
    const nuStr = nuDate.toLocaleTimeString("nl-NL", {hour: '2-digit', minute: '2-digit', hour12: false});
    const roulatieIndex = Math.floor(nuDate.getSeconds() / 20);

    let lessenNu = lessenCache.filter(l => l.is_vandaag && nuStr >= l.start_tijd && nuStr < l.eind_tijd);
    
    // FIX: Gebruik een kleine marge van 10 minuten zodat lessen niet te vroeg uit de lijst vallen
    let alleToekomstig = lessenCache
        .filter(l => l.full_start.getTime() > (nuDate.getTime() - 600000))
        .sort((a,b) => a.full_start - b.full_start);
    
    let eerstvolgendeTijd = alleToekomstig.length > 0 ? alleToekomstig[0].start_tijd : null;
    let eerstvolgendeDatum = alleToekomstig.length > 0 ? alleToekomstig[0].is_vandaag : true;
    let lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd && l.is_vandaag === eerstvolgendeDatum);

    let tweedeLes = alleToekomstig.find(l => l.start_tijd !== eerstvolgendeTijd || l.is_vandaag !== eerstvolgendeDatum);
    let lessenAfterNext = tweedeLes ? alleToekomstig.filter(l => l.start_tijd === tweedeLes.start_tijd && l.is_vandaag === tweedeLes.is_vandaag) : [];

    let data = {
        nu_status: "VRIJ", 
        nu_naam: "*VRIJ TRAINEN*", 
        nu_tijd: "", 
        nu_vrij: 0,
        next_naam: "*GEEN LESSEN*", 
        next_tijd: "", 
        next_bezetting: ""
    };

    if (lessenNu.length > 0) {
        let l = lessenNu[roulatieIndex % lessenNu.length];
        data.nu_status = "LIVE"; 
        data.nu_naam = `*${l.
