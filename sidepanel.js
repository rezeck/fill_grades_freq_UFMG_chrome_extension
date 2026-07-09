/**
 * sidepanel.js
 *
 * Logic for the extension side panel (sidepanel.html). It runs in the side
 * panel context and never touches the target page DOM directly; all page
 * interaction goes through `chrome.tabs.sendMessage` to the content script
 * (content.js).
 *
 * Responsibilities:
 *   - Detect which mode the current tab is in (grades vs. frequency) and
 *     refresh the UI whenever the active tab changes or navigates, since the
 *     side panel stays open across tabs (unlike the old popup).
 *   - Parse the uploaded CSV with PapaParse and validate it.
 *   - Render the column picker and let the user choose which columns to fill.
 *   - Persist the parsed CSV state per-tab in `chrome.storage.session` so the
 *     UI survives the panel being closed and reopened.
 *   - Send the selected data to the content script to be written into the page.
 */

/**
 * Whether a matricula cell holds a usable (non-empty) value.
 * @param {*} matricula
 * @returns {boolean}
 */
function isValidMatricula(matricula) {
    return matricula != null && String(matricula).trim() !== "";
}

/**
 * Whether a parsed CSV row has at least one non-empty value.
 * @param {Object<string, *>} row
 * @returns {boolean}
 */
function hasAnyDataValue(row) {
    return Object.values(row).some(
        (value) => value != null && String(value).trim() !== ""
    );
}

/**
 * Parse CSV text into a matricula-keyed map of rows.
 *
 * Rows without a valid MATRICULA, or with no data values, are skipped and
 * counted. The MATRICULA column is removed from each stored row (it becomes the
 * map key). PapaParse runs synchronously here, so the `complete` callback fires
 * before this function returns.
 *
 * @param {string} csvText raw CSV file contents
 * @returns {{ data: Map<string, Object>, headers: string[] | undefined, skippedCount: number }}
 */
function parseCSV(csvText) {
    var skippedCount = 0;

    var csvData = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    });

    var headersCSV = csvData.meta.fields;

    if (csvData.errors.length > 0) {
        console.log("Parsing errors:", csvData.errors);
    }

    if (!headersCSV || headersCSV.length <= 0) {
        console.log("CSV headers empty");
    }

    const dataMap = csvData.data.reduce((mapAccum, row) => {
        var matricula = row.MATRICULA;

        if (!isValidMatricula(matricula)) {
            skippedCount++;
            return mapAccum;
        }

        delete row.MATRICULA;

        if (!hasAnyDataValue(row)) {
            skippedCount++;
            return mapAccum;
        }

        mapAccum.set(String(matricula).trim(), row);
        return mapAccum;
    }, new Map());

    return {
        "data": dataMap,
        "headers": headersCSV,
        "skippedCount": skippedCount
    };
}

/**
 * Show a message in the side panel status area.
 * @param {string} msg HTML message to display
 * @param {"success" | "error"} type controls the status styling class
 */
function showStatus(msg, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = msg;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
}

const CSV_STORAGE_KEY = "csvState";

/**
 * Persist the parsed CSV state for a given tab in session storage.
 * @param {string} tabUrl url used to scope the state to the originating tab
 * @param {"grades" | "frequency"} mode
 * @param {Map<string, Object>} data parsed rows keyed by matricula
 * @param {string[]} headers CSV header names
 * @param {string[]} selectedColumns columns the user chose to fill
 * @returns {Promise<void>}
 */
async function saveCsvState(tabUrl, mode, data, headers, selectedColumns) {
    await chrome.storage.session.set({
        [CSV_STORAGE_KEY]: {
            tabUrl,
            mode,
            parsedData: Object.fromEntries(data.entries()),
            parsedHeaders: headers,
            selectedColumns
        }
    });
}

/**
 * Load previously persisted CSV state, but only if it belongs to `tabUrl`.
 * @param {string} tabUrl
 * @returns {Promise<{ mode: string, parsedData: Map<string, Object>, parsedHeaders: string[], selectedColumns: string[] } | undefined>}
 */
