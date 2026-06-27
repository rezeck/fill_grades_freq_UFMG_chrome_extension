function isInputEditable(input) {
    return input && !input.disabled && !input.readOnly;
}

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
        var inputList = trList[0].querySelectorAll('input');

        const avIdRegex = /^@.*_(\d)$/;
        var avSize = avList.length;

        for (let i = 0; i < avSize; i++) {
            var avElement = avList[i];
            var avText = avElement.innerText
            var inputElement = inputList[i];
            const result = inputElement.id.match(avIdRegex);
            if (!result) {
                throw new Error("avIdRegex: Element with id '" + avIdRegex + "' not found");
            }

            avToId.set(avText, result[1]);
            console.log(avText, result[1]);
        }
    } catch (error) {
        // @ts-ignore
        console.error("[ERROR] Problem parsing page for AV information:", error.message);
    }

    return avToId;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_av_headers") {
        var avToId = getAvHeadersMap();
        console.log("avToId:", avToId);

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
            console.log("avToId:", avToId);
            console.log("csvDataMap:", csvDataMap);

            for (const [matricula, value] of csvDataMap) {
                if (!value || Object.keys(value).length === 0) continue;

                console.log(matricula, value);

                var fieldsFilled = 0;
                var fieldsBlocked = 0;
                var fieldsMissing = 0;

                for (var avKeyName in value) {
                    if (columnsToFill && !columnsToFill.includes(avKeyName)) continue;
                    if (!avToId.has(avKeyName)) continue;

                    var avKeyId = avToId.get(avKeyName);
                    var avValue = value[avKeyName];
                    if (avValue == null || String(avValue).trim() === "") continue;

                    var idAvName = "@" + matricula + "_" + avKeyId;
                    var avMatriculaKey = document.getElementById(idAvName);

                    if (!avMatriculaKey) {
                        fieldsMissing++;
                        continue;
                    }

                    if (!isInputEditable(avMatriculaKey)) {
                        fieldsBlocked++;
                        continue;
                    }

                    avValue = String(avValue).replace(/\./g, ',');
                    avMatriculaKey.value = avValue;
                    fieldsFilled++;
                }

                if (fieldsFilled > 0) {
                    filledCount++;
                }
                if (fieldsFilled === 0 && fieldsBlocked > 0) {
                    blockedMatriculas.add(matricula);
                } else if (fieldsFilled === 0 && fieldsMissing > 0) {
                    missingMatriculas.add(matricula);
                } else if (fieldsBlocked > 0) {
                    blockedMatriculas.add(matricula);
                }
            }

            if (filledCount === 0) {
                let message = "Nenhum campo preenchido.";
                if (blockedMatriculas.size > 0) {
                    message += ` ${blockedMatriculas.size} aluno(s) com campos bloqueados (ex.: trancamento).`;
                }
                sendResponse({
                    status: "error",
                    message: message
                });
            } else {
                let message = `Preenchidas ${filledCount} linha(s).`;
                if (blockedMatriculas.size > 0) {
                    message += ` Ignoradas ${blockedMatriculas.size} bloqueada(s).`;
                }
                if (missingMatriculas.size > 0) {
                    message += ` ${missingMatriculas.size} nao encontrada(s).`;
                }
                sendResponse({
                    status: "success",
                    message: message
                });
            }

        } catch (e) {
            sendResponse({ status: "error", message: "[content.js]" + e.toString() });
        }
    }
    else if (request.action === "check_if_in_total_freq_page") {
        var isBaseTotalFreqFound = document.querySelectorAll(".tbNavegacao")[0].querySelector(".tit_on").innerText.includes("Total de Faltas");
        var tabelaFreq = document.getElementById("tabelaFrequencias");
        if (isBaseTotalFreqFound && tabelaFreq) {
            sendResponse({
                status: "success"
            });
        }
        else {
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

            for (const [matricula, value] of csvDataMap) {
                var freqValue = value["FREQ"];
                if (freqValue == null || String(freqValue).trim() === "") continue;

                console.log(matricula, freqValue);

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
            }

            if (filledCount === 0) {
                let message = "Nenhum campo preenchido.";
                if (blockedMatriculas.size > 0) {
                    message += ` ${blockedMatriculas.size} aluno(s) com campos bloqueados.`;
                }
                sendResponse({
                    status: "error",
                    message: message
                });
            } else {
                let message = `Preenchidas ${filledCount} linha(s).`;
                if (blockedMatriculas.size > 0) {
                    message += ` Ignoradas ${blockedMatriculas.size} bloqueada(s).`;
                }
                if (missingMatriculas.size > 0) {
                    message += ` ${missingMatriculas.size} nao encontrada(s).`;
                }
                sendResponse({
                    status: "success",
                    message: message
                });
            }

        } catch (e) {
            sendResponse({ status: "error", message: "[content.js]" + e.toString() });
        }
    }

    return true;
});