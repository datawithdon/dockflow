# DockFlow

An inbound control tower for warehouses. DockFlow follows every inbound
shipment from dock booking to client invoice:

1. You book it into a dock door.
2. It checks the documents against each other.
3. It records what was actually counted at the dock, plus damage photos.
4. It runs the demurrage and detention clocks on the container.
5. It turns receipts, releases and services into monthly storage invoices.

**Live demo:** https://datawithdon.github.io/dockflow/ (open **Settings → Data → Load demo data**)

DockFlow is a fully static web app. There's no backend, no account and no
tracking, and your data never leaves your browser. The one optional exception
is AI document reading, which sends the document you choose to the Claude API
using your own key.

## Features

### Today
- **Exceptions feed**, worst first:
  - containers in demurrage or detention, or about to be
  - empties not yet returned
  - shipments past their ETA
  - document mismatches
  - shortages or damage with no claim
  - late or missed trucks
  - claims left unsubmitted
- **Free-time board**: every container on a running clock, sorted by days left, with the cost so far and the extra cost if it waits three more days.
- Today's dock appointments with their live status.

### Dock schedule
- One lane per door, in 30-minute rows, with a now-line and a utilisation bar for each door.
- Booking checks for:
  - overlaps on the same door
  - bookings outside the door's hours
  - reefer loads at doors without a plug-in
  - dangerous goods at doors not approved for them
  - equipment the door isn't set up for
- **Suggest free slots** lists the doors and times that fit the load.
- Check-in → unloading → done, plus no-show and cancel. Trucks show as late after a grace period you set, and as missed once their slot has passed.
- Printable daily schedule.

### Documents & match
- Four document slots: purchase order, packing list, commercial invoice and bill of lading.
- Three ways to get lines in:
  - **AI reading** of a PDF or photo, with a review step before anything is saved
  - **CSV import**, which recognises common column names (Item No, Qty, CTNS, Gross Weight, HTS Code…)
  - manual entry
- **Three-way match** by SKU flags:
  - missing lines and quantity differences, with a tolerance you set
  - over-shipment
  - HS codes that differ between the packing list and the invoice
  - HS codes that are too short or don't exist in HS 2022
  - B/L and packing list disagreeing on gross weight or package count
  - a container or seal number that doesn't match the shipment
  - a container number that fails its ISO 6346 check digit

### Receiving & OS&D
- Count screen that works on a tablet: expected vs. received vs. damaged for each line, plus unexpected items.
- Seal check at arrival, pallets put away, receiver name.
- Photos taken with the device camera, downscaled and stored in the browser.
- Printable **receiving / OS&D report** with photos and signature lines.
- One-click **claim** that values shortages and damage at invoice (or PO) unit prices.

### Free time (demurrage & detention)
- Tariffs per shipping line with free days and tiered daily rates (e.g. `1:95, 5:165, 10:260`).
- Demurrage and detention as separate clocks, or merged into one combined clock.
- Days counted inclusively. The app shows each clock's last free day, days left, chargeable days and cost.
- A "what waiting costs" table for the next 7 days.

### Claims
- A register of claims with open, submitted, settled and rejected states, the amounts claimed and recovered, and a printable notice of claim with photos.

### Billing (3PL)
- Rates per client:
  - handling in and out, per pallet
  - storage per pallet per day, with free days
  - devanning per 20' and 40' container
  - a monthly minimum
- Storage is counted from receipts and releases. A pallet is charged on the day it's received but not on the day it's released.
- Extra services (relabelling, shrink wrap…) logged against each shipment.
- Monthly draft invoices for each client. You can issue, print, mark paid or void them, and export to CSV.

### Analytics
- Carrier on-time arrival rate, with no-shows and average time at the door.
- Door utilisation over the last 14 days.
- D&D cost by shipping line.
- Receiving accuracy by supplier.
- Every chart has a table view.

## Run it locally

