import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outputs = [
  resolve('docs/snack_counter_automation_design.pdf'),
  resolve('docs/snack-counter-design.pdf'),
];

const pages = [
  [
    ['heading', 'How the refill works'],
    ['intro', 'This describes the working assignment project. Refill reports use its REST API. Chat and HR are simulated; the app does not connect to company services or authenticate users.'],
    ['step', '1. Report empty', 'An employee sends a request to POST /api/refills. The counter identifies the office and currency. Duplicate active requests for the same counter are rejected.'],
    ['step', '2. Offer the task', 'The service offers the refill to an eligible volunteer, favoring people with fewer recent assignments. If nobody is available, the request stays open and the expiry job retries it.'],
    ['step', '3. Accept and refill', 'One volunteer accepts and restocks the counter. Only that person can submit the purchase and receipt, then mark the task complete. Acceptance starts a completion deadline. If it is missed, the task expires and is offered to another eligible volunteer.'],
    ['step', '4. Check budget and record purchase', 'The service checks the office budget and records the purchase in one transaction. The default blocks over-budget purchases. An approval-required error can be configured, but there is no manager approval workflow.'],
    ['step', '5. Track reimbursement', 'The app submits a claim to mock HR. Submission, approval, rejection, and payment are separate states. Failed submission can be retried. A paid claim is recorded as reimbursed.'],
    ['step', '6. Report', 'Monthly reports show spending and reimbursement totals by office. NOK and INR remain separate; no currency conversion is configured.'],
    ['heading', 'Main parts and data'],
    ['bullet', 'REST API and domain services handle requests, refill state, volunteer selection, budgets, purchases, reimbursements, and reports. SnackService connects the focused services.'],
    ['bullet', 'SQLite stores employees, offices, counters, volunteer availability and visit eligibility, refill requests, assignment history and deadlines, purchases, reimbursement states, monthly budgets, and reservations. Receipt images live on disk.'],
    ['bullet', 'The mock chat adapter records notifications in memory. The mock HR adapter stores claims in memory and simulates approval and payment. A scheduled job expires overdue work and reassigns it.'],
  ],
  [
    ['heading', 'How the design prevents common problems'],
    ['bullet', 'Refills left waiting: offers and accepted tasks have deadlines. The job expires overdue work, retries open requests, and reassigns tasks when another volunteer is available.'],
    ['bullet', 'Two people buying for one refill: only the accepted volunteer can purchase. Transactions, conditional updates, and database constraints prevent duplicate active assignments and purchases.'],
    ['bullet', 'Uneven workload: volunteers are selected by least-recent assignment, with eligible first-time volunteers preferred. Availability is checked both when offering and accepting a task.'],
    ['bullet', 'Unclear spending: purchases record amount, currency, date, description, and receipt. All purchases count against the budget even if HR rejects reimbursement. Reports separate spending from reimbursement status. A receipt does not prove what was eaten.'],
    ['heading', 'Budgets and trade-offs'],
    ['paragraph', 'Oslo has a monthly budget of 6,000 NOK; Bengaluru has 15,000 INR. A purchase above the remaining budget is blocked by default. There is no manager override flow. Reports keep currencies separate until a reporting currency and exchange-rate source are chosen.'],
    ['paragraph', 'SQLite and one app process keep this assignment straightforward to run and test. A multi-instance deployment would need a shared transactional database and operational coordination. Simulated integrations let reviewers run the workflow without external accounts.'],
    ['heading', 'How it is tested'],
    ['bullet', 'Automated tests cover concurrent accepts and purchases, accepted tasks that miss their deadline, budget enforcement, separate NOK and INR totals, and retrying failed HR submissions without duplicate claims.'],
    ['bullet', 'Run `npm test`. Tests use temporary SQLite databases and mock chat and HR adapters, so they need no company accounts or external services.'],
    ['heading', 'Deliberately out of scope'],
    ['paragraph', 'Authentication and authorization, real chat and HR connections, durable mock HR data, currency conversion, inventory and consumption tracking, manager approval, and multi-instance job infrastructure. These need company-specific security and operational decisions.'],
    ['note', 'For review: run `npm install`, then `npm test`. The automated tests use isolated databases and simulated integrations.'],
  ],
];

const BODY_WIDTH = 510;
const MARGIN_LEFT = 51;
const CONTENT_TOP = 725;
const CONTENT_BOTTOM = 54;

