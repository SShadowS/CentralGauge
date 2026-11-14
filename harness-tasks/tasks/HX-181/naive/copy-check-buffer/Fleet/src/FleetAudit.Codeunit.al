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
    var
        VehicleFinding: Record "CGR Fleet Audit Finding" temporary;
    begin
        Finding.Reset();
        Finding.DeleteAll();
        Clear(CheckErrors);
        if Vehicle.FindSet() then
            repeat
                VehicleFinding.Reset();
                VehicleFinding.DeleteAll();
                VehicleFinding.Init();
                VehicleFinding."Vehicle No." := Vehicle."No.";
                VehicleFinding."Audit Date" := AuditDate;
                if not Codeunit.Run(Codeunit::"CGR Vehicle Audit Check", VehicleFinding) then
                    CheckErrors.Set(Vehicle."No.", GetLastErrorText());
                VehicleFinding.Reset();
                if VehicleFinding.FindSet() then
                    repeat
                        Finding := VehicleFinding;
                        Finding.Insert();
                    until VehicleFinding.Next() = 0;
            until Vehicle.Next() = 0;
    end;
}
