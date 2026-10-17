codeunit 87122 "HX083 Run Runner"
{
    var
        HX083Held: Record "CGR Lease Invoice Line" temporary;
        HX083LeaseFilter: Text;
        HX083UpToDate: Date;
        HX083Added: Integer;

    trigger OnRun()
    var
        LeaseFilter: Record "CGR Lease Contract";
        LeaseRun: Codeunit "CGR Lease Run";
    begin
        LeaseFilter.SetFilter("No.", HX083LeaseFilter);
        HX083Added := LeaseRun.RunLeaseSummary(LeaseFilter, HX083UpToDate, HX083Held);
    end;

    procedure HX83SetRun(LeaseFilterText: Text; UpToDate: Date)
    begin
        HX083LeaseFilter := LeaseFilterText;
        HX083UpToDate := UpToDate;
        HX083Added := -1;
    end;

    procedure HX83Seed(Line: Record "CGR Lease Invoice Line")
    begin
        HX083Held := Line;
        HX083Held.Insert();
    end;

    procedure HX83Added(): Integer
    begin
        exit(HX083Added);
    end;

    procedure HX83RowCount(): Integer
    begin
        HX083Held.Reset();
        exit(HX083Held.Count());
    end;

    procedure HX83FindRow(LeaseNo: Code[20]; LineNo: Integer; var Line: Record "CGR Lease Invoice Line"): Boolean
    begin
        HX083Held.Reset();
        if not HX083Held.Get(LeaseNo, LineNo) then
            exit(false);
        Line := HX083Held;
        exit(true);
    end;
}