function pdfEscape(text) {
  return text.normalize('NFKD').replace(/[^\x20-\x7E]/g, '-').replace(/[\\()]/g, '\\$&');
}
function wrap(text, size, maxWidth = BODY_WIDTH) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length * size * 0.51 > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}
function textLine(text, x, y, size, font = 'F1', gray = 0.12) {
  return `BT /${font} ${size} Tf ${gray} g 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj ET`;
}

const objects = [];
const addObject = (value) => { objects.push(value); return objects.length; };
const catalogId = addObject('');
const pagesId = addObject('');
const regularFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
const boldFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
const pageIds = [];

for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
  const commands = [
    'q 0.10 0.31 0.40 rg 0 758 612 34 re f Q',
    textLine('SNACK COUNTER AUTOMATION', MARGIN_LEFT, 770, 10, 'F2', 1),
    textLine(`DESIGN OVERVIEW  |  PAGE ${pageIndex + 1} OF 2`, 399, 770, 8, 'F1', 1),
  ];
  let y = CONTENT_TOP;
  if (pageIndex === 0) {
    commands.push(textLine('A clear, practical refill workflow', MARGIN_LEFT, y, 20, 'F2', 0.08));
    y -= 27;
    commands.push(textLine('What the project does today, and where its boundaries are', MARGIN_LEFT, y, 10, 'F1', 0.36));
    y -= 28;
  }

  for (const item of pages[pageIndex]) {
    const [type, first, second] = item;
    if (type === 'heading') {
      y -= 5;
      commands.push(textLine(first, MARGIN_LEFT, y, 13, 'F2', 0.10));
      y -= 18;
    } else if (type === 'intro') {
      commands.push('q 0.93 0.96 0.97 rg 45 ' + (y - 41) + ' 522 48 re f Q');
      const lines = wrap(first, 10.2, BODY_WIDTH - 20);
      for (const line of lines) {
        commands.push(textLine(line, MARGIN_LEFT + 9, y, 10.2, 'F1', 0.16));
        y -= 14;
      }
      y -= 11;
    } else if (type === 'step') {
      commands.push(textLine(first, MARGIN_LEFT, y, 10.5, 'F2', 0.10));
      y -= 14;
      for (const line of wrap(second, 10.2, BODY_WIDTH - 14)) {
        commands.push(textLine(line, MARGIN_LEFT + 13, y, 10.2, 'F1', 0.16));
        y -= 13.2;
      }
      y -= 5;
    } else if (type === 'bullet') {
      const lines = wrap(first, 10.2, BODY_WIDTH - 18);
      commands.push(textLine('-', MARGIN_LEFT + 2, y, 11, 'F2', 0.10));
      for (let i = 0; i < lines.length; i++) {
        commands.push(textLine(lines[i], MARGIN_LEFT + 15, y, 10.2, 'F1', 0.16));
        y -= 13.5;
      }
      y -= 4;
    } else if (type === 'paragraph') {
      for (const line of wrap(first, 10.2)) {
        commands.push(textLine(line, MARGIN_LEFT, y, 10.2, 'F1', 0.16));
        y -= 14;
      }
      y -= 7;
    } else if (type === 'note') {
      y -= 2;
      commands.push('q 0.93 0.96 0.97 rg 45 ' + (y - 31) + ' 522 37 re f Q');
      for (const line of wrap(first, 9.5, BODY_WIDTH - 18)) {
        commands.push(textLine(line, MARGIN_LEFT + 9, y - 4, 9.5, 'F1', 0.20));
        y -= 13;
      }
    }
  }
  if (y < CONTENT_BOTTOM) throw new Error(`Page ${pageIndex + 1} content overflowed (${Math.round(y)}pt left)`);
  commands.push('q 0.75 G 51 39 m 561 39 l S Q');
  commands.push(textLine('Snack Counter Automation  |  Design document', MARGIN_LEFT, 25, 8, 'F1', 0.42));
  commands.push(textLine(`${pageIndex + 1} / 2`, 534, 25, 8, 'F1', 0.42));

  const stream = commands.join('\n');
  const streamId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
  pageIds.push(pageId);
  console.log(`Page ${pageIndex + 1}: content ends at y=${Math.round(y)}pt`);
}

objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count 2 >>`;
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefOffset = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
for (const output of outputs) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, pdf, 'binary');
  console.log(`Created ${output}`);
}
