codeunit 70371 "CG X072 Loyalty Gatekeeper"
{
    Access = Public;

    // Evaluates every candidate that has not yet been reviewed and
    // stores the outcome back on the candidate record.
    procedure EvaluateAllPending()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.SetRange("Priority Support Approved", false);
        if Candidate.FindSet(true) then
            repeat
                EvaluateCandidate(Candidate);
            until Candidate.Next() = 0;
    end;

    // Runs every registered eligibility rule for a single candidate and
    // persists the combined verdict.
    procedure EvaluateCandidate(var Candidate: Record "CG X072 Loyalty Candidate")
    var
        Eligible: Boolean;
    begin
        Eligible := false;
        OnCheckPriorityEligibility(Candidate, Eligible);

        Candidate."Priority Support Approved" := Eligible;
        Candidate.Modify(true);
    end;

    // Eligibility rules subscribe to this event to contribute their verdict.
    [IntegrationEvent(false, false)]
    local procedure OnCheckPriorityEligibility(Candidate: Record "CG X072 Loyalty Candidate"; var Eligible: Boolean)
    begin
    end;
}
