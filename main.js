const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxWTdLR5Y5guXF5pCW-hhZW42XD_EoBu7hQI3bhAwUiqwHmXvWoCWN-zYKUsgfOz2Y/exec?sheet=data';
const TMDB_KEY = 'ab209bae2d49ee12d5a1f8601c11ef6a';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

let globalWatchList = [];
let globalShowsData = [];
let currentTab = 'schedule';
let searchQuery = '';
let currentSort = 'alpha';
let watchedHistory = JSON.parse(localStorage.getItem('tvshows-watched')) || {};

window.toggleWatched = function(showId, season, ep) {
  const key = `${showId}-S${season}E${ep}`;
  if (watchedHistory[key]) {
    delete watchedHistory[key];
  } else {
    watchedHistory[key] = true;
  }
  localStorage.setItem('tvshows-watched', JSON.stringify(watchedHistory));
  renderView(); // Re-render to update UI
};

async function init() {
  renderLoading("Syncing with your Watchlist...");
  try {
    // 1. Fetch Watchlist from Google Sheets
    const sheetResponse = await fetch(SHEET_URL).catch(e => {
      throw new Error("Failed to connect to Google Sheets. " + e.message);
    });
    const sheetResult = await sheetResponse.json();
    if (sheetResult.error) throw new Error(sheetResult.error);
    
    // Check if the user has organized it into 3 columns yet
    let watchList = [];
    if (sheetResult.data.length > 0 && sheetResult.data[0][0] === "Current") {
      // It's the new organized layout (Col 0: Current, Col 1: Hiatus, Col 2: Cancelled)
      for (let i = 1; i < sheetResult.data.length; i++) {
        for (let col = 0; col < 3; col++) {
          let cell = sheetResult.data[i][col];
          if (typeof cell === 'string' && cell.trim() !== '' && !watchList.includes(cell.trim())) {
            watchList.push(cell.trim());
          }
        }
      }
    } else {
      // It's the old layout or a 1-column list
      for (let i = 1; i < sheetResult.data.length; i++) {
        let cell = sheetResult.data[i][0];
        if (typeof cell === 'string' && cell.trim() !== '') {
          // In case the user pasted the entire list into a single cell with newlines
          let items = cell.split('\n');
          items.forEach(item => {
            if (item.trim() !== '') watchList.push(item.trim());
          });
        }
      }
      
      if (watchList.length === 0) {
        for (let i = 1; i < sheetResult.data.length; i++) {
          for (let j = 1; j < sheetResult.data[i].length; j+=2) {
            let cell = sheetResult.data[i][j];
            if (typeof cell === 'string' && cell.trim() !== '') {
              let title = cell.split('|')[0].replace(/\n/g, '').trim();
              if (title && !watchList.includes(title)) watchList.push(title);
            }
          }
        }
      }
    }
    
    if (watchList.length === 0) {
      throw new Error("Your watchlist is empty! Please add show titles to your spreadsheet.");
    }
    
    globalWatchList = watchList;
    // 2. Fetch TMDB Data for each show in batches to avoid rate limits
    let shows = [];
    let needsApiDelay = false;
    
    for (let i = 0; i < watchList.length; i += 10) {
      renderLoading(`Fetching API data for shows ${i+1} to ${Math.min(i+10, watchList.length)} of ${watchList.length}...`);
      const batch = watchList.slice(i, i + 10);
      
      const batchPromises = batch.map(async (query) => {
        const cacheKey = `tmdb_cache_${query}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          // Check if cache is less than 24 hours old
          if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            return parsed.data; // Return instantly from cache!
          }
        }
        
        needsApiDelay = true; // We actually hit the network, so we must delay
        return fetchShowData(query, cacheKey).catch(e => {
          console.error("TMDB error for " + query, e);
          return null; // Ignore individual TMDB failures
        });
      });
      
      const batchResults = await Promise.all(batchPromises);
      shows = shows.concat(batchResults);
      
      // Brief pause between batches ONLY if we actually hit the API
      if (needsApiDelay && i + 10 < watchList.length) {
        await new Promise(r => setTimeout(r, 500));
        needsApiDelay = false;
      }
    }
    
    // Filter out failed searches
    globalShowsData = shows.filter(s => s !== null);
    
    // 3. Setup Tabs
    const appTabs = document.getElementById('app-tabs');
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        tabBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTab = e.target.getAttribute('data-tab');
        appTabs.classList.remove('open'); // Close mobile menu if open
        renderView();
      });
    });
    
    // Setup Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', () => {
        appTabs.classList.toggle('open');
      });
    }
    
    // Setup Search & Sort
    document.getElementById('search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderView();
    });
    
    document.getElementById('sort-select').addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderView();
    });
    
    // 4. Render Initial View
    renderView();
    
    // 5. Setup Admin Modal
    const adminModal = document.getElementById('admin-modal');
    document.getElementById('admin-toggle-btn').addEventListener('click', () => {
      adminModal.classList.remove('hidden');
    });
    document.getElementById('admin-close-btn').addEventListener('click', () => {
      adminModal.classList.add('hidden');
    });
    adminModal.addEventListener('click', (e) => {
      if (e.target === adminModal) {
        adminModal.classList.add('hidden');
      }
    });
    
    // 5. Setup Sync Button inside Admin Modal
    document.getElementById('sync-btn').addEventListener('click', handleSync);
    
  } catch (err) {
    document.getElementById('calendar-container').innerHTML = `<div class="error-state"><h3>Oops!</h3><p>${err.message}</p></div>`;
  }
}

async function handleSync() {
  const btn = document.getElementById('sync-btn');
  btn.classList.add('loading');
  btn.innerHTML = `<span class="sync-icon">⟳</span> Organizing...`;
  
  try {
    let current = [];
    let hiatus = [];
    let cancelled = [];
    
    globalShowsData.forEach(show => {
      let status = (show.status || '').toLowerCase();
      
      if (status === 'canceled' || status === 'ended') {
        cancelled.push(show.name);
      } else {
        // If it's returning/in production, check if it actually has a scheduled episode!
        if (show.next_episode_to_air && show.next_episode_to_air.air_date) {
          current.push(show.name);
        } else {
          // It's returning eventually, but has no scheduled date right now (On Hiatus)
          hiatus.push(show.name);
        }
      }
    });
    
    // Pad arrays so they are the same length for Google Sheets
    let maxLen = Math.max(current.length, hiatus.length, cancelled.length);
    let rows = [["Current", "Hiatus", "Cancelled / Ended"]];
    
    for (let i = 0; i < maxLen; i++) {
      rows.push([
        current[i] || "",
        hiatus[i] || "",
        cancelled[i] || ""
      ]);
    }
    
    // POST to Google Sheets
    await fetch(SHEET_URL, {
      method: 'POST',
      mode: 'no-cors', // REQUIRED for Google Apps Script POST from a browser
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ data: rows })
    });
    
    // With 'no-cors', we cannot read the response, so if fetch didn't throw a network error, we assume success!
    btn.innerHTML = `<span>✓</span> Organized!`;
    setTimeout(() => {
      btn.classList.remove('loading');
      btn.innerHTML = `<span class="sync-icon">⟳</span> Sync & Organize Spreadsheet`;
    }, 3000);
    
  } catch (err) {
    alert("Failed to organize: " + err.message);
    btn.classList.remove('loading');
    btn.innerHTML = `<span class="sync-icon">⟳</span> Sync & Organize Spreadsheet`;
  }
}

async function fetchShowData(query, cacheKey) {
  try {
    // Search for the show
    const searchRes = await fetch(`${TMDB_BASE}/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}`);
    const searchData = await searchRes.json();
    
    if (!searchData.results || searchData.results.length === 0) return null;
    
    // Prioritize US versions of shows (like LEGO Masters US vs AU)
    let bestMatch = searchData.results[0];
    const usMatch = searchData.results.find(r => r.origin_country && r.origin_country.includes('US'));
    
    if (usMatch) {
      // Only override if the US match has the exact same name or is a very close match
      if (usMatch.name.toLowerCase() === query.toLowerCase() || usMatch.name.toLowerCase() === bestMatch.name.toLowerCase()) {
        bestMatch = usMatch;
      }
    }
    
    const showId = bestMatch.id;
    
    // Fetch detailed show data
    const detailRes = await fetch(`${TMDB_BASE}/tv/${showId}?api_key=${TMDB_KEY}`);
    const showData = await detailRes.json();
    
    // Save to Cache
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      data: showData
    }));
    
    return showData;
  } catch (e) {
    console.error(`Failed to fetch TMDB data for ${query}:`, e);
    return null;
  }
}

function renderLoading(message) {
  document.getElementById('calendar-container').innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function renderView() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = '';
  
  const sortContainer = document.getElementById('sort-container');
  
  if (currentTab === 'schedule') {
    sortContainer.classList.add('hidden');
    renderCalendarView(container);
  } else {
    sortContainer.classList.remove('hidden');
    renderGridView(container);
  }
}

function renderGridView(container) {
  let filteredShows = [];
  
  if (currentTab === 'current') {
    filteredShows = globalShowsData.filter(s => {
      let status = (s.status || '').toLowerCase();
      return (status !== 'canceled' && status !== 'ended') && (s.next_episode_to_air && s.next_episode_to_air.air_date);
    });
  } else if (currentTab === 'hiatus') {
    filteredShows = globalShowsData.filter(s => {
      let status = (s.status || '').toLowerCase();
      return (status !== 'canceled' && status !== 'ended') && (!s.next_episode_to_air || !s.next_episode_to_air.air_date);
    });
  } else if (currentTab === 'cancelled') {
    filteredShows = globalShowsData.filter(s => {
      let status = (s.status || '').toLowerCase();
      return (status === 'canceled' || status === 'ended');
    });
  }
  
  // Apply Search
  if (searchQuery) {
    filteredShows = filteredShows.filter(s => s.name.toLowerCase().includes(searchQuery));
  }
  
  // Sort
  if (currentSort === 'alpha') {
    filteredShows.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSort === 'date') {
    filteredShows.sort((a, b) => {
      const dateA = a.next_episode_to_air && a.next_episode_to_air.air_date ? new Date(a.next_episode_to_air.air_date) : new Date('2099-01-01');
      const dateB = b.next_episode_to_air && b.next_episode_to_air.air_date ? new Date(b.next_episode_to_air.air_date) : new Date('2099-01-01');
      return dateA - dateB;
    });
  } else if (currentSort === 'popularity') {
    filteredShows.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }
  
  if (filteredShows.length === 0) {
    container.innerHTML = `<div class="no-shows" style="text-align:center; padding: 50px;">No shows in this category.</div>`;
    return;
  }
  
  let html = `<div class="shows-grid">`;
  filteredShows.forEach(show => {
    const posterUrl = show.poster_path ? `${IMAGE_BASE}${show.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster';
    html += `
      <div class="shows-grid-card">
        <img src="${posterUrl}" alt="${show.name}" class="shows-grid-img" loading="lazy">
        <div class="shows-grid-info">
          <h3 class="shows-grid-title" title="${show.name}">${show.name}</h3>
          <div class="shows-grid-status">${show.status || 'Unknown'}</div>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}

function renderCalendarView(container) {
  const days = [
    { name: 'Monday', id: 1, shows: [] },
    { name: 'Tuesday', id: 2, shows: [] },
    { name: 'Wednesday', id: 3, shows: [] },
    { name: 'Thursday', id: 4, shows: [] },
    { name: 'Friday', id: 5, shows: [] },
    { name: 'Saturday', id: 6, shows: [] },
    { name: 'Sunday', id: 0, shows: [] } // Date.getDay() returns 0 for Sunday
  ];
  
  const tbaShows = [];
  
  // Calculate the start (Monday) and end (Sunday) of the current week
  const today = new Date();
  const currentDay = today.getDay();
  const diffToMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1); // adjust when day is Sunday
  
  const startOfWeek = new Date(today);
  startOfWeek.setDate(diffToMonday);
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Sort shows into days
  globalShowsData.forEach(show => {
    // Search Filter
    if (searchQuery && !show.name.toLowerCase().includes(searchQuery)) {
      return;
    }
    
    // If it's cancelled, we don't render it at all!
    let status = (show.status || '').toLowerCase();
    if (status === 'canceled' || status === 'ended') {
      return; 
    }
    
    const nextEp = show.next_episode_to_air;
    const lastEp = show.last_episode_to_air;
    
    let activeEp = null;
    let airDateObj = null;
    
    // 1. Check if the NEXT episode is airing this week
    if (nextEp && nextEp.air_date) {
      let d = new Date(nextEp.air_date + 'T00:00:00');
      if (d >= startOfWeek && d <= endOfWeek) {
        activeEp = nextEp;
        airDateObj = d;
      }
    }
    
    // 2. If not, check if the LAST episode aired this week (e.g. if today is Wed and it aired Mon)
    if (!activeEp && lastEp && lastEp.air_date) {
      let d = new Date(lastEp.air_date + 'T00:00:00');
      if (d >= startOfWeek && d <= endOfWeek) {
        activeEp = lastEp;
        airDateObj = d;
      }
    }
    
    if (activeEp && airDateObj) {
      const dayOfWeek = airDateObj.getDay();
      const targetDay = days.find(d => d.id === dayOfWeek);
      if (targetDay) {
        targetDay.shows.push({
          show: show,
          episode: activeEp,
          dateObj: airDateObj
        });
      }
    }
  });
  
  // Build HTML
  let html = `<div class="calendar-grid">`;
  
  days.forEach(day => {
    // Sort shows on this day by air date (closest first)
    day.shows.sort((a, b) => a.dateObj - b.dateObj);
    
    // Calculate the actual date for this column
    const columnDate = new Date(startOfWeek);
    const dayOffset = day.id === 0 ? 6 : day.id - 1;
    columnDate.setDate(columnDate.getDate() + dayOffset);
    const dateString = columnDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    let showsHtml = '';
    
    if (day.shows.length === 0) {
      showsHtml = `<div class="no-shows">Nothing scheduled</div>`;
    } else {
      day.shows.forEach(item => {
        const posterUrl = item.show.backdrop_path ? `${IMAGE_BASE}${item.show.backdrop_path}` : (item.show.poster_path ? `${IMAGE_BASE}${item.show.poster_path}` : 'https://via.placeholder.com/500x281?text=No+Image');
        const epStr = `S${item.episode.season_number.toString().padStart(2, '0')} E${item.episode.episode_number.toString().padStart(2, '0')}`;
        
        // Format date nicely (e.g. Oct 15)
        const dateStr = item.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        
        const isPremiere = item.episode.episode_number === 1;
        const isFinale = item.episode.episode_type === 'finale';
        
        let badgeHtml = '';
        if (isPremiere) {
          badgeHtml = `<div class="badge-soon">Season Premiere</div>`;
        } else if (isFinale) {
          badgeHtml = `<div class="badge-soon" style="background: #f59e0b; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.5);">Season Finale</div>`;
        }
        
        const epKey = `${item.show.tmdb_id}-S${item.episode.season_number}E${item.episode.episode_number}`;
        const isWatched = !!watchedHistory[epKey];
        
        showsHtml += `
          <div class="poster-card ${badgeHtml ? 'airing-soon' : ''} ${isWatched ? 'watched-card' : ''}">
            <div class="poster-img-container">
              <img src="${posterUrl}" alt="${item.show.name}" class="poster-img" loading="lazy">
              ${badgeHtml}
            </div>
            <div class="poster-info">
              <h3 class="poster-title">${item.show.name}</h3>
              <div class="poster-meta">
                <span class="ep-badge">${epStr}</span>
                <span class="ep-date">${dateStr}</span>
                <button class="watch-btn ${isWatched ? 'watched-btn-active' : ''}" onclick="toggleWatched(${item.show.tmdb_id}, ${item.episode.season_number}, ${item.episode.episode_number})">
                  ${isWatched ? '✔' : '○'}
                </button>
              </div>
            </div>
          </div>
        `;
      });
    }
    
    html += `
      <div class="day-col">
        <div class="day-header">
          <h2>${day.name}</h2>
          <span class="day-date">${dateString}</span>
        </div>
        <div class="day-content">
          ${showsHtml}
        </div>
      </div>
    `;
  });
  
  html += `</div>`;
  
  container.innerHTML = html;
}

init();
