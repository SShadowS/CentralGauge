codeunit 70220 "CGR Group Availability"
{
    procedure AvailableVehicles(CompanyName: Text[30]): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        Available: Integer;
    begin
        Setup.ChangeCompany(CompanyName);
        if Setup.Get() then
            if Setup."Suspend Rentals" then
                exit(0);
        Vehicle.ChangeCompany(CompanyName);
        if Vehicle.FindSet() then
            repeat
                if IsFree(Vehicle."No.") then
                    Available += 1;
            until Vehicle.Next() = 0;
        exit(Available);
    end;

    local procedure IsFree(VehicleNo: Code[20]): Boolean
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit(false);
        exit(not Vehicle."Checked Out" and not Vehicle.Blocked);
    end;
}
