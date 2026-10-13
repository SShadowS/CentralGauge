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
        Vehicle: Record "CGR Vehicle";
    begin
        Clear(Problems);
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Returned then
            Problems.Add(StrSubstNo(NotReturnedErr, Contract."No."));
        if Contract."Customer Name" = '' then
            Problems.Add(StrSubstNo(NoCustomerErr, Contract."No."));
        if Vehicle.Get(Contract."Vehicle No.") then
            if Vehicle.Blocked then
                Problems.Add(StrSubstNo(OpenDamagesErr, Vehicle."No."));
        OnCheckContractForPosting(Contract);
        exit(Problems.Count() = 0);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnCheckContractForPosting(RentalContract: Record "CGR Rental Contract")
    begin
    end;
}
