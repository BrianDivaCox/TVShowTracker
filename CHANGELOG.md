# Changelog

## [1.2.0] - 2026-09-19

### Added
- **2-Week Schedule View**: View two stacked weekly rows of upcoming show episodes.
- **Full Monthly Calendar**: Explore all airing episodes in a clean monthly grid.
- **Schedule Scope Switcher**: Easily switch between 1-Week, 2-Weeks, and Monthly views.
- **Interactive Date Navigation**: Browse previous and future weeks or months with ease.
- **Season Episode Caching**: Fast loading multi-week schedules with cached season data.

### Changed
- Re-labeled the main navigation tab to Schedule.
- Enhanced mobile and tablet responsiveness across all calendar views.

## [1.1.0] - 2026-07-06

### Added
- **Instant Search Bar**: Added a search bar to instantly filter the weekly calendar and grids by show name.
- **Custom Sorting**: Added a dropdown on grid tabs to sort shows alphabetically, by next air date, or by popularity.
- **Mark as Watched Tracking**: Added a button on episode badges to track watched episodes locally. Shows visual feedback (grayed out poster, strikethrough text).
- **Daily Reminders**: Added a background task that runs at 9:00 AM daily to check for shows airing that night and sends a Windows Toast Notification.
- **Season Premieres & Finales**: Automatically detect and highlight season premieres and finales using TMDB episode data.

### Changed
- Re-themed the application to a premium deep dark blue background with Sky Blue highlights for buttons and active states.
- Re-styled "New This Week" badges to specifically target Season Premieres (Pink) and Season Finales (Amber).
- Reduced the visual size of the weekly calendar by constraining app max-width to 1300px and reducing internal padding.

### Removed
- Removed the hardcoded 500px minimum height for calendar day columns.
