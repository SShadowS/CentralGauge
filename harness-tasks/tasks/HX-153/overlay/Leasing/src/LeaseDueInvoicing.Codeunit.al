codeunit 70360 "CGR Lease Due Invoicing"
{
    var
        SummaryMsg: Label '%1 leases invoiced, %2 refused.', Comment = '%1, %2 = number of leases';

    procedure InvoiceDue(AsOf: Date) Invoiced: Integer
    var
        Line: Record "CGR Lease Schedule Line";
        LineRun: Codeunit "CGR Lease Due Line Run";
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        LineNos: List of [Integer];
        LineNo: Integer;
        Refused: Integer;
        LeaseOk: Boolean;
    begin
        Line.SetRange(Invoiced, false);
        Line.SetFilter("Due Date", '..%1', AsOf);
        if Line.FindSet() then
            repeat
                if not LeaseNos.Contains(Line."Contract No.") then
                    LeaseNos.Add(Line."Contract No.");
            until Line.Next() = 0;
        foreach LeaseNo in LeaseNos do begin
            LeaseOk := true;
            Line.SetRange("Contract No.", LeaseNo);
            Clear(LineNos);
            if Line.FindSet() then
                repeat
                    LineNos.Add(Line."Line No.");
                until Line.Next() = 0;
            foreach LineNo in LineNos do begin
                Line.Get(LeaseNo, LineNo);
                Commit();
                Clear(LineRun);
                if not LineRun.Run(Line) then
                    LeaseOk := false;
            end;
            if LeaseOk then
                Invoiced += 1
            else
                Refused += 1;
        end;
        Commit();
        if GuiAllowed() then
            Message(SummaryMsg, Invoiced, Refused);
    end;
}
