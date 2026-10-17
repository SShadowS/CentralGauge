codeunit 70328 "CGR Lease Run"
{
    procedure RunLeaseSummary(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date; var RunLine: Record "CGR Lease Invoice Line" temporary): Integer
    var
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        RowsBefore: Integer;
    begin
        if LeaseFilter.FindSet() then
            repeat
                LeaseNos.Add(LeaseFilter."No.");
            until LeaseFilter.Next() = 0;

        RowsBefore := RunLine.Count();
        foreach LeaseNo in LeaseNos do begin
            RunLine.Init();
            RunLine."Contract No." := LeaseNo;
            RunLine."Due Date" := UpToDate;
            Commit();
            if Codeunit.Run(Codeunit::"CGR Lease Run Unit", RunLine) then;
        end;
        exit(RunLine.Count() - RowsBefore);
    end;
}