async function loadCsvState(tabUrl) {
    const stored = await chrome.storage.session.get(CSV_STORAGE_KEY);
    const state = stored[CSV_STORAGE_KEY];
    if (!state || state.tabUrl !== tabUrl) {
        return undefined;
    }

    return {
        mode: state.mode,
        parsedData: new Map(Object.entries(state.parsedData)),
        parsedHeaders: state.parsedHeaders,
        selectedColumns: state.selectedColumns || []
    };
}

/**
 * Wire up a drag-and-drop CSV drop zone and its "browse" button.
 * @param {HTMLElement} dropZone container that accepts dropped files
 * @param {HTMLInputElement} fileInput hidden file input triggered by the button
 * @param {HTMLElement} browseBtn button that opens the file dialog
 * @param {(csvText: string) => void} onCsvText callback invoked with the file text
 */
function setupDropZone(dropZone, fileInput, browseBtn, onCsvText) {
    browseBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        fileInput.click();
    });

    dropZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", (event) => {
        if (!dropZone.contains(event.relatedTarget)) {
            dropZone.classList.remove("drag-over");
        }
    });

    dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropZone.classList.remove("drag-over");

        const file = event.dataTransfer?.files?.[0];
        if (!file) {
            showStatus("Please select a CSV file.", "error");
            return;
        }

        readCsvFile(file, onCsvText);
    });
}

/**
 * Read a File as text and hand the contents to `onCsvText`.
 * @param {File} file
 * @param {(csvText: string) => void} onCsvText
 */
function readCsvFile(file, onCsvText) {
    const reader = new FileReader();
    reader.onload = (e) => onCsvText(e.target.result);
    reader.onerror = () => showStatus("Failed to read the CSV file.", "error");
    reader.readAsText(file);
}

/**
 * Collect the values of all checked checkboxes inside a column list element.
 * @param {HTMLElement} listElement
 * @returns {string[]} selected column names
 */
function getSelectedColumns(listElement) {
    return [...listElement.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => input.value);
}

/**
 * Produce a new map containing only the requested columns, dropping rows that
 * end up with no values.
 * @param {Map<string, Object>} dataMap
 * @param {string[]} columns columns to keep
 * @returns {Map<string, Object>}
 */
function filterDataByColumns(dataMap, columns) {
    const filtered = new Map();
    for (const [matricula, row] of dataMap) {
        const filteredRow = {};
        for (const col of columns) {
            const value = row[col];
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                filteredRow[col] = value;
            }
        }
        if (Object.keys(filteredRow).length > 0) {
            filtered.set(matricula, filteredRow);
        }
    }
    return filtered;
}

/**
 * Render the grades column picker, showing every column present on the page
 * and/or in the CSV, and enabling only those that appear in both (fillable).
 *
 * @param {Object} config
 * @param {HTMLElement} config.listElement container for the checkbox rows
 * @param {HTMLElement} config.pickerElement wrapper shown once rendered
 * @param {string[]} config.pageHeaders AV headers detected on the page
 * @param {string[]} config.csvHeaders headers found in the CSV
 * @param {string[]|undefined} config.savedSelection previously selected columns
 * @param {() => void} config.onChange invoked whenever a checkbox toggles
 */
function renderGradesColumnPicker({
    listElement,
    pickerElement,
    pageHeaders,
    csvHeaders,
    savedSelection,
    onChange
}) {
    listElement.innerHTML = "";

    const csvCols = new Set(csvHeaders.filter((h) => h !== "MATRICULA"));
    const pageSet = new Set(pageHeaders);
    const allNames = [...new Set([...pageHeaders, ...csvHeaders.filter((h) => h !== "MATRICULA")])];

    for (const name of allNames) {
        const onPage = pageSet.has(name);
        const inCsv = csvCols.has(name);
        const fillable = onPage && inCsv;

        const label = document.createElement("label");
        label.className = "column-option" + (fillable ? "" : " column-unavailable");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = name;
        checkbox.disabled = !fillable;

        if (fillable) {
            const defaultChecked = savedSelection
                ? savedSelection.includes(name)
                : true;
            checkbox.checked = defaultChecked;
        }

        checkbox.addEventListener("change", onChange);

        const text = document.createElement("span");
        text.textContent = name;

        const badge = document.createElement("span");
        badge.className = "column-badge";

        if (fillable) {
            badge.classList.add("ok");
            badge.textContent = "page + CSV";
        } else if (inCsv && !onPage) {
            badge.classList.add("missing-page");
            badge.textContent = "CSV only";
        } else {
            badge.classList.add("missing-csv");
            badge.textContent = "page only";
        }

        label.appendChild(checkbox);
        label.appendChild(text);
        label.appendChild(badge);
        listElement.appendChild(label);
    }

    pickerElement.style.display = "block";
}

