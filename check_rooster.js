const axios = require('axios');

// VUL HIER JE GEGEVENS IN (Hetzelfde als in je hoofdscript)
const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;

const activityNames = {
    "595083": "BUIKSPIERKWARTIER", "595096": "SPORTYV WANDELEN", "594693": "SPINNING",
    "594694": "PILATES", "595082": "BOKSFIT", "589058": "FITCIRCUIT",
    "594700": "50-FIT", "595091": "HIIT", "594697": "SPINNING",
    "594699": "FLOW YOGA", "595095": "60+ KRACHT EN BALANS", "594706": "BODYBALANCE",
    "594704": "BBB", "594703": "GENTLE FLOW YOGA", "594695": "ZUMBA",
    "594701": "BODYSHAPE", "594707": "VINYASA YOGA"
};

async function checkRooster() {
    try {
        // We kijken vanaf vandaag 00:00 tot over 7 dagen
        const nuNL = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
        const start = Math.floor(nuNL.setHours(0,0,0,0) / 1000);
        const end = start + (7 * 24 * 60 * 60); 

        console.log("--- START ROOSTER CHECK (7 DAGEN) ---");

        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/events`, {
            params: {
                api_key: API_KEY,
                club_secret: CLUB_SECRET,
                timestamp_start: start,
                timestamp_end: end
            }
        });

        if (response.data && response.data.result) {
            const lessen = response.data.result;
            
            // Sorteren op tijd voor een duidelijk overzicht
            lessen.sort((a, b) => new Date(a.start) - new Date(b.start));

            lessen.forEach(l => {
                const vertaaldeNaam = activityNames[l.activity_id] || "ONBEKEND ID";
                const orgineleTitel = l.title || "GEEN TITEL";
                const status = l.canceled ? "!! GEANNULEERD !!" : "ACTIEF";
                
                console.log(`${l.start} | ID: ${l.activity_id} | Naam: ${vertaaldeNaam} | Origineel: ${orgineleTitel} | [${status}]`);
            });

            console.log(`\nTotaal aantal lessen gevonden: ${lessen.length}`);
        } else {
            console.log("Geen lessen gevonden in de API response.");
        }
    } catch (error) {
        console.error("FOUT bij ophalen:", error.message);
    }
}

checkRooster();
