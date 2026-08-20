# HSE Observation Dashboard

This project is a browser-based HSE observation dashboard for reviewing field safety reports from a Google Sheet. It is designed as a static front end, with live data loaded at runtime from Google services.

The dashboard is built with plain HTML, CSS, and JavaScript. There is no build step and no framework dependency in the repo itself.

## What the dashboard includes

- KPI cards for total reports, safe practices, unsafe acts, and closure rate
- Filter controls for observer, designation, status, and free-text search
- Overview reports for reporting trend and observation categories
- Team reports for designation mix and top reporters
- Management insight reports for severity, location hotspots, and weekly cadence
- Trend reports for monthly comparison and aging open items
- A paged observation log with expandable report details
- Modal views for full report details, evidence preview, and maximized panels

## Project structure

- [index.html](index.html) contains the main page layout, tabs, filters, chart containers, table, and modal shells.
- [assets/styles.css](assets/styles.css) contains the full visual design for the dashboard.
- [assets/app.js](assets/app.js) contains configuration, data loading, normalization, filtering, chart rendering, log rendering, and modal behavior.
- [bqhse/index.html](bqhse/index.html) is a separate standalone HTML variant in the same workspace.

## Technology used

- HTML
- CSS
- JavaScript
- [Chart.js](https://www.chartjs.org/) for charts
- [Papa Parse](https://www.papaparse.com/) for CSV parsing
- Google Sheets as the source spreadsheet
- Google Apps Script as the primary JSON endpoint
- Google Visualization JSONP as a fallback option for sheet reads
- Google Fonts for typography

## Current runtime configuration

The live source configuration is defined near the top of [assets/app.js](assets/app.js).

### Active settings in the current code

- `DATA_SOURCE_MODE` is set to `apps-script`
- `REFRESH_MS` is set to `300 * 60 * 1000`, which is 300 minutes or 5 hours
- `LOG_PAGE_SIZE` is set to `25`
- The code keeps both a Google Sheet export URL and a Google Apps Script URL available

### Source modes supported by the dashboard

- `apps-script`: load JSON from the Apps Script web app
- `direct-sheet`: fetch the Google Sheet CSV export directly
- `auto`: try Apps Script first, then fall back to direct sheet access

### Important hosting note

If the page is opened with `file://`, direct CSV fetch from Google Sheets is blocked by browser CORS rules. The code accounts for this by using a Google Visualization JSONP path when needed.

## How data flows through the app

The control flow in [assets/app.js](assets/app.js) is straightforward:

1. The script reads rows from Apps Script, direct sheet CSV, or Google Visualization.
2. It normalizes incoming rows into one common record shape.
3. It stores the normalized list in memory.
4. Filters are applied on the client side.
5. KPI cards, charts, hotspot lists, aging lists, and the log table are re-rendered from the filtered rows.

This design keeps the front end simple and makes the spreadsheet the operational source of truth.

## Normalized fields expected by the dashboard

The parser is flexible about header names, but it expects each row to map into these business fields:

- Date and time of observation, or timestamp
- Location of observation, or location
- Observer name
- Type of observation
- What was specifically observed
- Category of unsafe observation
- Severity potential
- Immediate action
- Corrected on the spot
- Photo or evidence or closeout field containing one or more links
- Responsible person
- Corrective action taken
- Observer designation
- Status

Rows without a location are dropped during parsing.

### Practical data rules

- Keep severity values numeric, ideally `1` to `5`
- Use consistent status values such as `Open` and `Closed`
- Keep one observation per row
- Put evidence URLs in the evidence field as full `http` or `https` links
- Keep column names reasonably close to the business labels above so the flexible matching continues to work

## How evidence works

The dashboard extracts URLs from the evidence field and treats them as attachments. If a link looks like an image URL or a Google Drive file URL, it can be previewed in the evidence modal. Otherwise, the UI shows a button that opens the original link.

## How to run the dashboard

Because this is a static site, setup is minimal:

1. Keep the existing file structure intact.
2. Make sure the configured Google Sheet and Apps Script deployment are accessible.
3. Open [index.html](index.html) in a browser.

For the most reliable behavior, host the folder through a local web server or static hosting platform instead of opening it directly as a local file.

## How to update the data

The normal operating model is to update the source spreadsheet rather than editing the dashboard code.

### Add new observations

1. Open the source Google Sheet.
2. Add one row per new observation.
3. Fill in the main observation fields.
4. Save the sheet.
5. Reload the dashboard or wait for the scheduled refresh.

### Correct existing observations

1. Find the row in the source sheet.
2. Update the required values.
3. Save the sheet.
4. Reload the dashboard if you need to see the change immediately.

## How to adapt this dashboard for another project

If you want to reuse the dashboard for a different project or department:

1. Copy the folder structure.
2. Replace the Google Sheet ID in [assets/app.js](assets/app.js).
3. Replace the Apps Script deployment URL in [assets/app.js](assets/app.js).
4. Set the correct `DATA_SOURCE_MODE`.
5. Adjust branding text in [index.html](index.html).
6. Keep your source columns compatible with the current parser, or extend the parser in [assets/app.js](assets/app.js).

## AI prompt used to create a similar dashboard

If you want to generate a dashboard like this with an AI assistant, use a prompt that is specific about both the UI and the data contract. A good prompt for this project would be:

```text
Build a browser-based HSE Observation Dashboard using plain HTML, CSS, and vanilla JavaScript.

Requirements:
- No framework and no build step
- Use Chart.js for charts and Papa Parse for CSV parsing
- Load live data from Google Sheets using either:
	1. a Google Apps Script web app that returns JSON, or
	2. a direct Google Sheet CSV export URL
- Add a fallback path for environments where direct CSV fetch is blocked
- Normalize incoming records so slightly different column names still work
- Support fields such as date, location, observer, designation, observation type, category, severity, immediate action, corrected on the spot, responsible person, corrective action, status, and evidence links

UI requirements:
- A professional HSE dashboard look and feel
- KPI cards for total reports, safe practices, unsafe acts, and closure rate
- Filters for observer, designation, status, and text search
- Tabs for overview, team, insights, trends, and log
- Charts for reporting trend, categories, designation, severity, weekly cadence, and monthly comparison
- Lists for hotspots, top reporters, and open-item aging
- A paginated log table with expandable row details
- Modal windows for report detail, evidence preview, and maximized chart panels

Behavior requirements:
- Filter charts and lists interactively
- Parse multiple evidence URLs from one field
- Preview image and Google Drive evidence when possible
- Refresh the live data on a timer
- Keep the configuration at the top of the JavaScript file
```

### Why this prompt works

- It defines the technology stack clearly
- It defines the expected data source options
- It names the UI modules that must exist
- It forces the generator to think about data normalization instead of assuming fixed headers
- It keeps the result compatible with a static HTML deployment model

## Google Apps Script sample code

The dashboard expects the Apps Script endpoint to return a JSON array of row objects, where the keys are the spreadsheet headers. The parser in [assets/app.js](assets/app.js) then maps those keys using partial name matching.

This sample Apps Script matches that expectation:

```javascript
function doGet() {
	var spreadsheetId = 'YOUR_SHEET_ID';
	var sheetName = 'Form Responses 1';
	var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);

	if (!sheet) {
		return ContentService
			.createTextOutput(JSON.stringify({ error: 'Sheet not found' }))
			.setMimeType(ContentService.MimeType.JSON);
	}

	var values = sheet.getDataRange().getValues();
	if (!values || values.length < 2) {
		return ContentService
			.createTextOutput(JSON.stringify([]))
			.setMimeType(ContentService.MimeType.JSON);
	}

	var headers = values[0];
	var rows = values.slice(1).map(function(row) {
		var item = {};
		headers.forEach(function(header, index) {
			item[String(header).trim()] = row[index];
		});
		return item;
	});

	return ContentService
		.createTextOutput(JSON.stringify(rows))
		.setMimeType(ContentService.MimeType.JSON);
}
```

### Deployment notes for Apps Script

1. Create a standalone Apps Script project or attach one to the spreadsheet.
2. Paste the script above and replace the sheet ID and sheet name.
3. Deploy it as a web app.
4. Give the deployment read access appropriate for your audience.
5. Copy the deployment URL into `APPS_SCRIPT_URL` in [assets/app.js](assets/app.js).

### Important format note

The front end currently expects the response body to be a JSON array. If you wrap the rows in an object like `{ data: [...] }`, the current parser will not use it unless you also update [assets/app.js](assets/app.js).

## Troubleshooting

If the dashboard loads without data, check these first:

- The Google Sheet ID is correct
- The Apps Script URL is correct
- The Apps Script deployment is published and readable
- The spreadsheet is accessible to the Apps Script and intended viewers
- The source sheet contains rows with non-empty location values
- Evidence links are valid URLs
- Your status and severity values are consistent enough for filtering and charts

If `direct-sheet` mode fails while opening the page locally, that is expected browser behavior. Use HTTP hosting or switch to the Apps Script path.

## Maintenance guidance

- Keep spreadsheet column names stable
- Treat the sheet as the source of truth for operational updates
- Update the parser only when the incoming sheet structure changes materially
- Keep configuration constants grouped at the top of [assets/app.js](assets/app.js)
- Test the dashboard after changing the sheet or Apps Script endpoint
- Keep a backup copy of the spreadsheet before making major edits

## 17) Quick Summary

In simple terms, this dashboard works like this:

1. Data is stored in Google Sheets or provided by Apps Script.
2. The web page reads that data.
3. The script cleans and standardizes it.
4. Charts and tables are generated automatically.
5. The page refreshes every 5 minutes so the latest data appears without manual rebuilding.
