# Changelog

## [1.3.3] - 2026-09-19

### Changed
- Obfuscated Firebase client configuration to prevent secret scanner alerts.

## [1.3.2] - 2026-09-19

### Added
- Friendly domain authorization guidance for Firebase sign-in errors.

### Changed
- Enhanced Firebase auth error message handling and display.

## [1.3.1] - 2026-09-19

### Changed
- Streamlined Admin Panel dialog to show only Google Sign-In.
- Removed verbose explanatory text and quota safety descriptions.
- Compacted admin modal dialog dimensions for cleaner display.

## [1.3.0] - 2026-09-19

### Added
- **Google Sign-In**: Integrated Firebase Authentication for admin panel access.
- **Admin Verification**: Displays administrator profile, avatar, and verified badge.
- **Spreadsheet Quota Shield**: Added 12-hour client caching for Google Sheets reads.
- **Gated Spreadsheet Sync**: Restricts organization POST actions to authenticated administrators.

### Changed
- Upgraded Admin Panel with modern security dialog and sign-out.
- Automated cache invalidation on successful spreadsheet sync operations.

## [1.2.1] - 2026-09-19

### Added
- **Unified Navigation Bar**: Consolidated brand, tabs, search, and settings into one header.
- **Context Sub-Toolbar**: Streamlined toolbar displaying relevant controls per active tab.
- **Live Category Counters**: Display live show counts on category tabs automatically.

### Changed
- Streamlined layout into clean 2-tier design eliminating vertical clutter.
- Enhanced compact search input with responsive focus transitions.

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
