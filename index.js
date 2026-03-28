// --- VERBETERDE SYNC FUNCTIE MET TIJDZONE EN TITEL-FIX ---

async function syncVirtuagym() {
    try {
        // We halen data op voor vandaag
        const nuNL = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Amsterdam"}));
        const start = Math.floor(nuNL.setHours(0,0,0,0) / 1000);
        const end = Math.floor(nuNL.setHours(23,59,59,999) / 1000);

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
                // TITEL FIX: Gebruik title, anders activity_name (indien aanwezig), anders fallback
                let naam = e.title || e.activity_name || "Groepsles";
                
                // Soms zit de naam diep in de API response verstopt, we loggen het even in de console
                if (!e.title) console.log("Les gevonden zonder titel, ID:", e.event_id);

                return {
                    ...e,
                    display_title: naam,
                    start_tijd: e.start.split(' ')[1].substring(0, 5),
                    eind_tijd: e.end.split(' ')[1].substring(0, 5)
                };
            });
            console.log(`[SYNC] ${lessenCache.length} lessen verwerkt.`);
        }
    } catch (e) {
        console.error("Sync Error:", e.message);
    }
}

// --- VERBETERDE DEBUG PAGINA ---
app.get('/check', (req, res) => {
    // Huidige tijd in NL FORCEREN
    const tijdNu = new Date().toLocaleTimeString("nl-NL", {
        timeZone: "Europe/Amsterdam",
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let html = `<html><body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">`;
    html += `<h1>YVSPORT Lessons Debug</h1><p>Huidige tijd (NL): <strong>${tijdNu}</strong></p>`;
    html += `<table border="1" cellpadding="10" style="border-collapse:collapse; width:100%;">`;
    html += `<tr style="background:#333;"><th>Tijd</th><th>Les (Display Title)</th><th>Bezetting</th><th>Status</th></tr>`;
    
    lessenCache.forEach(l => {
        const isNu = tijdNu >= l.start_tijd && tijdNu < l.eind_tijd;
        html += `<tr style="color:${isNu ? '#00FF00' : 'white'}">
                    <td>${l.start_tijd}-${l.eind_tijd}</td>
                    <td>${l.display_title}</td>
                    <td>${l.attendees}/${l.max_places}</td>
                    <td>${isNu ? '<strong>NU BEZIG</strong>' : 'GEPLAND'}</td>
                 </tr>`;
    });
    
    html += `</table><p style="color:gray; font-size:0.8em;">Ps: Als de namen nog steeds leeg zijn, laat het me weten. Dan vissen we ze uit de 'Activity Definition'.</p></body></html>`;
    res.send(html);
});
