const fs = require('fs');

async function fix() {
  console.log("Reading shows from my_shows.txt...");
  const raw = fs.readFileSync('my_shows.txt', 'utf8');
  const shows = raw.split('\n').filter(s => s.trim() !== '');
  
  const TMDB_KEY = 'ab209bae2d49ee12d5a1f8601c11ef6a';
  
  let current = [];
  let hiatus = [];
  let cancelled = [];
  
  console.log("Fetching TMDB data for " + shows.length + " shows. This might take a few seconds...");
  
  // Process in small batches to avoid rate limits
  for (let i = 0; i < shows.length; i += 5) {
    const batch = shows.slice(i, i + 5);
    
    await Promise.all(batch.map(async (show) => {
      try {
        const sRes = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(show)}`);
        const sData = await sRes.json();
        
        if (sData.results && sData.results.length > 0) {
          const id = sData.results[0].id;
          const dRes = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}`);
          const dData = await dRes.json();
          
          let name = dData.name;
          // Prevent Google Sheets from converting things like "9-1-1" into dates
          if (/^[0-9]+-[0-9]+-[0-9]+$/.test(name)) name = "'" + name;
          
          const status = (dData.status || '').toLowerCase();
          
          if (status === 'canceled' || status === 'ended') {
            cancelled.push(name);
          } else {
            if (dData.next_episode_to_air && dData.next_episode_to_air.air_date) {
              current.push(name);
            } else {
              hiatus.push(name);
            }
          }
        }
      } catch (e) {
        console.log("Error on " + show, e.message);
      }
    }));
    // Wait longer between batches to respect 40req/10s
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`\nSorting Complete!`);
  console.log(`Current: ${current.length}`);
  console.log(`Hiatus: ${hiatus.length}`);
  console.log(`Cancelled: ${cancelled.length}`);
  
  let maxLen = Math.max(current.length, hiatus.length, cancelled.length);
  let rows = [["Current", "Hiatus", "Cancelled"]];
  
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      current[i] || "",
      hiatus[i] || "",
      cancelled[i] || ""
    ]);
  }
  
  console.log("\nPushing organized layout to Google Sheets...");
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxWTdLR5Y5guXF5pCW-hhZW42XD_EoBu7hQI3bhAwUiqwHmXvWoCWN-zYKUsgfOz2Y/exec?sheet=data';
  
  try {
    const res = await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ data: rows })
    });
    
    const resultText = await res.text();
    console.log("Google Sheets response:", resultText);
  } catch(e) {
    console.error("Failed to POST to Google Sheets:", e);
  }
}

fix();
