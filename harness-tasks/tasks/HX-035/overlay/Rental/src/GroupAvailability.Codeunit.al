codeunit 70220 "CGR Group Availability"
{
    procedure AvailableVehicles(CompanyName: Text[30]): Integer
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Available: Integer;
    begin
        Vehicle.ChangeCompany(CompanyName);
        if Vehicle.FindSet() then
            repeat
                if FleetMgt.IsAvailable(Vehicle."No.") then
                    Available += 1;
            until Vehicle.Next() = 0;
        exit(Available);
    end;
}
