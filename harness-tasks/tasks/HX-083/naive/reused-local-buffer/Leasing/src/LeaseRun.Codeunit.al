codeunit 70328 "CGR Lease Run"
{
    procedure RunLeaseSummary(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date; var RunLine: Record "CGR Lease Invoice Line" temporary): Integer
    var
        TempLeaseLine: Record "CGR Lease Invoice Line" temporary;
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        Added: Integer;
    begin
        if LeaseFilter.FindSet() then
            repeat
                LeaseNos.Add(LeaseFilter."No.");
            until LeaseFilter.Next() = 0;

        foreach LeaseNo in LeaseNos do begin
            TempLeaseLine.Init();
            TempLeaseLine."Contract No." := LeaseNo;
            TempLeaseLine."Due Date" := UpToDate;
            Commit();
            if Codeunit.Run(Codeunit::"CGR Lease Run Unit", TempLeaseLine) then begin
                TempLeaseLine.Reset();
                if TempLeaseLine.FindSet() then
                    repeat
                        RunLine := TempLeaseLine;
                        RunLine.Insert();
                        Added += 1;
                    until TempLeaseLine.Next() = 0;
                TempLeaseLine.DeleteAll();
            end;
        end;
        exit(Added);
    end;
}
