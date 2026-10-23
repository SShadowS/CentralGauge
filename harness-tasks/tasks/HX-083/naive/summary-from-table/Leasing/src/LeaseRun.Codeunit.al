codeunit 70328 "CGR Lease Run"
{
    procedure RunLeaseSummary(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date; var RunLine: Record "CGR Lease Invoice Line" temporary): Integer
    var
        TempScratch: Record "CGR Lease Invoice Line" temporary;
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        Added: Integer;
    begin
        if LeaseFilter.FindSet() then
            repeat
                LeaseNos.Add(LeaseFilter."No.");
            until LeaseFilter.Next() = 0;

        foreach LeaseNo in LeaseNos do begin
            TempScratch.Reset();
            TempScratch.DeleteAll();
            TempScratch.Init();
            TempScratch."Contract No." := LeaseNo;
            TempScratch."Due Date" := UpToDate;
            Commit();
            if Codeunit.Run(Codeunit::"CGR Lease Run Unit", TempScratch) then begin
                InvoiceLine.SetRange("Contract No.", LeaseNo);
                if InvoiceLine.FindSet() then
                    repeat
                        RunLine := InvoiceLine;
                        RunLine.Insert();
                        Added += 1;
                    until InvoiceLine.Next() = 0;
            end;
        end;
        exit(Added);
    end;
}
