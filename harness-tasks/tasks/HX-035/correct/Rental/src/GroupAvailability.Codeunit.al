codeunit 70220 "CGR Group Availability"
{
    procedure AvailableVehicles(CompanyName: Text[30]): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
    begin
        Setup.ChangeCompany(CompanyName);
        if Setup.Get() then
            if Setup."Suspend Rentals" then
                exit(0);
        Vehicle.ChangeCompany(CompanyName);
        Vehicle.SetRange("Checked Out", false);
        Vehicle.SetRange(Blocked, false);
        exit(Vehicle.Count());
    end;
}
