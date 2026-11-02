codeunit 70222 "CGR Contract Check"
{
    // Pre-posting check for rental contracts. Lists a code for every problem it finds.

    procedure CheckContract(ContractNo: Code[20]; var Problems: List of [Code[30]])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Clear(Problems);
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Returned then
            Problems.Add('NOT-RETURNED');
        if Contract."Vehicle No." = '' then
            Problems.Add('NO-VEHICLE');
    end;
}
