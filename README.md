Problems with inherited code (and proposed solutions):
1. All fetching and processing happens on every page load. (Replace with script that handles data processing separately from user interface)
2. Fetching events limited to one call for 15,000. (Use pagination, fetch all available events)
3. Relies on string matching instead of `cemsid` for `Parks Permit Areas` dataset. (Replace with `cemsid` match)
4. Appears to use generated `eapply` and `sub` fields in `Athletic Facilities` dataset, many of which have errors. (Replace with `gispropnum`, `primary_sport`, and `field_number` matching using `Parks Properties` dataset)
5. Can only match locations with `Park: Area` format or matching `match(/^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$/i)`. (Use GOAT as backup, especially for non-standard location strings. Handle other common formats? Don't assume `Park: Area` format means sports?)

Mon Sep 7:
- Create skeleton of script that matches logic from existing app.

Sun Sep 13:
- Logic from inherited code matched about 16% of location strings to a feature. Updating to `cemsid`, `gispropnum`, `primary_sport`, and `field_number` (points 1-4 above) raises that to about 90%. Using more specific regexp and matching logic to match as many park names, sports, and field numbers as possible.

Roadmap:
- Remove dependence on `:`. Use `cemsid`, then look for sports keywords in location string, then look for road segment keywords in location string. 
- Handle comma-separated lists.
- Use GOAT as fallback for no match. 
- Refactoring
- Automated testing
- Saving to database
- API layer
- Web layer