import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: atob("QUl6YVN5QnV3NTFYUmtVejVzYnItaThES2lHVWdNcEFQU2lSLXZz"),
  authDomain: "wos-dashboard-38d4c.firebaseapp.com",
  projectId: "wos-dashboard-38d4c",
  storageBucket: "wos-dashboard-38d4c.firebasestorage.app",
  messagingSenderId: "1041082078621",
  appId: "1:1041082078621:web:9cce2bb45b76fb86404b74"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null;

const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxWTdLR5Y5guXF5pCW-hhZW42XD_EoBu7hQI3bhAwUiqwHmXvWoCWN-zYKUsgfOz2Y/exec?sheet=data';
const TMDB_KEY = 'ab209bae2d49ee12d5a1f8601c11ef6a';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

let globalWatchList = [];
let globalShowsData = [];
let currentTab = 'schedule';
let searchQuery = '';
let currentSort = 'alpha';
let currentScope = '1week'; // '1week', '2week', 'month'
let currentOffset = 0; // navigation offset relative to today
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
    // 1. Fetch Watchlist from Google Sheets (with 12-hour client caching to protect quota)
    let sheetResult = null;
    const cachedWatchlist = localStorage.getItem('tvshows_watchlist_cache');
    if (cachedWatchlist) {
      try {
        const parsed = JSON.parse(cachedWatchlist);
        if (Date.now() - parsed.timestamp < 12 * 60 * 60 * 1000 && parsed.data) {
          sheetResult = parsed.data;
        }
      } catch (e) {
        console.warn("Watchlist cache parse error:", e);
      }
    }

    if (!sheetResult) {
      const sheetResponse = await fetch(SHEET_URL).catch(e => {
        throw new Error("Failed to connect to Google Sheets. " + e.message);
      });
      sheetResult = await sheetResponse.json();
      if (sheetResult.error) throw new Error(sheetResult.error);

      try {
        localStorage.setItem('tvshows_watchlist_cache', JSON.stringify({
          timestamp: Date.now(),
          data: sheetResult
        }));
      } catch (e) {
        console.warn("Failed to store watchlist cache:", e);
      }
    }
    
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
          try {
            const parsed = JSON.parse(cached);
            // Check if cache is less than 24 hours old
            if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000 && parsed.data) {
              return parsed.data; // Return instantly from cache!
            }
          } catch (e) {
            // Ignore parse errors and re-fetch
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

    // Setup Schedule Scope Switcher (1 Week / 2 Weeks / Month)
    const scopeBtns = document.querySelectorAll('.scope-btn');
    scopeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        scopeBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentScope = e.target.getAttribute('data-scope');
        currentOffset = 0; // reset offset when switching scopes
        renderView();
      });
    });

    // Setup Date Navigation (Prev, Next, Today)
    const prevBtn = document.getElementById('schedule-prev-btn');
    const nextBtn = document.getElementById('schedule-next-btn');
    const todayBtn = document.getElementById('schedule-today-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        currentOffset--;
        renderView();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        currentOffset++;
        renderView();
      });
    }

    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        currentOffset = 0;
        renderView();
      });
    }
    
    // 4. Render Initial View
    renderView();
    
    // 5. Setup Admin Modal & Firebase Google Auth
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

    const googleSignInBtn = document.getElementById('google-signin-btn');
    const authStatusMsg = document.getElementById('auth-status-msg');
    if (googleSignInBtn) {
      googleSignInBtn.addEventListener('click', async () => {
        try {
          googleSignInBtn.disabled = true;
          if (authStatusMsg) {
            authStatusMsg.textContent = 'Opening Google Sign-In...';
            authStatusMsg.className = 'auth-status-msg info';
          }
          await signInWithPopup(auth, provider);
        } catch (err) {
          console.error("Google Auth error:", err);
          if (authStatusMsg) {
            if (err.code === 'auth/unauthorized-domain') {
              authStatusMsg.innerHTML = `Domain not authorized. Add <strong>${window.location.hostname}</strong> in Firebase Console &rarr; Auth &rarr; Settings &rarr; Authorized domains.`;
            } else if (err.code === 'auth/popup-closed-by-user') {
              authStatusMsg.textContent = 'Sign-in cancelled.';
            } else {
              authStatusMsg.textContent = err.message || 'Failed to sign in with Google.';
            }
            authStatusMsg.className = 'auth-status-msg error';
            authStatusMsg.classList.remove('hidden');
          }
        } finally {
          googleSignInBtn.disabled = false;
        }
      });
    }

    const signoutBtn = document.getElementById('admin-signout-btn');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', async () => {
        try {
          await signOut(auth);
        } catch (err) {
          console.error("Signout error:", err);
        }
      });
    }

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      updateAdminAuthUI(user);
    });
    
    // 6. Setup Sync Button inside Admin Modal
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', handleSync);
    }
    
  } catch (err) {
    document.getElementById('calendar-container').innerHTML = `<div class="error-state"><h3>Oops!</h3><p>${err.message}</p></div>`;
  }
}

