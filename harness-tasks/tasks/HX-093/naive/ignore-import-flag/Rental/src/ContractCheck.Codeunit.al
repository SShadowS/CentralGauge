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
        if BalancingAccountMissing(ContractNo) then
            Problems.Add('NO-BALANCING-ACCOUNT');
    end;

    procedure BalancingAccountMissing(ContractNo: Code[20]): Boolean
    var
        MatchedPayment: Record "CGR Matched Payment";
        PaymentMethod: Record "CGR Payment Method";
    begin
        if not MatchedPayment.Get(ContractNo) then
            exit(false);
        if MatchedPayment."Externally Settled" then
            exit(false);
        PaymentMethod.Get(MatchedPayment."Payment Method Code");
        if PaymentMethod."Posts to Customer Account" then
            exit(false);
        exit(PaymentMethod."Balancing Account No." = '');
    end;
}
