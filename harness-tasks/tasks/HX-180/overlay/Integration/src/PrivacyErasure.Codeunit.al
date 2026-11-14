codeunit 70441 "CGR Privacy Erasure"
{
    procedure EraseContract(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Contract.Delete(true);
    end;
}