function updateAdminAuthUI(user) {
  const loggedOutView = document.getElementById('admin-logged-out');
  const loggedInView = document.getElementById('admin-logged-in');
  const userPhoto = document.getElementById('admin-user-photo');
  const userName = document.getElementById('admin-user-name');
  const userEmail = document.getElementById('admin-user-email');
  const authStatusMsg = document.getElementById('auth-status-msg');

  if (user) {
    if (loggedOutView) loggedOutView.classList.add('hidden');
    if (loggedInView) loggedInView.classList.remove('hidden');
    if (userPhoto) userPhoto.src = user.photoURL || 'https://via.placeholder.com/42';
    if (userName) userName.textContent = user.displayName || 'Administrator';
    if (userEmail) userEmail.textContent = user.email || '';
    if (authStatusMsg) {
      authStatusMsg.textContent = '';
      authStatusMsg.className = 'auth-status-msg hidden';
    }
  } else {
    if (loggedOutView) loggedOutView.classList.remove('hidden');
    if (loggedInView) loggedInView.classList.add('hidden');
  }
}

async function handleSync() {
  if (!currentUser) {
    alert("Admin authentication required. Please sign in with Google first.");
    return;
  }

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
    
    // Invalidate local watchlist cache so subsequent reloads pull fresh data
    localStorage.removeItem('tvshows_watchlist_cache');
    
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
      if (usMatch.name.toLowerCase() === query.toLowerCase() || usMatch.name.toLowerCase() === bestMatch.name.toLowerCase()) {
        bestMatch = usMatch;
      }
    }
    
    const showId = bestMatch.id;
    
    // Fetch detailed show data
    const detailRes = await fetch(`${TMDB_BASE}/tv/${showId}?api_key=${TMDB_KEY}`);
    const showData = await detailRes.json();
    
    // Fetch current season episodes to support multi-week & monthly schedules
    let targetSeason = null;
    if (showData.next_episode_to_air && showData.next_episode_to_air.season_number) {
      targetSeason = showData.next_episode_to_air.season_number;
    } else if (showData.last_episode_to_air && showData.last_episode_to_air.season_number) {
      targetSeason = showData.last_episode_to_air.season_number;
    } else if (Array.isArray(showData.seasons) && showData.seasons.length > 0) {
      const regSeasons = showData.seasons.filter(s => s.season_number > 0);
      if (regSeasons.length > 0) {
        targetSeason = regSeasons[regSeasons.length - 1].season_number;
      }
    }
    
    if (targetSeason !== null && targetSeason !== undefined) {
      try {
        const seasonRes = await fetch(`${TMDB_BASE}/tv/${showId}/season/${targetSeason}?api_key=${TMDB_KEY}`);
        if (seasonRes.ok) {
          const seasonData = await seasonRes.json();
          showData.current_season_episodes = seasonData.episodes || [];
        }
      } catch (seasonErr) {
        console.warn(`Could not fetch season ${targetSeason} for ${showData.name}:`, seasonErr);
      }
    }
    
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
  const scheduleControls = document.getElementById('schedule-controls');
  const categoryInfo = document.getElementById('category-info');
  
  if (currentTab === 'schedule') {
    if (sortContainer) sortContainer.classList.add('hidden');
    if (categoryInfo) categoryInfo.classList.add('hidden');
    if (scheduleControls) scheduleControls.classList.remove('hidden');
    renderCalendarView(container);
  } else {
    if (sortContainer) sortContainer.classList.remove('hidden');
    if (categoryInfo) categoryInfo.classList.remove('hidden');
    if (scheduleControls) scheduleControls.classList.add('hidden');
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

  // Update Category Info Header
  const categoryTitles = {
    'current': 'Current Shows',
    'hiatus': 'On Hiatus',
    'cancelled': 'Archived Shows'
  };
  
  const catTitleEl = document.getElementById('category-title');
  const catCountEl = document.getElementById('category-count');
  if (catTitleEl) catTitleEl.textContent = categoryTitles[currentTab] || 'Shows';
  if (catCountEl) catCountEl.textContent = `${filteredShows.length} show${filteredShows.length === 1 ? '' : 's'}`;
  
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

// Extract all episodes for a show that fall into a specific date range
function getShowEpisodesInRange(show, startDate, endDate) {
  const episodes = [];
  const addedKeys = new Set();
  
  const addEpIfInRange = (ep) => {
    if (!ep || !ep.air_date) return;
    const key = `S${ep.season_number}E${ep.episode_number}-${ep.air_date}`;
    if (addedKeys.has(key)) return;
    
    const epDate = new Date(ep.air_date + 'T00:00:00');
    if (epDate >= startDate && epDate <= endDate) {
      addedKeys.add(key);
      episodes.push({
        show,
        episode: ep,
        dateObj: epDate
      });
    }
  };

  if (Array.isArray(show.current_season_episodes) && show.current_season_episodes.length > 0) {
    show.current_season_episodes.forEach(addEpIfInRange);
  }
  
  if (show.next_episode_to_air) addEpIfInRange(show.next_episode_to_air);
  if (show.last_episode_to_air) addEpIfInRange(show.last_episode_to_air);

  return episodes;
}

function renderCalendarView(container) {
  const today = new Date();
  
  if (currentScope === 'month') {
    renderMonthView(container, today);
  } else if (currentScope === '2week') {
    render2WeekView(container, today);
  } else {
    render1WeekView(container, today);
  }
}

// 1-Week Schedule Renderer
function render1WeekView(container, today) {
  const currentDay = today.getDay();
  const diffToMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1) + (currentOffset * 7);
  
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), diffToMonday, 0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Update Range Label
  const rangeLabel = document.getElementById('schedule-range-label');
  if (rangeLabel) {
    const startStr = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: startOfWeek.getFullYear() !== endOfWeek.getFullYear() ? 'numeric' : undefined });
    if (currentOffset === 0) {
      rangeLabel.textContent = `This Week (${startStr} – ${endStr})`;
    } else {
      rangeLabel.textContent = `${startStr} – ${endStr}`;
    }
  }

  const days = [
    { name: 'Monday', id: 1, shows: [] },
    { name: 'Tuesday', id: 2, shows: [] },
    { name: 'Wednesday', id: 3, shows: [] },
    { name: 'Thursday', id: 4, shows: [] },
    { name: 'Friday', id: 5, shows: [] },
    { name: 'Saturday', id: 6, shows: [] },
    { name: 'Sunday', id: 0, shows: [] }
  ];

  // Collect matching episodes
  globalShowsData.forEach(show => {
    if (searchQuery && !show.name.toLowerCase().includes(searchQuery)) return;
    let status = (show.status || '').toLowerCase();
    if (status === 'canceled' || status === 'ended') return;

    const matchedEps = getShowEpisodesInRange(show, startOfWeek, endOfWeek);
    matchedEps.forEach(item => {
      const dayOfWeek = item.dateObj.getDay();
      const targetDay = days.find(d => d.id === dayOfWeek);
      if (targetDay) {
        targetDay.shows.push(item);
      }
    });
  });

  let html = `<div class="calendar-grid">`;
  days.forEach(day => {
    day.shows.sort((a, b) => a.dateObj - b.dateObj);
    
    const columnDate = new Date(startOfWeek);
    const dayOffset = day.id === 0 ? 6 : day.id - 1;
    columnDate.setDate(columnDate.getDate() + dayOffset);
    const dateString = columnDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    const isToday = columnDate.toDateString() === today.toDateString();
    let showsHtml = renderDayCardsHtml(day.shows);

    html += `
      <div class="day-col ${isToday ? 'current-day-col' : ''}">
        <div class="day-header ${isToday ? 'today-highlight' : ''}">
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

// 2-Week Schedule Renderer (Stacked 7-day rows)
function render2WeekView(container, today) {
  const currentDay = today.getDay();
  const diffToMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1) + (currentOffset * 14);
  
  const startOf2Weeks = new Date(today.getFullYear(), today.getMonth(), diffToMonday, 0, 0, 0, 0);
  const endOf2Weeks = new Date(startOf2Weeks);
  endOf2Weeks.setDate(startOf2Weeks.getDate() + 13);
  endOf2Weeks.setHours(23, 59, 59, 999);

  // Update Range Label
  const rangeLabel = document.getElementById('schedule-range-label');
  if (rangeLabel) {
    const startStr = startOf2Weeks.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endOf2Weeks.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (currentOffset === 0) {
      rangeLabel.textContent = `2 Weeks (${startStr} – ${endStr})`;
    } else {
      rangeLabel.textContent = `${startStr} – ${endStr}`;
    }
  }

  // Define Week 1 & Week 2
  const weeks = [
    { name: 'Week 1', startOffset: 0, days: [] },
    { name: 'Week 2', startOffset: 7, days: [] }
  ];

  weeks.forEach(w => {
    const weekStart = new Date(startOf2Weeks);
    weekStart.setDate(weekStart.getDate() + w.startOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    w.startDate = weekStart;
    w.endDate = weekEnd;
    
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    w.days = dayNames.map((name, idx) => {
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + idx);
      return {
        name,
        dateObj: dayDate,
        dateString: dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isToday: dayDate.toDateString() === today.toDateString(),
        shows: []
      };
    });
  });

  // Distribute shows into weeks & days
  globalShowsData.forEach(show => {
    if (searchQuery && !show.name.toLowerCase().includes(searchQuery)) return;
    let status = (show.status || '').toLowerCase();
    if (status === 'canceled' || status === 'ended') return;

    const matchedEps = getShowEpisodesInRange(show, startOf2Weeks, endOf2Weeks);
    matchedEps.forEach(item => {
      const itemDateStr = item.dateObj.toDateString();
      weeks.forEach(w => {
        const targetDay = w.days.find(d => d.dateObj.toDateString() === itemDateStr);
        if (targetDay) {
          targetDay.shows.push(item);
        }
      });
    });
  });

  let html = `<div class="two-week-container">`;
  weeks.forEach(w => {
    const wStartStr = w.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const wEndStr = w.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    html += `
      <div class="week-section">
        <div class="week-row-header">
          <span class="week-title">${w.name}:</span>
          <span class="week-range">${wStartStr} – ${wEndStr}</span>
        </div>
        <div class="calendar-grid">
    `;

    w.days.forEach(day => {
      day.shows.sort((a, b) => a.dateObj - b.dateObj);
      let showsHtml = renderDayCardsHtml(day.shows);

      html += `
        <div class="day-col ${day.isToday ? 'current-day-col' : ''}">
          <div class="day-header ${day.isToday ? 'today-highlight' : ''}">
            <h2>${day.name}</h2>
            <span class="day-date">${day.dateString}</span>
          </div>
          <div class="day-content">
            ${showsHtml}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;
}

// Helper to render standard poster cards for a day column
function renderDayCardsHtml(showsList) {
  if (!showsList || showsList.length === 0) {
    return `<div class="no-shows">Nothing scheduled</div>`;
  }

  let showsHtml = '';
  showsList.forEach(item => {
    const showId = item.show.id || item.show.tmdb_id;
    const posterUrl = item.show.backdrop_path ? `${IMAGE_BASE}${item.show.backdrop_path}` : (item.show.poster_path ? `${IMAGE_BASE}${item.show.poster_path}` : 'https://via.placeholder.com/500x281?text=No+Image');
    const epStr = `S${item.episode.season_number.toString().padStart(2, '0')} E${item.episode.episode_number.toString().padStart(2, '0')}`;
    const dateStr = item.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    const isPremiere = item.episode.episode_number === 1;
    const isFinale = item.episode.episode_type === 'finale';
    
    let badgeHtml = '';
    if (isPremiere) {
      badgeHtml = `<div class="badge-soon">Season Premiere</div>`;
    } else if (isFinale) {
      badgeHtml = `<div class="badge-soon" style="background: #f59e0b; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.5);">Season Finale</div>`;
    }
    
    const epKey = `${showId}-S${item.episode.season_number}E${item.episode.episode_number}`;
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
            <button class="watch-btn ${isWatched ? 'watched-btn-active' : ''}" onclick="toggleWatched(${showId}, ${item.episode.season_number}, ${item.episode.episode_number})" title="${isWatched ? 'Mark unwatched' : 'Mark watched'}">
              ${isWatched ? '✔' : '○'}
            </button>
          </div>
        </div>
      </div>
    `;
  });
  return showsHtml;
}

// Monthly Calendar Grid Renderer
function renderMonthView(container, today) {
  const targetMonth = new Date(today.getFullYear(), today.getMonth() + currentOffset, 1);
  const year = targetMonth.getFullYear();
  const month = targetMonth.getMonth();
  
  // First and last day of target month
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // Update Range Label
  const rangeLabel = document.getElementById('schedule-range-label');
  if (rangeLabel) {
    rangeLabel.textContent = firstDayOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Calendar Grid Start: find Monday on or before the 1st
  const firstDayWeekday = firstDayOfMonth.getDay(); // 0 = Sun, 1 = Mon ...
  const startOffset = firstDayWeekday === 0 ? 6 : firstDayWeekday - 1;
  const gridStart = new Date(year, month, 1 - startOffset, 0, 0, 0, 0);

  // Calendar Grid End: find Sunday on or after last day
  const lastDayWeekday = lastDayOfMonth.getDay();
  const endOffset = lastDayWeekday === 0 ? 0 : 7 - lastDayWeekday;
  const gridEnd = new Date(year, month + 1, 0 + endOffset, 23, 59, 59, 999);

  // Build Day Cells
  const calendarCells = [];
  let curr = new Date(gridStart);
  while (curr <= gridEnd) {
    calendarCells.push({
      dateObj: new Date(curr),
      dayNumber: curr.getDate(),
      isCurrentMonth: curr.getMonth() === month,
      isToday: curr.toDateString() === today.toDateString(),
      shows: []
    });
    curr.setDate(curr.getDate() + 1);
  }

  // Match shows in active grid window
  globalShowsData.forEach(show => {
    if (searchQuery && !show.name.toLowerCase().includes(searchQuery)) return;
    let status = (show.status || '').toLowerCase();
    if (status === 'canceled' || status === 'ended') return;

    const matchedEps = getShowEpisodesInRange(show, gridStart, gridEnd);
    matchedEps.forEach(item => {
      const itemDateStr = item.dateObj.toDateString();
      const targetCell = calendarCells.find(c => c.dateObj.toDateString() === itemDateStr);
      if (targetCell) {
        targetCell.shows.push(item);
      }
    });
  });

  const weekdayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = `
    <div class="month-calendar-view">
      <div class="month-grid-header">
        ${weekdayHeaders.map(w => `<div class="month-weekday-title">${w}</div>`).join('')}
      </div>
      <div class="month-grid">
  `;

  calendarCells.forEach(cell => {
    cell.shows.sort((a, b) => a.dateObj - b.dateObj);
    
    let showsHtml = '';
    cell.shows.forEach(item => {
      const showId = item.show.id || item.show.tmdb_id;
      const posterUrl = item.show.poster_path ? `${IMAGE_BASE}${item.show.poster_path}` : (item.show.backdrop_path ? `${IMAGE_BASE}${item.show.backdrop_path}` : 'https://via.placeholder.com/100x150?text=TV');
      const epStr = `S${item.episode.season_number}E${item.episode.episode_number}`;
      const isPremiere = item.episode.episode_number === 1;
      const isFinale = item.episode.episode_type === 'finale';
      
      let badgeHtml = '';
      if (isPremiere) {
        badgeHtml = `<span class="badge-mini-premiere">Premiere</span>`;
      } else if (isFinale) {
        badgeHtml = `<span class="badge-mini-finale">Finale</span>`;
      }

      const epKey = `${showId}-S${item.episode.season_number}E${item.episode.episode_number}`;
      const isWatched = !!watchedHistory[epKey];

      showsHtml += `
        <div class="month-show-card ${isWatched ? 'watched-card' : ''}" title="${item.show.name} - ${epStr}">
          <img src="${posterUrl}" alt="${item.show.name}" class="month-show-img" loading="lazy">
          <div class="month-show-details">
            <span class="month-show-title">${item.show.name}</span>
            <div class="month-show-sub">
              <span class="month-ep-badge">${epStr}</span>
              ${badgeHtml}
            </div>
          </div>
          <button class="watch-btn-mini ${isWatched ? 'watched-active' : ''}" onclick="toggleWatched(${showId}, ${item.episode.season_number}, ${item.episode.episode_number})" title="${isWatched ? 'Watched' : 'Mark Watched'}">
            ${isWatched ? '✔' : '○'}
          </button>
        </div>
      `;
    });

    html += `
      <div class="month-day-cell ${cell.isCurrentMonth ? '' : 'other-month'} ${cell.isToday ? 'month-today' : ''}">
        <div class="month-day-header">
          <span class="month-day-num ${cell.isToday ? 'today-badge' : ''}">${cell.dayNumber}</span>
        </div>
        <div class="month-day-events">
          ${showsHtml}
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;
}

init();
