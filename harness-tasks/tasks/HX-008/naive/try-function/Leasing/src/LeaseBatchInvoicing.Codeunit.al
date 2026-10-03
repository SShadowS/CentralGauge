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
                if HasDueLines(Contract."No.", UpToDate) then
                    ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        Commit();
        foreach ContractNo in ContractNos do begin
            ClearLastError();
            if TryInvoiceLease(ContractNo, UpToDate) then
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

    local procedure HasDueLines(ContractNo: Code[20]; UpToDate: Date): Boolean
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        exit(not ScheduleLine.IsEmpty());
    end;

    [TryFunction]
    local procedure TryInvoiceLease(ContractNo: Code[20]; UpToDate: Date)
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        LeaseInvoicing.InvoiceDueLines(ContractNo, UpToDate);
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
