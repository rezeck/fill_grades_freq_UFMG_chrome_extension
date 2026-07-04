/**
 * content.js
 *
 * Content script injected into UFMG's `Diario de Classe` pages (and the mock
 * test pages). It has direct access to the page DOM and is responsible for:
 *   - Reading the list of evaluation (AV) column headers from the grades page.
 *   - Filling grade inputs from CSV data sent by the popup.
 *   - Filling the total-frequency inputs from CSV data sent by the popup.
 *
 * The popup (popup.js) never touches the page DOM directly; it communicates
 * with this script exclusively through `chrome.tabs.sendMessage`. Each message
 * carries an `action` and this script replies via `sendResponse` with a
 * `{ status: "success" | "error", message?: string }` object.
 */

/**
 * Whether an input can be written to (present, enabled and not read-only).
 * @param {HTMLInputElement | null | undefined} input
 * @returns {boolean}
 */
function isInputEditable(input) {
    return input && !input.disabled && !input.readOnly;
}

/**
 * Build a map of evaluation header text -> numeric AV id by reading the grades
 * table on the page.
 *
 * The header labels live as `<a>` elements inside `#notasHead`, while the AV
 * numeric id is encoded in the id of each input of the first table row
 * (`@<matricula>_<avId>`). The two lists are matched positionally.
 *
 * On any parsing problem the error is logged and an empty map is returned, so
 * callers should treat an empty map as "page not recognized".
 *
 * @returns {Map<string, string>} header label -> AV id (e.g. "AV1" -> "1")
 */
function getAvHeadersMap() {
    var avToId = new Map();

    try {
        // get list of avaliations from the table header
        var parentElement = document.getElementById("notasHead");
        if (!parentElement) {
            throw new Error("Element with id 'notasHead' not found");
        }

        var avList = parentElement.querySelectorAll('a');

        // get the first element
        var tblAv = document.getElementById("tabelaAvaliacoes");
        if (!tblAv) {
            throw new Error("Element with id 'tabelaAvaliacoes' not found");
        }

        var trList = tblAv.querySelectorAll('tr');
        if (trList.length === 0) {
            throw new Error("No rows found in 'tabelaAvaliacoes'");
        }
        var inputList = trList[0].querySelectorAll('input');

        const avIdRegex = /^@.*_(\d)$/;
        var avSize = avList.length;

        for (let i = 0; i < avSize; i++) {
            var avElement = avList[i];
            var avText = avElement.innerText;
            var inputElement = inputList[i];
            if (!inputElement) {
                throw new Error("No input found for AV header '" + avText + "'");
            }
            const result = inputElement.id.match(avIdRegex);
            if (!result) {
                throw new Error("Input id '" + inputElement.id + "' does not match the expected AV pattern");
            }

            avToId.set(avText, result[1]);
        }
    } catch (error) {
        // @ts-ignore
        console.error("[ERROR] Problem parsing page for AV information:", error.message);
    }

    return avToId;
}

