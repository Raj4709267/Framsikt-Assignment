# Snack Counter Automation — design overview

This document describes the assignment implementation. Refill reports use the REST API. Chat and HR are simulated adapters; the app does not connect to company services or authenticate users.

## How a refill moves

1. **Report empty:** An employee sends a refill request to `POST /api/refills`. The counter determines the office and currency. The API rejects duplicate active requests for that counter.
2. **Offer the task:** The service chooses an eligible volunteer, favoring people who have had fewer recent assignments. If nobody is available, the request stays open and the expiry job retries it.
3. **Accept and refill:** One volunteer accepts the offer. Only that person can submit the purchase and receipt. Acceptance starts a completion deadline. A missed deadline expires the assignment and offers the task to another volunteer.
4. **Check budget and record purchase:** The service checks the office's remaining monthly budget and records the purchase in one transaction. The default policy blocks over-budget purchases. `approval_required` can return an approval-required error, but a manager approval workflow is not implemented.
5. **Track reimbursement:** The app submits a claim to the mock HR adapter. Submission, approval, rejection, and payment are separate states. A failed submission can be retried. Marking a claim paid records it as reimbursed.
6. **Report:** Monthly reports show purchase spending and reimbursement totals by office. NOK and INR remain separate; the app does not convert currencies.

## Main parts and stored data

- **REST API:** Routes and input validation. Employee IDs are provided in requests because authentication is outside this assignment.
- **Domain services:** Refill lifecycle, volunteer selection, budget checks, purchase and reimbursement handling, and reports. `SnackService` wires the focused services together.
- **SQLite:** Employees and offices; counters; volunteer availability and temporary office eligibility; refill requests and assignment history; purchases and receipt paths; reimbursement statuses and HR claim IDs; monthly budgets and reservations.
- **Integrations and job:** The mock chat adapter records notifications in memory. The mock HR adapter keeps claims in memory and simulates approval and payment. A scheduled job expires overdue offers or accepted tasks and reassigns them. Receipt images are stored on disk.

## How the design prevents common problems

- **A refill is ignored:** Offers and accepted work have deadlines. The job expires overdue work, retries open requests, and reassigns tasks when another volunteer is available.
- **Two people buy for one refill:** Only the accepted volunteer can purchase. Transactions, conditional updates, and database constraints prevent duplicate active assignments and purchases.
- **Work is uneven:** Volunteers are selected by least-recent assignment, with fresh eligible volunteers preferred. Availability is checked during selection and acceptance.
- **Spending is unclear:** Each purchase records its amount, currency, date, description, and receipt. Actual purchases count against the budget even if reimbursement is rejected. Reports show spending and reimbursement states separately. Receipts do not prove what was consumed.

## Budgets and trade-offs

Oslo's monthly budget is **6,000 NOK**; Bengaluru's is **15,000 INR**. The service blocks a purchase that exceeds the remaining budget by default. No manager override flow is included. Reports keep the currencies separate until a real exchange-rate source and reporting currency are chosen.

SQLite and a single app process keep the assignment easy to run and test. A multi-instance deployment would need a shared transactional database and operational coordination. The simulated integrations avoid external accounts and services during review.

Authentication and authorization, real chat and HR integrations, durable mock HR state, currency conversion, stock tracking, consumption estimates, and a manager approval workflow are deliberately out of scope. These require company-specific security and operational decisions.
