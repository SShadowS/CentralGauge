codeunit 70328 "CGR Lease Run"
{
    procedure RunLeaseSummary(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date; var RunLine: Record "CGR Lease Invoice Line" temporary): Integer
    var
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        RowsBefore: Integer;
        Added: Integer;
    begin
        if LeaseFilter.FindSet() then
            repeat
                LeaseNos.Add(LeaseFilter."No.");
            until LeaseFilter.Next() = 0;

        foreach LeaseNo in LeaseNos do begin
            RowsBefore := RunLine.Count();
            RunLine.Init();
            RunLine."Contract No." := LeaseNo;
            RunLine."Due Date" := UpToDate;
            Commit();
            if Codeunit.Run(Codeunit::"CGR Lease Run Unit", RunLine) then
                Added += RunLine.Count() - RowsBefore
            else begin
                RunLine.SetRange("Contract No.", LeaseNo);
                RunLine.DeleteAll();
                RunLine.SetRange("Contract No.");
            end;
        end;
        exit(Added);
    end;
}