ES modules need to be served over HTTP. Opening `index.html` as a file won't work.

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000
```

Run the tests (Node 20+, nothing to install):

```bash
npm test
```

## AI document reading (optional)

DockFlow can read a PDF or a photo of a packing list, invoice, purchase order
or bill of lading into line items.

1. Get an API key from the [Claude Console](https://console.anthropic.com/). Setting a spend limit on it is a good idea.
2. Paste the key into **Settings → AI**.
3. On a shipment's **Documents** tab, click **Read PDF/photo (AI)**.

How it works:
- The browser calls `https://api.anthropic.com/v1/messages` directly, using structured outputs so the reply is JSON in a fixed schema.
- The default model is Claude Opus 5.5. Sonnet 5.5 and Haiku 5.5 are cheaper options.
- Whatever the model returns is treated as untrusted data. Every field is type-checked and length-limited, and you check the extracted lines before they're saved.
- By default the key is held in `sessionStorage` and forgotten when the tab closes. **Remember on this device** moves it to `localStorage`. Only use that on a computer you trust.
- The key is never written to IndexedDB, backups or exports.

## CSV format for document lines

The header row needs an item column and a quantity column. All other columns are optional. Names are matched case-insensitively.

| Field | Accepted headers (examples) |
|---|---|
| SKU | `sku`, `item no`, `part number`, `article`, `style` |
| Description | `description`, `product name`, `goods description` |
| Quantity (units) | `qty`, `quantity`, `units`, `pcs` |
| Cartons | `cartons`, `ctns`, `packages`, `cases` |
| Gross weight (kg) | `gross kg`, `gross weight`, `gw`, `weight` |
| HS code | `hs`, `hs code`, `hts`, `tariff code` |
| Unit price | `unit price`, `price`, `unit value` |

Rows with no SKU or a non-numeric quantity are skipped and reported.

## Data, privacy and security

- All data lives in your browser's IndexedDB: doors, clients, tariffs, shipments, appointments, claims, invoices and photos. Use **Settings → Data → Download backup** to move it or keep a copy. Photos are optional in the backup.
- A strict Content-Security-Policy allows only the app's own files to load, and allows network calls only to `api.anthropic.com`. That means no third-party scripts, fonts or analytics.
- Everything on screen is rendered through `textContent`, never `innerHTML`, so text from documents, CSVs, backups or AI output can't inject markup.
- Spreadsheet formulas in CSV exports are neutralised to block formula injection.
- Backup files are validated before they're restored. Images must be base64 PNG, JPEG, WebP or GIF data URLs.
- **Settings → Data → Erase all data** removes everything, including the saved API key.

## Project structure

```
index.html          app shell + CSP
css/styles.css      styles (light/dark, print layouts)
js/engine/          pure logic, unit-tested in Node
  dates.js          date arithmetic
  container.js      ISO 6346 check digit
  freetime.js       demurrage & detention clocks, tiered costs
  schedule.js       dock conflicts, live state, free slots, utilisation
  match.js          PO / packing list / invoice / B/L matching
  receiving.js      expected lines, OS&D
  billing.js        pallet-days and invoice drafts
  exceptions.js     the exceptions feed
  analytics.js      metrics
  csv.js            CSV parse/export
  extract.js        Claude request + response validation
js/views/           one file per screen
js/ai.js            Claude API call
js/db.js            IndexedDB storage
js/state.js         app state, API key handling, backup/restore
js/sample.js        demo data (fictional companies)
data/hs-codes.json  WCO HS 2022 6-digit subheadings
tests/              node:test suites
```

## Notes and limits

- D&D is calculated in calendar days. Some lines exclude weekends or public holidays, so check your tariff.
- The Incoterm, customs and duty side of a shipment is out of scope here. See [QuoteCraft](https://github.com/datawithdon/quotecraft) and [HS Code Finder](https://github.com/datawithdon/hs-code-finder).
- One browser means one dataset. DockFlow doesn't sync between users or devices.

## License

MIT
