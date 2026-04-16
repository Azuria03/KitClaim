// ════════════════════════════════════════════════════════════════
//  RACE KIT CLAIMING — Google Apps Script Backend
//  Deploy as Web App:
//    Execute as: Me
//    Who has access: Anyone (or Anyone with Google Account)
// ════════════════════════════════════════════════════════════════

// ── CONFIGURATION ───────────────────────────────────────────────
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← Replace this
const SHEET_RACE = 'RACE';
const SHEET_CRITERIUM = 'CRITERIUM';

// RACE sheet column indices (0-based)
const RACE_COLS = {
  KIT_CLAIMING: 0,   // A - KIT CLAIMING
  KIT_TIME:     1,   // B - KIT TIME
  BIB:          2,   // C - Bib
  NAME:         3,   // D - Name
  FIRST_NAME:   4,   // E - First name
  LAST_NAME:    5,   // F - Last name
  GENDER:       6,   // G - Gender
  TEAM:         7,   // H - Team name
  DISTANCE:     8,   // I - Distance
  CATEGORY:     9,   // J - Category
  EVENT_SHIRT:  10,  // K - Event Shirt
  SINGLET:      11   // L - Singlet
};

// CRITERIUM sheet column indices (0-based)
const CRIT_COLS = {
  KIT_CLAIMING: 0,   // A - KIT CLAIMING
  KIT_TIME:     1,   // B - KIT CLAIM TIME
  BIB:          2,   // C - Bib
  NAME:         3,   // D - Name
  FIRST_NAME:   4,   // E - First name
  LAST_NAME:    5,   // F - Last name
  GENDER:       6,   // G - Gender
  TEAM:         7,   // H - Team name
  CATEGORY:     8,   // I - Category
  SHIRT_SIZE:   9    // J - Shirt Size
};

// ── CORS HEADERS ─────────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function jsonResponse(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── HANDLE OPTIONS (CORS preflight) ──────────────────────────────
function doOptions(e) {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

// ════════════════════════════════════════════════════════════════
//  GET — ?action=participants
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'participants') {
      return getParticipants();
    }
    return jsonResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function getParticipants() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const results = [];

  // ── RACE sheet ──
  try {
    const raceSheet = ss.getSheetByName(SHEET_RACE);
    if (raceSheet) {
      const data = raceSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) { // skip header row
        const row = data[i];
        const bib = String(row[RACE_COLS.BIB] || '').trim();
        if (!bib) continue;
        results.push({
          bib: bib,
          name: String(row[RACE_COLS.NAME] || '').trim(),
          firstName: String(row[RACE_COLS.FIRST_NAME] || '').trim(),
          lastName: String(row[RACE_COLS.LAST_NAME] || '').trim(),
          gender: String(row[RACE_COLS.GENDER] || '').trim(),
          team: String(row[RACE_COLS.TEAM] || '').trim(),
          category: String(row[RACE_COLS.CATEGORY] || '').trim(),
          distance: String(row[RACE_COLS.DISTANCE] || '').trim(),
          eventShirt: String(row[RACE_COLS.EVENT_SHIRT] || '').trim(),
          singlet: String(row[RACE_COLS.SINGLET] || '').trim(),
          shirtSize: '',
          claimed: String(row[RACE_COLS.KIT_CLAIMING]).toUpperCase() === 'YES',
          claimTime: formatDate(row[RACE_COLS.KIT_TIME]),
          source: 'race',
          _row: i + 1 // 1-based sheet row (not sent to client, GAS only)
        });
      }
    }
  } catch(e) { Logger.log('RACE sheet error: ' + e); }

  // ── CRITERIUM sheet ──
  try {
    const critSheet = ss.getSheetByName(SHEET_CRITERIUM);
    if (critSheet) {
      const data = critSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const bib = String(row[CRIT_COLS.BIB] || '').trim();
        if (!bib) continue;
        results.push({
          bib: bib,
          name: String(row[CRIT_COLS.NAME] || '').trim(),
          firstName: String(row[CRIT_COLS.FIRST_NAME] || '').trim(),
          lastName: String(row[CRIT_COLS.LAST_NAME] || '').trim(),
          gender: String(row[CRIT_COLS.GENDER] || '').trim(),
          team: String(row[CRIT_COLS.TEAM] || '').trim(),
          category: String(row[CRIT_COLS.CATEGORY] || '').trim(),
          distance: '',
          eventShirt: '',
          singlet: '',
          shirtSize: String(row[CRIT_COLS.SHIRT_SIZE] || '').trim(),
          claimed: String(row[CRIT_COLS.KIT_CLAIMING]).toUpperCase() === 'YES',
          claimTime: formatDate(row[CRIT_COLS.KIT_TIME]),
          source: 'criterium'
        });
      }
    }
  } catch(e) { Logger.log('CRITERIUM sheet error: ' + e); }

  // Remove internal _row before returning (not needed by client)
  const clean = results.map(({ _row, ...rest }) => rest);
  return jsonResponse(clean);
}

