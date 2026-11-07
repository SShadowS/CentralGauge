// A pricing advisor app: for each configured lease it writes a letter (an outbox entry with Event Type
// 'HX103 letter' for the lease's vehicle), proposes its rate, and optionally commits or raises afterwards.
codeunit 87506 "HX103 Advisor App"
{
    EventSubscriberInstance = Manual;

    var
        Rates: Dictionary of [Code[20], Decimal];
        Commits: List of [Code[20]];
        Failures: List of [Code[20]];
        AdvisorErr: Label 'HX103 advisor failed for %1.', Locked = true;

    procedure HX103Propose(LeaseNo: Code[20]; Rate: Decimal; CommitAfter: Boolean; FailAfter: Boolean)
    begin
        Rates.Set(LeaseNo, Rate);
        if CommitAfter then
            Commits.Add(LeaseNo);
        if FailAfter then
            Failures.Add(LeaseNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Rate Review", 'OnProposeLeaseRate', '', false, false)]
    local procedure HX103ProposeRate(LeaseContract: Record "CGR Lease Contract"; var ProposedRate: Decimal)
    var
        Letter: Record "CGR Outbox Entry";
    begin
        if not Rates.ContainsKey(LeaseContract."No.") then
            exit;
        Letter.Init();
        Letter."Event Type" := 'HX103 letter';
        Letter."Vehicle No." := LeaseContract."Vehicle No.";
        Letter.Payload := LeaseContract."No.";
        Letter."Created At" := CurrentDateTime();
        Letter.Insert(true);
        ProposedRate := Rates.Get(LeaseContract."No.");
        if Commits.Contains(LeaseContract."No.") then
            Commit();
        if Failures.Contains(LeaseContract."No.") then
            Error(AdvisorErr, LeaseContract."No.");
    end;
}
