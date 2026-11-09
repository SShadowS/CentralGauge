codeunit 70360 "CGR Lease Due Invoicing"
{
    TableNo = "CGR Lease Contract";

    var
        DueUpTo: Date;
        SummaryMsg: Label '%1 leases invoiced, %2 refused.', Comment = '%1, %2 = number of leases';

    trigger OnRun()
    var
        Line: Record "CGR Lease Schedule Line";
        LineRun: Codeunit "CGR Lease Due Line Run";
        LineNos: List of [Integer];
        LineNo: Integer;
    begin
        Line.SetRange("Contract No.", Rec."No.");
        Line.SetRange(Invoiced, false);
        Line.SetFilter("Due Date", '..%1', DueUpTo);
        if Line.FindSet() then
            repeat
                LineNos.Add(Line."Line No.");
            until Line.Next() = 0;
        foreach LineNo in LineNos do begin
            Line.Get(Rec."No.", LineNo);
            Clear(LineRun);
            LineRun.Run(Line);
        end;
    end;

    procedure InvoiceDue(AsOf: Date) Invoiced: Integer
    var
        Line: Record "CGR Lease Schedule Line";
        Lease: Record "CGR Lease Contract";
        LeaseRun: Codeunit "CGR Lease Due Invoicing";
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        Refused: Integer;
    begin
        AsOf := AsOf - 1;
        Line.SetRange(Invoiced, false);
        Line.SetFilter("Due Date", '..%1', AsOf);
        if Line.FindSet() then
            repeat
                if not LeaseNos.Contains(Line."Contract No.") then
                    LeaseNos.Add(Line."Contract No.");
            until Line.Next() = 0;
        foreach LeaseNo in LeaseNos do begin
            Lease.Get(LeaseNo);
            Commit();
            Clear(LeaseRun);
            LeaseRun.SetDueUpTo(AsOf);
            if LeaseRun.Run(Lease) then
                Invoiced += 1
            else
                Refused += 1;
        end;
        Commit();
        if GuiAllowed() then
            Message(SummaryMsg, Invoiced, Refused);
    end;

    procedure SetDueUpTo(AsOf: Date)
    begin
        DueUpTo := AsOf;
    end;
}
