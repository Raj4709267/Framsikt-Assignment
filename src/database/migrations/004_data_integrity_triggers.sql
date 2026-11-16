CREATE TRIGGER validate_refill_insert
BEFORE INSERT ON refill_requests
WHEN NEW.status NOT IN ('open', 'assigned', 'accepted', 'purchased', 'completed', 'cancelled')
  OR NEW.snack_counter_id IS NULL OR NEW.reported_by_employee_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid refill request state or missing snack counter/reporter');
END;

CREATE TRIGGER validate_refill_status
BEFORE UPDATE OF status ON refill_requests
WHEN NEW.status NOT IN ('open', 'assigned', 'accepted', 'purchased', 'completed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid refill request status');
END;

CREATE TRIGGER validate_assignment_insert
BEFORE INSERT ON assignments
WHEN NEW.status NOT IN ('offered', 'accepted', 'expired', 'declined', 'completed', 'cancelled')
  OR EXISTS (SELECT 1 FROM assignments active WHERE active.volunteer_employee_id = NEW.volunteer_employee_id AND active.status IN ('offered','accepted'))
  OR NOT EXISTS (
    SELECT 1 FROM refill_requests rr JOIN snack_counters sc ON sc.id = rr.snack_counter_id
    JOIN employees e ON e.id = NEW.volunteer_employee_id
    JOIN volunteer_availability va ON va.employee_id = e.id AND va.office_id = sc.office_id
    WHERE rr.id = NEW.refill_request_id AND e.is_active = 1 AND va.is_volunteer = 1
      AND va.availability_status = 'available'
      AND julianday(va.available_from) <= julianday('now')
      AND (va.available_until IS NULL OR julianday(va.available_until) > julianday('now'))
      AND (e.office_id = sc.office_id OR EXISTS (
        SELECT 1 FROM volunteer_office_eligibility voe WHERE voe.employee_id = e.id AND voe.office_id = sc.office_id
          AND (voe.available_from IS NULL OR julianday(voe.available_from) <= julianday('now'))
          AND (voe.available_until IS NULL OR julianday(voe.available_until) > julianday('now'))
      ))
  )
BEGIN
  SELECT RAISE(ABORT, 'volunteer is not currently eligible and available');
END;

CREATE TRIGGER validate_assignment_status
BEFORE UPDATE OF status ON assignments
WHEN NEW.status NOT IN ('offered', 'accepted', 'expired', 'declined', 'completed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid assignment status');
END;

CREATE TRIGGER validate_purchase_insert
BEFORE INSERT ON purchases
WHEN NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.currency NOT IN ('NOK', 'INR')
  OR NOT EXISTS (
    SELECT 1 FROM refill_requests rr JOIN snack_counters sc ON sc.id = rr.snack_counter_id
    JOIN offices o ON o.id = sc.office_id JOIN assignments a ON a.refill_request_id = rr.id
    WHERE rr.id = NEW.refill_request_id AND rr.status = 'accepted' AND a.status = 'accepted'
      AND a.volunteer_employee_id = NEW.volunteer_employee_id AND o.currency = NEW.currency
  )
BEGIN
  SELECT RAISE(ABORT, 'purchase is invalid for this refill or office');
END;

CREATE TRIGGER validate_reimbursement_status
BEFORE INSERT ON reimbursements
WHEN NEW.status NOT IN ('pending_submission', 'submitted', 'approved', 'rejected', 'reimbursed', 'submission_failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid reimbursement status');
END;

CREATE TRIGGER validate_reimbursement_status_update
BEFORE UPDATE OF status ON reimbursements
WHEN NEW.status NOT IN ('pending_submission', 'submitted', 'approved', 'rejected', 'reimbursed', 'submission_failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid reimbursement status');
END;
