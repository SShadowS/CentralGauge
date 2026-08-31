codeunit 70372 "CG X072 Loyalty Rule Spend"
{
    // Grants priority support to candidates who have crossed the
    // lifetime spend threshold for the loyalty program.

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X072 Loyalty Gatekeeper", 'OnCheckPriorityEligibility', '', false, false)]
    local procedure CheckSpendThreshold(Candidate: Record "CG X072 Loyalty Candidate"; var Eligible: Boolean)
    begin
        if Candidate."Lifetime Spend" >= 5000 then
            Eligible := true;
    end;
}
