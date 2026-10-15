codeunit 87101 "HX082 Import Runner"
{
    var
        HeldLine: Record "CGR Schedule Import Line";
        LeaseNo: Code[20];
        Imported: Integer;

    procedure HX82SetLease(NewLeaseNo: Code[20])
    begin
        LeaseNo := NewLeaseNo;
    end;

    procedure HX82AddLine(LineNo: Integer; DueDate: Date; LineAmount: Decimal)
    begin
        HeldLine.Init();
        HeldLine."Line No." := LineNo;
        HeldLine."Due Date" := DueDate;
        HeldLine.Amount := LineAmount;
        HeldLine.Insert();
    end;

    procedure HX82SetAmountFilter(FromAmount: Decimal; ToAmount: Decimal)
    begin
        HeldLine.SetRange(Amount, FromAmount, ToAmount);
    end;

    procedure HX82Imported(): Integer
    begin
        exit(Imported);
    end;

    procedure HX82HeldCount(): Integer
    var
        AllLines: Record "CGR Schedule Import Line";
    begin
        AllLines.Copy(HeldLine, true);
        AllLines.Reset();
        exit(AllLines.Count());
    end;

    procedure HX82HeldLine(LineNo: Integer; var DueDate: Date; var LineAmount: Decimal): Boolean
    var
        AllLines: Record "CGR Schedule Import Line";
    begin
        AllLines.Copy(HeldLine, true);
        AllLines.Reset();
        if not AllLines.Get(LineNo) then
            exit(false);
        DueDate := AllLines."Due Date";
        LineAmount := AllLines.Amount;
        exit(true);
    end;

    procedure HX82HeldFilters(): Text
    begin
        exit(HeldLine.GetFilters());
    end;

    trigger OnRun()
    var
        ScheduleImport: Codeunit "CGR Schedule Import";
    begin
        Imported := ScheduleImport.ImportSchedule(LeaseNo, HeldLine);
    end;
}