// ════════════════════════════════════════════════════════════════
//  POST — action: "claim"
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch {
      return jsonResponse({ status: 'error', message: 'Invalid JSON body' });
    }

    if (body.action === 'claim') {
      return processClaim(body);
    }
    return jsonResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function processClaim(body) {
  const { bib, source, staff } = body;
  if (!bib) return jsonResponse({ status: 'error', message: 'Missing bib' });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const bibStr = String(bib).trim();

  if (source === 'criterium') {
    return claimInSheet(ss, SHEET_CRITERIUM, CRIT_COLS, bibStr, staff);
  } else {
    return claimInSheet(ss, SHEET_RACE, RACE_COLS, bibStr, staff);
  }
}

function claimInSheet(ss, sheetName, cols, bib, staff) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return jsonResponse({ status: 'error', message: `Sheet "${sheetName}" not found` });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowBib = String(data[i][cols.BIB] || '').trim();
    if (rowBib !== bib) continue;

    // Check if already claimed
    const alreadyClaimed = String(data[i][cols.KIT_CLAIMING]).toUpperCase() === 'YES';
    if (alreadyClaimed) {
      return jsonResponse({
        status: 'already_claimed',
        message: `Bib #${bib} was already claimed at ${formatDate(data[i][cols.KIT_TIME])}`
      });
    }

    // Mark as claimed
    const now = new Date();
    const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const rowNum = i + 1;

    sheet.getRange(rowNum, cols.KIT_CLAIMING + 1).setValue('YES');
    sheet.getRange(rowNum, cols.KIT_TIME + 1).setValue(timeStr);

    // Log to a Claims Log sheet (optional, non-breaking)
    try { appendClaimLog(ss, bib, sheetName, timeStr, staff); } catch(e) {}

    return jsonResponse({
      status: 'ok',
      message: `Bib #${bib} claimed`,
      bib: bib,
      claimTime: timeStr
    });
  }

  return jsonResponse({ status: 'error', message: `Bib #${bib} not found in ${sheetName}` });
}

// ── OPTIONAL: Claim Audit Log ────────────────────────────────────
function appendClaimLog(ss, bib, sheet, time, staff) {
  let logSheet = ss.getSheetByName('CLAIM_LOG');
  if (!logSheet) {
    logSheet = ss.insertSheet('CLAIM_LOG');
    logSheet.appendRow(['Timestamp', 'Bib', 'Sheet', 'Staff']);
  }
  logSheet.appendRow([time, bib, sheet, staff || '']);
}

// ── HELPERS ───────────────────────────────────────────────────────
function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(val).trim();
}

// ════════════════════════════════════════════════════════════════
//  DEPLOYMENT CHECKLIST (read before deploying)
// ════════════════════════════════════════════════════════════════
/*
  1. Replace SPREADSHEET_ID at the top with your actual Sheet ID
     (found in the Sheets URL: /spreadsheets/d/SPREADSHEET_ID/edit)

  2. Make sure your RACE sheet has these columns in order (row 1 = headers):
     A: KIT CLAIMING | B: KIT TIME | C: Bib | D: Name | E: First name
     F: Last name | G: Gender | H: Team name | I: Distance
     J: Category | K: Event Shirt | L: Singlet

  3. Make sure your CRITERIUM sheet has these columns:
     A: KIT CLAIMING | B: KIT CLAIM TIME | C: Bib | D: Name | E: First name
     F: Last name | G: Gender | H: Team name | I: Category | J: Shirt Size

  4. Deploy > New deployment > Web App
     - Execute as: Me
     - Who has access: Anyone
     - Click Deploy → copy the Web App URL

  5. Paste the Web App URL into the frontend app's ⚙ Config section

  6. Click "Fetch Data" in the frontend — done!
*/
