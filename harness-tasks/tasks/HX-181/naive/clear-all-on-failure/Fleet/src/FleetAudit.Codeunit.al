codeunit 70128 "CGR Fleet Audit"
{
    procedure AuditVehicle(VehicleNo: Code[20]; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary)
    begin
        Finding.Reset();
        Finding.DeleteAll();
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding."Audit Date" := AuditDate;
        Codeunit.Run(Codeunit::"CGR Vehicle Audit Check", Finding);
    end;

    procedure AuditVehicles(var Vehicle: Record "CGR Vehicle"; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary)
    begin
        Finding.Reset();
        Finding.DeleteAll();
        if Vehicle.FindSet() then
            repeat
                Finding.Init();
                Finding."Vehicle No." := Vehicle."No.";
                Finding."Audit Date" := AuditDate;
                if not Codeunit.Run(Codeunit::"CGR Vehicle Audit Check", Finding) then
                    AddCheckFailedLine(Finding, Vehicle."No.", AuditDate, GetLastErrorText());
            until Vehicle.Next() = 0;
    end;

    local procedure AddCheckFailedLine(var Finding: Record "CGR Fleet Audit Finding" temporary; VehicleNo: Code[20]; AuditDate: Date; ErrorText: Text)
    begin
        Finding.Reset();
        Finding.DeleteAll();

        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding."Line No." := 0;
        Finding."Audit Date" := AuditDate;
        Finding.Finding := CopyStr(ErrorText, 1, MaxStrLen(Finding.Finding));
        Finding."Check Failed" := true;
        Finding.Insert();
    end;
}
