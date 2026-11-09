codeunit 80592 "CGR Vehicle Blocking Runner"
{
    var
        RunVehicleNo: Code[20];
        RunReason: Text[100];

    trigger OnRun()
    var
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        VehicleBlocking.BlockVehicle(RunVehicleNo, RunReason);
    end;

    procedure SetBlockRun(VehicleNo: Code[20]; Reason: Text[100])
    begin
        RunVehicleNo := VehicleNo;
        RunReason := Reason;
    end;
}
