codeunit 70222 "CGR Contract Check"
{
    // Pre-posting check for rental contracts. CheckForPosting returns false and lists every problem it finds.
    // Extensions add their own checks by subscribing to OnCheckContractForPosting and reporting each problem
    // as a collectible error: Error(ErrorInfo.Create(<text>, true)).

    var
        NotReturnedErr: Label 'Rental contract %1 must be returned before it is posted.', Comment = '%1 = contract number';
        NoCustomerErr: Label 'Rental contract %1 has no customer name.', Comment = '%1 = contract number';
        OpenDamagesErr: Label 'Vehicle %1 has open damages.', Comment = '%1 = vehicle number';

    procedure CheckForPosting(ContractNo: Code[20]; var Problems: List of [Text]): Boolean
    var
        Contract: Record "CGR Rental Contract";
        Problem: ErrorInfo;
    begin
        Clear(Problems);
        Contract.Get(ContractNo);
        CollectProblems(Contract);
        foreach Problem in GetCollectedErrors() do
            Problems.Add(Problem.Message);
        exit(Problems.Count() = 0);
    end;

    [ErrorBehavior(ErrorBehavior::Collect)]
    local procedure CollectProblems(Contract: Record "CGR Rental Contract")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Contract.Status <> Contract.Status::Returned then
            ReportProblem(StrSubstNo(NotReturnedErr, Contract."No."));
        if Contract."Customer Name" = '' then
            ReportProblem(StrSubstNo(NoCustomerErr, Contract."No."));
        if Vehicle.Get(Contract."Vehicle No.") then
            if Vehicle.Blocked then
                ReportProblem(StrSubstNo(OpenDamagesErr, Vehicle."No."));
        OnCheckContractForPosting(Contract);
    end;

    local procedure ReportProblem(ProblemText: Text)
    var
        Problem: ErrorInfo;
    begin
        Problem := ErrorInfo.Create(ProblemText, true);
        Error(Problem);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnCheckContractForPosting(RentalContract: Record "CGR Rental Contract")
    begin
    end;
}
