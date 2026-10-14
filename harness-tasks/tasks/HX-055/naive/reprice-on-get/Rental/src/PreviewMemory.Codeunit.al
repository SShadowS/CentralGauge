codeunit 70225 "CGR Preview Memory"
{
    SingleInstance = true;

    var
        KeptContracts: List of [Code[20]];

    procedure Remember(ContractNo: Code[20])
    begin
        if not KeptContracts.Contains(ContractNo) then
            KeptContracts.Add(ContractNo);
    end;

    procedure IsKept(ContractNo: Code[20]): Boolean
    begin
        exit(KeptContracts.Contains(ContractNo));
    end;

    procedure ForgetAll()
    begin
        Clear(KeptContracts);
    end;
}
