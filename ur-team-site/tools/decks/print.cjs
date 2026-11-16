// tools/decks/*.html → assets/files/*.pdf (A4 가로, 배경 포함)
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "../../assets/files");
const jobs = [
  ["china-export.html", "urteam-china-export-marketing.pdf"],
  ["china-sns-clinic.html", "urteam-china-sns-clinic-cases.pdf"],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [src, out] of jobs) {
    await p.goto("file://" + path.join(__dirname, src));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    await p.pdf({ path: path.join(OUT, out), width: "297mm", height: "210mm", printBackground: true, preferCSSPageSize: true });
    console.log("→", out);
  }
  await b.close();
})();