/**
 * Render the frequency column picker, which only offers the single FREQ column.
 * @param {Object} config
 * @param {HTMLElement} config.listElement container for the checkbox row
 * @param {HTMLElement} config.pickerElement wrapper shown once rendered
 * @param {string[]} config.csvHeaders headers found in the CSV
 * @param {() => void} config.onChange invoked when the checkbox toggles
 */
function renderFrequencyColumnPicker({ listElement, pickerElement, csvHeaders, onChange }) {
    listElement.innerHTML = "";

    const hasFreq = csvHeaders.includes("FREQ");
    const label = document.createElement("label");
    label.className = "column-option" + (hasFreq ? "" : " column-unavailable");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = "FREQ";
    checkbox.disabled = !hasFreq;
    checkbox.checked = hasFreq;
    checkbox.addEventListener("change", onChange);

    const text = document.createElement("span");
    text.textContent = "FREQ";

    const badge = document.createElement("span");
    badge.className = "column-badge " + (hasFreq ? "ok" : "missing-csv");
    badge.textContent = hasFreq ? "available" : "missing in CSV";

    label.appendChild(checkbox);
    label.appendChild(text);
    label.appendChild(badge);
    listElement.appendChild(label);

    pickerElement.style.display = "block";
}

/**
 * Validate parsed CSV state and update the step 2/3 UI accordingly.
 *
 * Throws (with a user-facing message) when the CSV is empty, lacks a MATRICULA
 * column, or when no columns are selected. On success it reveals step 3 and
 * shows a ready-to-fill status.
 *
 * @param {Object} config
 * @param {Map<string, Object>} config.parsedData
 * @param {string[]} config.parsedHeaders
 * @param {HTMLElement} config.parentStep2
 * @param {HTMLElement} config.parentStep3
 * @param {HTMLElement} config.csvHeaderOkDiv element showing the header list
 * @param {HTMLElement} config.csvElemDescDiv element showing the row count
 * @param {string[]} config.selectedColumns
 * @param {number} config.skippedCount rows skipped during parsing
 * @returns {{ parsedData: Map<string, Object>, parsedHeaders: string[], selectedColumns: string[] }}
 */
function validateParsedCsv({
    parsedData,
    parsedHeaders,
    parentStep2,
    parentStep3,
    csvHeaderOkDiv,
    csvElemDescDiv,
    selectedColumns,
    skippedCount
}) {
    const step_status = parentStep2.querySelector('.step-status');

    if (!parsedData || parsedData.size === 0 || !parsedHeaders || parsedHeaders.length <= 0) {
        csvHeaderOkDiv.innerHTML = "-";
        csvHeaderOkDiv.classList.add("red-color");
        csvHeaderOkDiv.classList.remove("green-color");
        csvElemDescDiv.innerHTML = 0;
        csvElemDescDiv.classList.add("red-color");
        csvElemDescDiv.classList.remove("green-color");
        const skipMsg = skippedCount > 0 ? ` (${skippedCount} row(s) skipped)` : "";
        throw new Error("CSV is empty or invalid." + skipMsg);
    }

    csvHeaderOkDiv.innerHTML = parsedHeaders.join(", ");
    if (!parsedHeaders.includes("MATRICULA")) {
        parentStep3.style.display = "none";
        csvHeaderOkDiv.classList.add("red-color");
        csvHeaderOkDiv.classList.remove("green-color");
        csvElemDescDiv.innerHTML = 0;
        csvElemDescDiv.classList.add("red-color");
        csvElemDescDiv.classList.remove("green-color");
        step_status.innerHTML = "&#10060;";
        throw new Error("CSV must include a MATRICULA column.");
    }

    if (!selectedColumns || selectedColumns.length <= 0) {
        parentStep3.style.display = "none";
        step_status.innerHTML = "&#10060;";
        throw new Error("Select at least one column to fill.");
    }

    csvHeaderOkDiv.classList.add("green-color");
    csvHeaderOkDiv.classList.remove("red-color");

    csvElemDescDiv.innerHTML = parsedData.size;
    if (parsedData.size <= 0) {
        parentStep3.style.display = "none";
        csvElemDescDiv.classList.add("red-color");
        csvElemDescDiv.classList.remove("green-color");
        step_status.innerHTML = "&#10060;";
        throw new Error("CSV has no valid rows.");
    }

    csvElemDescDiv.classList.add("green-color");
    csvElemDescDiv.classList.remove("red-color");
    step_status.innerHTML = "&#9989;";
    parentStep3.style.display = "block";

    let statusMsg = "CSV ready. Columns: " + selectedColumns.join(", ");
    if (skippedCount > 0) {
        statusMsg += `. ${skippedCount} row(s) skipped (empty matricula or grades).`;
    }
    showStatus(statusMsg, "success");

    return { parsedData, parsedHeaders, selectedColumns };
}

