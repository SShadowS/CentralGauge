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

    procedure AuditVehicles(var Vehicle: Record "CGR Vehicle"; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary; var CheckErrors: Dictionary of [Code[20], Text])
    begin
        Finding.Reset();
        Finding.DeleteAll();
        Clear(CheckErrors);
        if Vehicle.FindSet() then
            repeat
                Finding.Init();
                Finding."Vehicle No." := Vehicle."No.";
                Finding."Audit Date" := AuditDate;
                if not Codeunit.Run(Codeunit::"CGR Vehicle Audit Check", Finding) then
                    CheckErrors.Set(Vehicle."No.", GetLastErrorText());
            until Vehicle.Next() = 0;
    end;
}
