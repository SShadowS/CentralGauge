codeunit 80171 "CGR Contract Closer Runner"
{
    var
        CloseAsOf: Date;
        RenamedContractNo: Code[20];
        NewCustomerName: Text[100];
        ClosedInRun: Integer;

    trigger OnRun()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
    begin
        if RenamedContractNo <> '' then begin
            Contract.Get(RenamedContractNo);
            Contract."Customer Name" := NewCustomerName;
            Contract.Modify();
        end;
        ClosedInRun := ContractCloser.CloseExpired(CloseAsOf);
    end;

    procedure SetCloseRun(AsOf: Date; ContractNoToRename: Code[20]; CustomerName: Text[100])
    begin
        CloseAsOf := AsOf;
        RenamedContractNo := ContractNoToRename;
        NewCustomerName := CustomerName;
    end;

    procedure ClosedContracts(): Integer
    begin
        exit(ClosedInRun);
    end;
}
