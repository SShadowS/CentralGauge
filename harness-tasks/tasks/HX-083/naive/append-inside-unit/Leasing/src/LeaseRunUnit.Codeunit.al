codeunit 70329 "CGR Lease Run Unit"
{
    TableNo = "CGR Lease Invoice Line";

    trigger OnRun()
    var
        LeaseNo: Code[20];
        UpToDate: Date;
    begin
        LeaseNo := Rec."Contract No.";
        UpToDate := Rec."Due Date";
        InvoiceLease(Rec, LeaseNo, UpToDate);
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure InvoiceLease(var RunLine: Record "CGR Lease Invoice Line"; LeaseNo: Code[20]; UpToDate: Date)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        TempCollected: Record "CGR Lease Invoice Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LineNos: List of [Integer];
        DueDates: List of [Date];
        i: Integer;
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                LineNos.Add(ScheduleLine."Line No.");
                DueDates.Add(ScheduleLine."Due Date");
            until ScheduleLine.Next() = 0;

        for i := 1 to LineNos.Count() do begin
            LeaseInvoicing.InvoiceDueLines(LeaseNo, DueDates.Get(i));
            if InvoiceLine.Get(LeaseNo, LineNos.Get(i)) then begin
                TempCollected := InvoiceLine;
                TempCollected.Insert();
            end;
        end;

        if TempCollected.FindSet() then
            repeat
                RunLine := TempCollected;
                RunLine.Insert();
            until TempCollected.Next() = 0;

        OnAfterLeaseInvoiced(LeaseNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterLeaseInvoiced(LeaseNo: Code[20])
    begin
    end;
}