document.addEventListener('DOMContentLoaded', async () => {

    var parentStep1 = document.getElementById('grades-step-1');
    var parentStep2 = document.getElementById('grades-step-2');
    var parentStep3 = document.getElementById('grades-step-3');
    var tab = undefined;
    var parsedData = undefined;
    var parsedHeaders = undefined;
    var selectedColumns = [];
    var skippedCount = 0;
    var headersAV = undefined;
    var pageHeaders = [];
    var currentMode = "grades";

    // Bumped on every refresh; in-flight callbacks from a previous tab compare
    // against it and bail out instead of drawing stale results into the panel.
    var refreshToken = 0;

    const gradesColumnList = document.getElementById('gradesColumnList');
    const gradesColumnPicker = document.getElementById('grades-column-picker');
    const freqColumnList = document.getElementById('freqColumnList');
    const freqColumnPicker = document.getElementById('frequency-column-picker');

    /** Persist the current parsed CSV/selection for this tab, if any. */
    function persistState() {
        if (!parsedData || !parsedHeaders) return;
        saveCsvState(tab.url, currentMode, parsedData, parsedHeaders, selectedColumns);
    }

    /** Re-validate the grades step after the column selection changes. */
    function updateGradesStepFromSelection() {
        selectedColumns = getSelectedColumns(gradesColumnList);
        try {
            validateParsedCsv({
                parsedData,
                parsedHeaders,
                parentStep2,
                parentStep3,
                csvHeaderOkDiv: document.getElementById('csvHeadersOK'),
                csvElemDescDiv: document.getElementById('csvElementsDesc'),
                selectedColumns,
                skippedCount
            });
            persistState();
        } catch (err) {
            parentStep3.style.display = "none";
            showStatus(err.message, "error");
        }
    }

    /** Re-validate the frequency step after the column selection changes. */
    function updateFreqStepFromSelection() {
        selectedColumns = getSelectedColumns(freqColumnList);
        try {
            validateParsedCsv({
                parsedData,
                parsedHeaders,
                parentStep2,
                parentStep3,
                csvHeaderOkDiv: document.getElementById('freqCsvHeadersOK'),
                csvElemDescDiv: document.getElementById('freqCsvElementsDesc'),
                selectedColumns,
                skippedCount
            });
            persistState();
        } catch (err) {
            parentStep3.style.display = "none";
            showStatus(err.message, "error");
        }
    }

    /**
     * Rebuild the step 2/3 UI from previously persisted state (used when the
     * side panel reopens, or when the user returns to a tab whose CSV was
     * already uploaded).
     * @param {{ parsedData: Map<string, Object>, parsedHeaders: string[], selectedColumns: string[] }} state
     */
    function restoreCsvUi(state) {
        parsedData = state.parsedData;
        parsedHeaders = state.parsedHeaders;
        selectedColumns = state.selectedColumns || [];

        const csvHeaderOkDiv = currentMode === "grades"
            ? document.getElementById('csvHeadersOK')
            : document.getElementById('freqCsvHeadersOK');
        const csvElemDescDiv = currentMode === "grades"
            ? document.getElementById('csvElementsDesc')
            : document.getElementById('freqCsvElementsDesc');

        csvHeaderOkDiv.innerHTML = parsedHeaders.join(", ");
        csvHeaderOkDiv.classList.add("green-color");
        csvHeaderOkDiv.classList.remove("red-color");
        csvElemDescDiv.innerHTML = parsedData.size;
        csvElemDescDiv.classList.add("green-color");
        csvElemDescDiv.classList.remove("red-color");
        parentStep2.querySelector('.step-status').innerHTML = "&#9989;";
        parentStep2.style.display = "block";

        if (currentMode === "grades" && pageHeaders.length > 0) {
            renderGradesColumnPicker({
                listElement: gradesColumnList,
                pickerElement: gradesColumnPicker,
                pageHeaders,
                csvHeaders: parsedHeaders,
                savedSelection: selectedColumns,
                onChange: updateGradesStepFromSelection
            });
            updateGradesStepFromSelection();
        } else if (currentMode === "frequency") {
            renderFrequencyColumnPicker({
                listElement: freqColumnList,
                pickerElement: freqColumnPicker,
                csvHeaders: parsedHeaders,
                onChange: updateFreqStepFromSelection
            });
            updateFreqStepFromSelection();
        }
    }

    /**
     * Return the panel to its initial state: both interfaces hidden, steps
     * collapsed, indicators reset and the in-memory CSV state discarded.
     * Called before re-detecting the mode whenever the active tab changes.
     */
    function resetUi() {
        parsedData = undefined;
        parsedHeaders = undefined;
        selectedColumns = [];
        skippedCount = 0;
        headersAV = undefined;
        pageHeaders = [];
        currentMode = "grades";
        parentStep1 = document.getElementById('grades-step-1');
        parentStep2 = document.getElementById('grades-step-2');
        parentStep3 = document.getElementById('grades-step-3');

        document.getElementById('interface-grades').style.display = "none";
        document.getElementById('interface-frequency').style.display = "none";
        document.getElementById('invalid-url-msg').style.display = "none";

        for (const id of ['grades-step-2', 'grades-step-3', 'frequency-step-2', 'frequency-step-3']) {
            document.getElementById(id).style.display = "none";
        }
        gradesColumnPicker.style.display = "none";
        freqColumnPicker.style.display = "none";

        for (const [headerFoundId, step1Selector] of [
            ['headersAVFound', '#grades-step-1 .step-status'],
            ['headersFreqFound', '#frequency-step-1 .step-status']
        ]) {
            const headerFoundDiv = document.getElementById(headerFoundId);
            headerFoundDiv.classList.add("red-color");
            headerFoundDiv.classList.remove("green-color");
            headerFoundDiv.innerHTML = "None";
            document.querySelector(step1Selector).innerHTML = "&#10060;";
        }

        for (const [headerOkId, elemDescId, step2Selector] of [
            ['csvHeadersOK', 'csvElementsDesc', '#grades-step-2 .step-status'],
            ['freqCsvHeadersOK', 'freqCsvElementsDesc', '#frequency-step-2 .step-status']
        ]) {
            const headerOkDiv = document.getElementById(headerOkId);
            headerOkDiv.classList.add("red-color");
            headerOkDiv.classList.remove("green-color");
            headerOkDiv.innerHTML = "-";
            const elemDescDiv = document.getElementById(elemDescId);
            elemDescDiv.classList.add("red-color");
            elemDescDiv.classList.remove("green-color");
            elemDescDiv.innerHTML = "0";
            document.querySelector(step2Selector).innerHTML = "";
        }

        const statusDiv = document.getElementById('status');
        statusDiv.innerHTML = "";
        statusDiv.className = "";
        statusDiv.style.display = "none";
    }

    /**
     * Detect the mode for the current active tab and rebuild the panel UI.
     * Unlike a popup, the side panel stays open across tab switches and page
     * navigations, so this runs again on every tabs.onActivated / onUpdated
     * event (see the listeners at the bottom).
     */
    async function refreshForActiveTab() {
        const token = ++refreshToken;

        const [activeTab] = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true
        });

        if (token !== refreshToken) return;

        resetUi();

        if (!activeTab || !activeTab.url) {
            document.getElementById('invalid-url-msg').style.display = 'block';
            return;
        }

        tab = activeTab;

        const savedState = await loadCsvState(tab.url);
        if (token !== refreshToken) return;

        if (!tab.url.includes("localhost") &&
            !tab.url.includes("sistemas.ufmg.br/diario/frequenciaTurma/frequencia/solicitar/solicitarFrequencia.do") &&
            !tab.url.includes("sistemas.ufmg.br/diario/notaTurma/notaAvaliacao/solicitar/solicitarNota.do?acao=lancarAvaliacaoCompleta") &&
            !tab.url.includes("homepages.dcc.ufmg.br/~hector.azpurua/notas_mock/") &&
            !tab.url.includes("homepages.dcc.ufmg.br/~hector.azpurua/faltas_mock/")) {

            document.getElementById('invalid-url-msg').style.display = 'block';
            return;
        }

        if (tab.url.includes("sistemas.ufmg.br/diario/frequenciaTurma/frequencia/solicitar/solicitarFrequencia.do") ||
            tab.url.includes("~hector.azpurua/faltas_mock")
        ) {
            currentMode = "frequency";
            parentStep1 = document.getElementById('frequency-step-1');
            parentStep2 = document.getElementById('frequency-step-2');
            parentStep3 = document.getElementById('frequency-step-3');

            chrome.tabs.sendMessage(tab.id, { action: "check_if_in_total_freq_page" }, (response) => {
                if (token !== refreshToken) return;

                if (chrome.runtime.lastError) {
                    document.getElementById('invalid-url-msg').style.display = 'block';
                    showStatus("Error: refresh the page and try again.", "error");
                    return;
                }

                document.getElementById('interface-frequency').style.display = 'flex';
                document.getElementById('headersFreqFound').classList.remove("red-color");
                document.getElementById('headersFreqFound').classList.add("green-color");
                document.getElementById('headersFreqFound').innerHTML = 'FREQ';
                parentStep1.querySelector('.step-status').innerHTML = "&#9989;";
                parentStep2.style.display = "block";

                if (savedState && savedState.mode === "frequency") {
                    restoreCsvUi(savedState);
                }
            });
        } else {
            document.getElementById('interface-grades').style.display = 'flex';

            chrome.tabs.sendMessage(tab.id, { action: "get_av_headers" }, (response) => {
                if (token !== refreshToken) return;

                if (chrome.runtime.lastError) {
                    showStatus("Error: refresh the page and try again.", "error");
                    return;
                }

                const headersAVFoundDiv = document.getElementById('headersAVFound');
                const step_status = parentStep1.querySelector('.step-status');

                if (response && response.status === "success") {
                    headersAV = response.message;
                    pageHeaders = headersAV.split(', ');
                    headersAVFoundDiv.classList.remove("red-color");
                    headersAVFoundDiv.classList.add("green-color");
                    headersAVFoundDiv.innerHTML = headersAV;
                    step_status.innerHTML = "&#9989;";
                    parentStep2.style.display = "block";

                    if (savedState && savedState.mode === "grades") {
                        restoreCsvUi(savedState);
                    }
                } else {
                    showStatus(`Error: ${response.message}`, "error");
                    headersAVFoundDiv.classList.add("red-color");
                    headersAVFoundDiv.classList.remove("green-color");
                    headersAVFoundDiv.innerHTML = "None";
                    step_status.innerHTML = "&#10060;";
                    parentStep2.style.display = "none";
                    parentStep3.style.display = "none";
                }
            });
        }
    }

    /**
     * Handle a grades CSV file's text: parse, render the picker and validate.
     * @param {string} text raw CSV contents
     */
    function handleGradesCsvText(text) {
        try {
            if (!headersAV || pageHeaders.length === 0) {
                throw new Error("Wait for step 1 to finish before uploading the CSV.");
            }

            var parseResult = parseCSV(text);
            parsedData = parseResult["data"];
            parsedHeaders = parseResult["headers"];
            skippedCount = parseResult["skippedCount"] || 0;

            renderGradesColumnPicker({
                listElement: gradesColumnList,
                pickerElement: gradesColumnPicker,
                pageHeaders,
                csvHeaders: parsedHeaders,
                savedSelection: undefined,
                onChange: updateGradesStepFromSelection
            });
            updateGradesStepFromSelection();
        } catch (err) {
            parsedData = undefined;
            gradesColumnPicker.style.display = "none";
            parentStep3.style.display = "none";
            showStatus(err.message, "error");
        }
    }

    /**
     * Handle a frequency CSV file's text: parse, render the picker and validate.
     * @param {string} text raw CSV contents
     */
    function handleFrequencyCsvText(text) {
        try {
            var parseResult = parseCSV(text);
            parsedData = parseResult["data"];
            parsedHeaders = parseResult["headers"];
            skippedCount = parseResult["skippedCount"] || 0;

            renderFrequencyColumnPicker({
                listElement: freqColumnList,
                pickerElement: freqColumnPicker,
                csvHeaders: parsedHeaders,
                onChange: updateFreqStepFromSelection
            });
            updateFreqStepFromSelection();
        } catch (err) {
            parsedData = undefined;
            freqColumnPicker.style.display = "none";
            parentStep3.style.display = "none";
            showStatus(err.message, "error");
        }
    }

    /**
     * Wire a "fill" button: resolve the current CSV data (restoring from
     * storage if needed), filter it by the selected columns and send it to the
     * content script.
     * @param {Object} config
     * @param {string} config.buttonId id of the fill button
     * @param {"grades" | "frequency"} config.mode
     * @param {string} config.action content-script action to invoke
     * @param {HTMLElement} config.listElement column list to read the selection from
     */
    function setupFillButton({ buttonId, mode, action, listElement }) {
        document.getElementById(buttonId).addEventListener('click', async () => {
            if (!parsedData) {
                const restored = await loadCsvState(tab.url);
                if (restored && restored.mode === mode) {
                    parsedData = restored.parsedData;
                    selectedColumns = restored.selectedColumns || [];
                }
            } else {
                selectedColumns = getSelectedColumns(listElement);
            }

            if (!parsedData || selectedColumns.length === 0) {
                showStatus("No CSV data or selected columns available.", "error");
                return;
            }

            const filtered = filterDataByColumns(parsedData, selectedColumns);

            const message = { action, data: Object.fromEntries(filtered.entries()) };
            if (action === "fill_grade_form") {
                message.columns = selectedColumns;
            }

            chrome.tabs.sendMessage(tab.id, message, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus("Error: refresh the page and try again.", "error");
                    return;
                }

                if (response && response.status === "success") {
                    showStatus(`Success! ${response.message}.`, "success");
                } else {
                    showStatus(`Error: ${response.message}`, "error");
                }
            });
        });
    }

    const csvInput = document.getElementById('csvInput');
    const csvBrowseBtn = document.getElementById('csvBrowseBtn');
    csvInput.addEventListener('change', () => {
        const file = csvInput.files[0];
        if (!file) return;
        readCsvFile(file, handleGradesCsvText);
        csvInput.value = "";
    });
    setupDropZone(
        document.getElementById('csvDropZone'),
        csvInput,
        csvBrowseBtn,
        handleGradesCsvText
    );

    document.getElementById('gradesSelectAllBtn').addEventListener('click', () => {
        gradesColumnList.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((cb) => {
            cb.checked = true;
        });
        updateGradesStepFromSelection();
    });

    document.getElementById('gradesSelectNoneBtn').addEventListener('click', () => {
        gradesColumnList.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((cb) => {
            cb.checked = false;
        });
        updateGradesStepFromSelection();
    });

    setupFillButton({
        buttonId: 'fillGradesBtn',
        mode: 'grades',
        action: 'fill_grade_form',
        listElement: gradesColumnList
    });

    const freqCsvInput = document.getElementById('freqCsvInput');
    const freqCsvBrowseBtn = document.getElementById('freqCsvBrowseBtn');
    freqCsvInput.addEventListener('change', () => {
        const file = freqCsvInput.files[0];
        if (!file) return;
        readCsvFile(file, handleFrequencyCsvText);
        freqCsvInput.value = "";
    });
    setupDropZone(
        document.getElementById('freqCsvDropZone'),
        freqCsvInput,
        freqCsvBrowseBtn,
        handleFrequencyCsvText
    );

    setupFillButton({
        buttonId: 'fillFreqBtn',
        mode: 'frequency',
        action: 'fill_frequency_form',
        listElement: freqColumnList
    });

    await refreshForActiveTab();

    // The side panel outlives tab switches and navigations, so keep the UI in
    // sync with whichever tab is active.
    chrome.tabs.onActivated.addListener(() => {
        refreshForActiveTab();
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, updatedTab) => {
        if (updatedTab.active && changeInfo.status === "complete") {
            refreshForActiveTab();
        }
    });
});
