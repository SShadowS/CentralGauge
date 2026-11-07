codeunit 70350 "CGR Lease Overnight Billing"
{
    TableNo = "CGR Lease Contract";

    trigger OnRun()
    begin
        BillOneLease(Rec);
    end;

    procedure BillLeasesOvernight(var LeaseFilter: Record "CGR Lease Contract"; var FailedLeases: List of [Code[20]]): Integer
    var
        Lease: Record "CGR Lease Contract";
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        Invoiced: Integer;
    begin
        Clear(FailedLeases);
        Lease.CopyFilters(LeaseFilter);
        if Lease.FindSet() then
            repeat
                LeaseNos.Add(Lease."No.");
            until Lease.Next() = 0;
        foreach LeaseNo in LeaseNos do begin
            Lease.Get(LeaseNo);
            Commit();
            if not Codeunit.Run(Codeunit::"CGR Lease Overnight Billing", Lease) then
                FailedLeases.Add(LeaseNo);
            Invoiced += 1;
        end;
        exit(Invoiced);
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure BillOneLease(var Lease: Record "CGR Lease Contract")
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        LeaseInvoicing.InvoiceDueLines(Lease."No.", WorkDate());
    end;
}
