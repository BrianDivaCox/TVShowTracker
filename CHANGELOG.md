# Changelog

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
