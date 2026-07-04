# Fill Grades And Frequency to UFMG's `Diario de Classe`
## _A simple way to import your class data into the university grading system using a Chrome Extension_

### Installation <img width="30" height="30" alt="image" src="https://github.com/user-attachments/assets/3bd3c1de-3a2e-4d2d-aa6a-07d8df4886bc" />

The extension is already available for install on Google Chrome web store!
- https://chromewebstore.google.com/detail/csv-grade-filler-ufmg/bbipopfmfkmmekbaijkpnajpailajgld

### What the Fill Grades And Frequency Extension is?

This project is a JS Chrome Extension that works on certain URLs to allow the option of automatically filling students' grades and frequency by directly importing a CSV file with the evaluation and frequency data.

> **Note on naming:** the project repository is titled *Fill Grades And Frequency to UFMG's `Diario de Classe`*, but the published extension (and the manifest) is named **CSV Grade Filler - UFMG**. They refer to the same tool.

This project also includes a Google Sheets template to import the users from Moodle and `Diario de Classe`, joining them by name. This template can be used to fill the grades during the semester, and export it to CSV.
<div align="center">
  <img src="https://github.com/user-attachments/assets/1b4fb10b-2852-4c5f-8512-db614cc4c756" alt="Extension gui" style="text-align:center; width:25%">
  <br>
  Interface of the plugin once open at the correct `Diario de Classe` webpage.
</div>

<br>

<div align="center">
 <a href="https://www.youtube.com/watch?v=9LEHnoVBfvQ" target="_blank">
      <img src="https://github.com/user-attachments/assets/85984edd-24ee-4ce0-8982-920510993360" alt="Youtube video tutorial" style="text-align:center; width:45%">
    </a>
  <br>
  Quick video tutorial of the plugin doing its magic.
</div>

### Acknowledgements

