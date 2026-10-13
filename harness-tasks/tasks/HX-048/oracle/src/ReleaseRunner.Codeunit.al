codeunit 86421 "HX048 Release Runner"
{
    trigger OnRun()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        FleetMgt.ReleaseVehicle('HX048-NONE', 10, 'Dent');
    end;
}
