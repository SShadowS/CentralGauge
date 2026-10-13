codeunit 70218 "CGR Shift Returns"
{
    var
        Returned: List of [Code[20]];
        Damaged: List of [Code[20]];

    procedure ReturnedVehicles(var VehicleNos: List of [Code[20]])
    var
        VehicleNo: Code[20];
    begin
        Clear(VehicleNos);
        foreach VehicleNo in Returned do
            VehicleNos.Add(VehicleNo);
    end;

    procedure DamagedVehicles(var VehicleNos: List of [Code[20]])
    var
        VehicleNo: Code[20];
    begin
        Clear(VehicleNos);
        foreach VehicleNo in Damaged do
            VehicleNos.Add(VehicleNo);
    end;

    procedure ClearShift()
    begin
        Clear(Returned);
        Clear(Damaged);
    end;

    internal procedure RecordReturn(VehicleNo: Code[20]; DamageDescription: Text[100])
    begin
        if not Returned.Contains(VehicleNo) then
            Returned.Add(VehicleNo);
        if DamageDescription <> '' then
            if not Damaged.Contains(VehicleNo) then
                Damaged.Add(VehicleNo);
    end;
}