This project is based upon the developments of:
- [Prof. Flavio Figueiredo](https://dcc.ufmg.br/professor/flavio-vinicius-diniz-de-figueiredo/) and its automatic filler using Python3 https://github.com/flaviovdf/preenche-notas-ufmg
- And the spreadsheets/organization efforts from Prof. [Douglas G. Macharet](https://dcc.ufmg.br/professor/douglas-guimaraes-macharet/).

## Reference Google Sheets template

This project shares a reference Google Sheets template to use with the plugin and make easier to create the CSV files, however its not required and you can use any way you prefer to generate the CSV files.
- Link: https://docs.google.com/spreadsheets/d/1uWSjpvj_RxTTfcZLw65nmbQy1QyCrp93ZFVv3f9kufw/edit?usp=sharing

<div align="center">
    <a href="https://docs.google.com/spreadsheets/d/1uWSjpvj_RxTTfcZLw65nmbQy1QyCrp93ZFVv3f9kufw/edit?usp=sharing" target="_blank">
      <img src="https://github.com/user-attachments/assets/feec7f8e-29f1-40f7-a53c-7447ca70ef8d" alt="Extension gui" style="text-align:center; width:25%">
    </a>
    <br>
    Reference Google Sheets template.
</div>

## CSV file format

Both modes read a plain UTF-8 CSV whose **first row is a header**. Every row must
have a `MATRICULA` column holding the student's enrollment number — this is the
key used to match a row to an input on the page. Rows with an empty `MATRICULA`,
or with no data values, are skipped (and reported as "skipped" in the popup).

**Grades CSV** — besides `MATRICULA`, add one column per evaluation using the
exact label shown on the page (e.g. `AV1`, `AV2`, `EE`). Only columns that exist
both in the CSV **and** on the page are fillable; the popup's column picker marks
each column as `page + CSV`, `CSV only`, or `page only`. Decimal grades may use a
dot or a comma — dots are converted to commas automatically before filling.

```csv
MATRICULA,EE,AV1,AV2,AV3,AV4
202500001,1,1,1,1,1
202500002,2,2,2,2,2
```

**Frequency CSV** — needs exactly `MATRICULA` and a `FREQ` column with the total
number of absences for the semester.

```csv
MATRICULA,FREQ
202500001,1
202500002,2
```

Sample files (including intentionally malformed ones for testing) live in
[`test_csv_files/`](test_csv_files/).

## Step by step tutorial

### Mock websites for testing

- Test Grades website at: https://homepages.dcc.ufmg.br/~hector.azpurua/notas_mock
- Test CSV data: https://github.com/h3ct0r/fill_grades_freq_UFMG_chrome_extension/blob/main/test_csv_files/test_grades_10.csv

- Test Presence website at: https://homepages.dcc.ufmg.br/~hector.azpurua/faltas_mock
- Test CSV data: https://github.com/h3ct0r/fill_grades_freq_UFMG_chrome_extension/blob/main/test_csv_files/test_freq.csv

### Filling grades

- *Step 0*: Inside `Diario de Classe`, go to the page `Notas/Lançamento de Notas/Todas as Avaliações` and click on the extension icon
<div align="center">
  <img src="https://github.com/user-attachments/assets/6602d9fd-0c56-40f6-8383-c3dbb8652030" alt="Step 0" style="text-align:center; width:25%">
</div>
  
- *Step 1*: Verify that `step 1` is finished with the green mark (this step recognizes the AV columns and matches them with your data)
<div align="center">
  <img src="https://github.com/user-attachments/assets/a0ea29c8-38e1-478e-b03c-30cca312e6b0" alt="Step 1" style="text-align:center; width:25%">
</div>

- *Step 2*: Upload the CSV file, and verify that the CSV fields match with the current AV's in the page (green check on `step 2`)
<div align="center">
  <img src="https://github.com/user-attachments/assets/6325fcc4-38c4-4475-a260-1f40a13873da" alt="Step 2" style="text-align:center; width:25%">
</div>

- *Step 3*: Click on the `Fill Grades` button, and verify the output of number of correctly filled rows
<div align="center">
  <img src="https://github.com/user-attachments/assets/0b4d7a06-0c01-4227-937d-00e78105d2cc" alt="Step 3" style="text-align:center; width:25%">
</div>

- Remember to click the `Processar` button at the bottom of the page to register all grades

### Filling frequency

The frequency workflow mirrors the grades one and the extension switches to it
automatically based on the page URL:

- *Step 0*: Inside `Diario de Classe`, go to the `Frequência/Lançamento do Total de Faltas no Semestre` page and click on the extension icon.
- *Step 1*: Verify that `step 1` shows the green mark — this confirms the extension detected the total-frequency form (`FREQ`).
- *Step 2*: Upload the frequency CSV (with `MATRICULA` and `FREQ` columns) and confirm the green check on `step 2`.
- *Step 3*: Click the `Fill frequency` button and check how many rows were filled.
- Remember to click the `Processar` button at the bottom of the page to register the absences.

## How to install from *source*

Download this Github project and load it in Chrome using developer mode as an unpacked extension:

- Go to the Extensions page by entering `chrome://extensions` in a new tab. (By design chrome:// URLs are not linkable.)
    - Alternatively, click the Extensions menu puzzle button and select **Manage Extensions** at the bottom of the menu.
    - Or, click the Chrome menu, hover over **More Tools**, then select **Extensions**.
- Enable **Developer Mode** by clicking the toggle switch next to **Developer mode**.
- Click the **Load unpacked** button and select the extension directory.
  
<div align="center">
  <img src="https://github.com/user-attachments/assets/e805db63-afce-4996-9166-108b12a4675c" alt="Extensions" style="text-align:center; width:25%">
  <br>
  Extensions page (`chrome://extensions`)
</div>
- Ta-da! The extension has been successfully installed.

## Project structure

Manifest V3 Chrome extension. The moving parts:

| File | Role |
| --- | --- |
| [`manifest.json`](manifest.json) | Extension manifest: permissions, the pages the content script is injected into, the popup action and the `reload` dev command. |
| [`popup.html`](popup.html) / [`style.css`](style.css) | Popup markup and styles (the two-panel grades / frequency UI). |
| [`popup.js`](popup.js) | Popup logic: CSV parsing (PapaParse), validation, the column picker, per-tab session persistence, and messaging to the content script. Touches the page only via `chrome.tabs.sendMessage`. |
| [`content.js`](content.js) | Content script injected into the target pages. Reads the AV headers and writes grade/frequency values into the form inputs; replies to popup messages with a `{ status, message }` object. |
| [`service.js`](service.js) | Background service worker; reloads the extension on the `reload` keyboard shortcut (dev convenience). |
| [`js/papaparse.min.js`](js/papaparse.min.js) | Vendored [PapaParse](https://www.papaparse.com/) CSV parser, loaded by both the popup and the content script. |
| [`test_csv_files/`](test_csv_files/) | Sample good and deliberately-malformed CSVs for manual testing. |
| [`PRIVACY.md`](PRIVACY.md) | Privacy policy (the extension collects and transmits no data). |

### How it works

1. The popup opens and, from the active tab's URL, decides whether it is in
   **grades** or **frequency** mode.
2. It messages the content script to detect the page's evaluation headers
   (`get_av_headers`) or to confirm the total-frequency form
   (`check_if_in_total_freq_page`).
3. The user uploads a CSV; the popup parses and validates it and renders the
   column picker.
4. On "Fill", the popup filters the parsed rows to the selected columns and
   sends them to the content script (`fill_grade_form` / `fill_frequency_form`),
   which writes the values into the page inputs and reports how many rows were
   filled, blocked or not found.

All page interaction happens in the content script; no data ever leaves the
browser.

## License

MIT

**Free Software, Hell Yeah!**
   
