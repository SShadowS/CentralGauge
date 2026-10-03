codeunit 70312 "CGR Lease Batch Invoicing"
{
    var
        RunId: Guid;

    procedure InvoiceDueLeases(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        Invoiced: Integer;
    begin
        RunId := CreateGuid();
        Contract.CopyFilters(LeaseFilter);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        Commit();
        foreach ContractNo in ContractNos do begin
            if RunLeaseInvoicing(ContractNo, UpToDate) then
                Invoiced += 1
            else
                LogLeaseFailure(ContractNo, GetLastErrorText());
            Commit();
        end;
        exit(Invoiced);
    end;

    procedure LastRunId(): Guid
    begin
        exit(RunId);
    end;

    local procedure RunLeaseInvoicing(ContractNo: Code[20]; UpToDate: Date): Boolean
    var
        Contract: Record "CGR Lease Contract";
        LeaseInvoiceRun: Codeunit "CGR Lease Invoice Run";
    begin
        Contract.Get(ContractNo);
        ClearLastError();
        LeaseInvoiceRun.SetUpToDate(UpToDate);
        exit(LeaseInvoiceRun.Run(Contract));
    end;

    local procedure LogLeaseFailure(ContractNo: Code[20]; ErrorText: Text)
    var
        LeaseInvoiceError: Record "CGR Lease Invoice Error";
    begin
        LeaseInvoiceError.Init();
        LeaseInvoiceError."Run Id" := RunId;
        LeaseInvoiceError."Contract No." := ContractNo;
        LeaseInvoiceError."Error Message" := CopyStr(ErrorText, 1, MaxStrLen(LeaseInvoiceError."Error Message"));
        LeaseInvoiceError."Logged At" := CurrentDateTime();
        LeaseInvoiceError.Insert(true);
    end;
}
