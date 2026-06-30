function isValidMatricula(matricula) {
    return matricula != null && String(matricula).trim() !== "";
}

function hasAnyDataValue(row) {
    return Object.values(row).some(
        (value) => value != null && String(value).trim() !== ""
    );
}

function parseCSV(csvText) {
    var headersCSV = undefined;
    var skippedCount = 0;

    var csvData = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
            headersCSV = results.meta.fields;

            if (results.errors.length > 0) {
                console.log("Parsing errors:", results.errors);
            }

            if (headersCSV.length <= 0) {
                console.log("CSV headers empty");
            }
        }
    });

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

function showStatus(msg, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = msg;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
}

const CSV_STORAGE_KEY = "csvState";

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

function readCsvFile(file, onCsvText) {
    const reader = new FileReader();
    reader.onload = (e) => onCsvText(e.target.result);
    reader.onerror = () => showStatus("Failed to read the CSV file.", "error");
    reader.readAsText(file);
}

function getSelectedColumns(listElement) {
    return [...listElement.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => input.value);
}

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
 * @param {Object} config
 * @param {HTMLElement} config.listElement
 * @param {HTMLElement} config.pickerElement
 * @param {string[]} config.pageHeaders
 * @param {string[]} config.csvHeaders
 * @param {string[]|undefined} config.savedSelection
 * @param {() => void} config.onChange
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
    var parsedData = undefined;
    var parsedHeaders = undefined;
    var selectedColumns = [];
    var skippedCount = 0;
    var headersAV = undefined;
    var pageHeaders = [];
    var currentMode = "grades";

    const gradesColumnList = document.getElementById('gradesColumnList');
    const gradesColumnPicker = document.getElementById('grades-column-picker');
    const freqColumnList = document.getElementById('freqColumnList');
    const freqColumnPicker = document.getElementById('frequency-column-picker');

    let [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    const savedState = await loadCsvState(tab.url);

    function persistState() {
        if (!parsedData || !parsedHeaders) return;
        saveCsvState(tab.url, currentMode, parsedData, parsedHeaders, selectedColumns);
    }

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

    if (!tab.url.includes("localhost") &&
        !tab.url.includes("sistemas.ufmg.br/diario/frequenciaTurma/frequencia/solicitar/solicitarFrequencia.do") &&
        !tab.url.includes("sistemas.ufmg.br/diario/notaTurma/notaAvaliacao/solicitar/solicitarNota.do?acao=lancarAvaliacaoCompleta") &&
        !tab.url.includes("homepages.dcc.ufmg.br/~hector.azpurua/notas_mock/")) {

        document.getElementById('interface-grades').style.display = 'none';
        document.getElementById('interface-frequency').style.display = 'none';
        document.getElementById('invalid-url-msg').style.display = 'block';
    } else {
        if (tab.url.includes("sistemas.ufmg.br/diario/frequenciaTurma/frequencia/solicitar/solicitarFrequencia.do")) {
            currentMode = "frequency";
            parentStep1 = document.getElementById('frequency-step-1');
            parentStep2 = document.getElementById('frequency-step-2');
            parentStep3 = document.getElementById('frequency-step-3');

            chrome.tabs.sendMessage(tab.id, { action: "check_if_in_total_freq_page" }, (response) => {
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

    document.getElementById('fillGradesBtn').addEventListener('click', async () => {
        if (!parsedData) {
            const restored = await loadCsvState(tab.url);
            if (restored && restored.mode === "grades") {
                parsedData = restored.parsedData;
                selectedColumns = restored.selectedColumns || [];
            }
        } else {
            selectedColumns = getSelectedColumns(gradesColumnList);
        }

        if (!parsedData || selectedColumns.length === 0) {
            showStatus("No CSV data or selected columns available.", "error");
            return;
        }

        const filtered = filterDataByColumns(parsedData, selectedColumns);

        chrome.tabs.sendMessage(tab.id, {
            action: "fill_grade_form",
            data: Object.fromEntries(filtered.entries()),
            columns: selectedColumns
        }, (response) => {
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

    document.getElementById('fillFreqBtn').addEventListener('click', async () => {
        if (!parsedData) {
            const restored = await loadCsvState(tab.url);
            if (restored && restored.mode === "frequency") {
                parsedData = restored.parsedData;
                selectedColumns = restored.selectedColumns || [];
            }
        } else {
            selectedColumns = getSelectedColumns(freqColumnList);
        }

        if (!parsedData || selectedColumns.length === 0) {
            showStatus("No CSV data or selected columns available.", "error");
            return;
        }

        const filtered = filterDataByColumns(parsedData, selectedColumns);

        chrome.tabs.sendMessage(tab.id, {
            action: "fill_frequency_form",
            data: Object.fromEntries(filtered.entries())
        }, (response) => {
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
});
