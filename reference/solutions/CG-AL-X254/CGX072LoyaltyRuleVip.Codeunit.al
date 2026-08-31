codeunit 70373 "CG X072 Loyalty Rule VIP"
{
    // Grants priority support to candidates the account team has
    // manually flagged as VIP, regardless of spend history.

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X072 Loyalty Gatekeeper", 'OnCheckPriorityEligibility', '', false, false)]
    local procedure CheckManualOverride(Candidate: Record "CG X072 Loyalty Candidate"; var Eligible: Boolean)
    begin
        if Candidate."Manual VIP Override" then
            Eligible := true;
    end;
}
