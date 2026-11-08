codeunit 80597 "CGR Block Card Path Runner"
{
    var
        RunVehicleNo: Code[20];

    trigger OnRun()
    var
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        VehicleBlocking.BlockVehicle(RunVehicleNo, 'Brakes');
    end;

    procedure SetVehicle(VehicleNo: Code[20])
    begin
        RunVehicleNo := VehicleNo;
    end;
}
