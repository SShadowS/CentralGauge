codeunit 70312 "CGR Lease Batch Invoicing"
{
    var
        RunId: Guid;

    procedure InvoiceDueLeases(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        Invoiced: Integer;
    begin
        RunId := CreateGuid();
        Contract.CopyFilters(LeaseFilter);
        if Contract.FindSet() then
            repeat
                if LeaseInvoicing.InvoiceDueLines(Contract."No.", UpToDate) > 0 then
                    Invoiced += 1;
            until Contract.Next() = 0;
        exit(Invoiced);
    end;

    procedure LastRunId(): Guid
    begin
        exit(RunId);
    end;
}
