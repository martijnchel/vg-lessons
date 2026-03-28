const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const { CLUB_ID, API_KEY, CLUB_SECRET, HOMEY_URL } = process.env;

const activityNames = {
    "595083": "BUIKSPIERKWARTIER", "595096": "SPORTYV WANDELEN", "594693": "SPINNING",
    "594694": "PILATES", "595082": "BOKSFIT", "589058": "FITCIRCUIT",
    "594700": "50-FIT", "595091": "HIIT", "594697": "SPINNING",
    "594699": "FLOW YOGA", "595095": "60+ KRACHT EN BALANS", "594706": "BODYBALANCE",
    "594704": "BBB", "594703": "GENTLE FLOW YOGA", "594695": "ZUMBA",
    "594701": "BODYSHAPE", "594707": "VINYASA YOGA"
};

let lessenCache = [];
let nextSyncTimeout;

// Geheugen om onnodige updates te voorkomen
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
    let alleToekomstig = lessenCache.filter(l => l.full_start > nuDate).sort((a,b) => a.full_start - b.full_start);
    
    let eerstvolgendeTijd = alleToekomstig.length > 0 ? alleToekomstig[0].start_tijd : null;
    let eerstvolgendeDatum = alleToekomstig.length > 0 ? alleToekomstig[0].is_vandaag : true;
    let lessenNext = alleToekomstig.filter(l => l.start_tijd === eerstvolgendeTijd && l.is_vandaag === eerstvolgendeDatum);

    let tweedeLes = alleToekomstig.find(l => l.start_tijd !== eerstvolgendeTijd || l.is_vandaag !== eerstvolgendeDatum);
    let lessenAfterNext = tweedeLes ? alleToekomstig.filter(l => l.start_tijd === tweedeLes.start_tijd && l.is_vandaag === tweedeLes.is_vandaag) : [];

    let data = {
        nu_status: "VRIJ", nu_naam: "VRIJ TRAINEN", nu_tijd: "", nu_vrij: 0,
        next_naam: "GEEN LESSEN", next_tijd: "", next_bezetting: ""
    };

    // Logica voor Bovenste Blok
    if (lessenNu.length > 0) {
        let l = lessenNu[roulatieIndex % lessenNu.length];
        data.nu_status = "LIVE"; data.nu_naam = l.display_title; data.nu_tijd = `${l.start_tijd} - ${l.eind_tijd}`;
    } else if (eerstvolgendeTijd && eerstvolgendeDatum) {
        const diff = Math.round((alleToekomstig[0].full_start - nuDate.getTime()) / 1000 / 60);
        if (diff <= 60) {
            let l = lessenNext[roulatieIndex % lessenNext.length];
            data.nu_status = "VOLGENDE"; data.nu_naam = l.display_title; data.nu_tijd = `${l.start_tijd} - ${l.eind_tijd}`;
            let v_nu = l.max_places - l.attendees;
            data.nu_vrij = v_nu > 9 ? 9 : (v_nu < 0 ? 0 : v_nu);
        }
    }

    // Logica voor Onderste Blok
    let bron = (lessenNu.length > 0 || data.nu_status === "VOLGENDE") ? (lessenAfterNext.length > 0 ? lessenAfterNext : lessenNext) : lessenNext;
    if (bron && bron.length > 0) {
        let l = bron[roulatieIndex % bron.length];
        let v_orig = l.max_places - l.attendees;
        let v_next = v_orig > 9 ? 9 : (v_orig < 0 ? 0 : v_orig);
        
        data.next_naam = l.display_title; 
        data.next_tijd = `${l.start_tijd} - ${l.eind_tijd}`;
        data.next_bezetting = v_next <= 0 ? "VOLGEBOEKT" : (v_next === 1 ? "NOG 1 PLEK VRIJ" : `NOG ${v_next} PLEKKEN VRIJ`);
    }

    // --- SLIMME UPDATE CHECK ---
    // We sturen alleen als:
    // 1. De naam van de huidige of volgende les echt is veranderd t.o.v. de vorige verzending
    // 2. Er meer dan 1 les tegelijk is (want dan moeten we rouleren om de 20 sec)
    const moetRoulatieNu = (lessenNu.length > 1);
    const moetRoulatieNext = (bron.length > 1);
    const naamVeranderd = (data.nu_naam !== lastSentData.nu_naam || data.next_naam !== lastSentData.next_naam);

    if (naamVeranderd || moetRoulatieNu || moetRoulatieNext) {
        if (HOMEY_URL) {
            try { 
                await axios.get(HOMEY_URL, { params: { tag: JSON.stringify(data) } }); 
                console.log(`[${nuDate.toLocaleTimeString('nl-NL')}] Update verzonden: ${data.nu_naam} | ${data.next_naam}`);
                lastSentData = { nu_naam: data.nu_naam, next_naam: data.next_naam };
            } catch (e) { console.error("Homey Error"); }
        }
    } else {
        // Geen log in de console om de logs schoon te houden, of eventueel:
        // console.log("Geen wijziging, update overgeslagen.");
    }
}

app.listen(PORT, () => {
    console.log(`Server gestart op poort ${PORT}`);
    syncVirtuagym();
    setInterval(updateHomeyRotation, 20000);
});