/**
 * Message router for the content script.
 *
 * Handles the four actions used by the popup:
 *   - "get_av_headers": return the comma-separated AV header labels.
 *   - "fill_grade_form": write grade values into the page inputs.
 *   - "check_if_in_total_freq_page": verify the current page is the total
 *     frequency form.
 *   - "fill_frequency_form": write frequency values into the page inputs.
 *
 * Returns `true` to keep the message channel open for the asynchronous
 * `sendResponse` calls made by the fill handlers.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_av_headers") {
        var avToId = getAvHeadersMap();

        if (avToId.size <= 0) {
            sendResponse(
                { status: "error", message: "No AV headers found, check URL and try again" });
            return;
        }

        const keysArray = [...avToId.keys()];
        const keysStringComma = keysArray.join(", ");
        sendResponse({
            status: "success",
            message: keysStringComma
        });
    }
    else if (request.action === "fill_grade_form") {
        if (document.querySelectorAll('.tit_on').length <= 0) {
            sendResponse(
                { status: "error", message: "Current page is not `Lançamento de Notas/Todas as Avaliações`, check URL and try again" });
            return;
        }

        try {
            const csvDataMap = new Map(Object.entries(request.data));
            const columnsToFill = request.columns || null;

            let filledCount = 0;
            let blockedMatriculas = new Set([]);
            let missingMatriculas = new Set([]);

            var avToId = getAvHeadersMap();

            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            /**
             * Iterate every student row and write the selected grade columns,
             * pausing briefly between students so the page stays responsive.
             * Counters are kept per student so the reported totals reflect how
             * many students actually had at least one field filled/blocked.
             */
            async function processLoopAsyncWithDelay() {
                for (const [matricula, value] of csvDataMap) {
                    if (!value || Object.keys(value).length === 0) continue;

                    let studentFilled = 0;
                    let studentBlocked = 0;
                    let studentMissing = 0;

                    for (var avKeyName in value) {
                        if (columnsToFill && !columnsToFill.includes(avKeyName)) continue;
                        if (!avToId.has(avKeyName)) continue;

                        var avKeyId = avToId.get(avKeyName);
                        var avValue = value[avKeyName];
                        if (avValue == null || String(avValue).trim() === "") continue;

                        var idAvName = "@" + matricula + "_" + avKeyId;
                        var avMatriculaKey = document.getElementById(idAvName);

                        if (!avMatriculaKey) {
                            studentMissing++;
                            continue;
                        }

                        if (!isInputEditable(avMatriculaKey)) {
                            studentBlocked++;
                            continue;
                        }

                        avValue = String(avValue).replace(/\./g, ',');
                        avMatriculaKey.value = avValue;
                        avMatriculaKey.style.backgroundColor = "lightcyan";
                        studentFilled++;
                    }

                    if (studentFilled > 0) {
                        filledCount++;
                        if (studentBlocked > 0) {
                            blockedMatriculas.add(matricula);
                        }
                    } else if (studentBlocked > 0) {
                        blockedMatriculas.add(matricula);
                    } else if (studentMissing > 0) {
                        missingMatriculas.add(matricula);
                    }

                    await sleep(50);
                }
            }

            processLoopAsyncWithDelay().then(() => {
                // runs ONLY after processLoopAsyncWithDelay is totally finished
                if (filledCount === 0) {
                    let message = "No fields were filled.";
                    if (blockedMatriculas.size > 0) {
                        message += ` <br>${blockedMatriculas.size} student(s) had blocked fields (e.g. withdrawal).`;
                    }
                    sendResponse({
                        status: "error",
                        message: message
                    });
                } else {
                    let message = `Filled ${filledCount} row(s).`;
                    if (blockedMatriculas.size > 0) {
                        message += ` <br>Skipped ${blockedMatriculas.size} blocked row(s).`;
                    }
                    if (missingMatriculas.size > 0) {
                        message += ` <br>${missingMatriculas.size} not found.`;
                    }
                    sendResponse({
                        status: "success",
                        message: message
                    });
                }
            });

        } catch (e) {
            sendResponse({ status: "error", message: "[content.js]" + e.toString() });
        }
    }
    else if (request.action === "check_if_in_total_freq_page") {
        try {
            var navTab = document.querySelectorAll(".tbNavegacao")[0];
            var titOn = navTab ? navTab.querySelector(".tit_on") : null;
            var isBaseTotalFreqFound = titOn && titOn.innerText.includes("Total de Faltas");
            var tabelaFreq = document.getElementById("tabelaFrequencias");
            if (isBaseTotalFreqFound && tabelaFreq) {
                sendResponse({
                    status: "success"
                });
            } else {
                sendResponse({
                    status: "error",
                    message: "No frequency form found, please check URL"
                });
            }
        } catch (e) {
            sendResponse({
                status: "error",
                message: "No frequency form found, please check URL"
            });
        }
    }
    else if (request.action === "fill_frequency_form") {
        if (document.querySelectorAll('.tit_on').length <= 0) {
            sendResponse(
                { status: "error", message: "Current page is not `Lançamento do Total de Faltas no Semestre`, check URL and try again" });
            return;
        }

        try {
            const csvDataMap = new Map(Object.entries(request.data));

            let filledCount = 0;
            let blockedMatriculas = new Set([]);
            let missingMatriculas = new Set([]);

            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            /**
             * Iterate every student row and write the FREQ value into the input
             * named `@<matricula>`, tracking blocked and missing students.
             */
            async function processLoopAsyncWithDelay() {
                for (const [matricula, value] of csvDataMap) {
                    var freqValue = value["FREQ"];
                    if (freqValue == null || String(freqValue).trim() === "") continue;

                    var idFreqName = "@" + matricula;
                    var freqByName = document.getElementsByName(idFreqName);
                    if (freqByName.length <= 0) {
                        missingMatriculas.add(matricula);
                        continue;
                    }

                    if (!isInputEditable(freqByName[0])) {
                        blockedMatriculas.add(matricula);
                        continue;
                    }

                    filledCount++;
                    freqByName[0].value = freqValue;
                    freqByName[0].style.backgroundColor = "lightcyan";

                    await sleep(50);
                }
            }

            processLoopAsyncWithDelay().then(() => {
                // runs ONLY after processLoopAsyncWithDelay is totally finished
                if (filledCount === 0) {
                    let message = "No fields were filled.";
                    if (blockedMatriculas.size > 0) {
                        message += ` <br>${blockedMatriculas.size} student(s) had blocked fields.`;
                    }
                    sendResponse({
                        status: "error",
                        message: message
                    });
                } else {
                    let message = `Filled ${filledCount} row(s).`;
                    if (blockedMatriculas.size > 0) {
                        message += ` <br>Skipped ${blockedMatriculas.size} blocked row(s).`;
                    }
                    if (missingMatriculas.size > 0) {
                        message += ` <br>${missingMatriculas.size} not found.`;
                    }
                    sendResponse({
                        status: "success",
                        message: message
                    });
                }
            });
        } catch (e) {
            sendResponse({ status: "error", message: "[content.js]" + e.toString() });
        }
    }

    return true;
});
