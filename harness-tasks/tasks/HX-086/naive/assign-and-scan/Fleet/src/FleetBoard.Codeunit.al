codeunit 70123 "CGR Fleet Board"
{
    procedure SnapshotFreeVehicles(var Board: Record "CGR Vehicle" temporary): Integer
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Board.Reset();
        Board.DeleteAll();
        Vehicle.SetRange("Checked Out", false);
        Vehicle.SetRange(Blocked, false);
        exit(TakeVehicleSnapshot(Vehicle, Board));
    end;

    procedure SnapshotDamagedVehicles(var Board: Record "CGR Vehicle" temporary): Integer
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Board.Reset();
        Board.DeleteAll();
        Vehicle.SetFilter("Open Damages", '>0');
        exit(TakeVehicleSnapshot(Vehicle, Board));
    end;

    procedure TakeVehicleSnapshot(var VehicleFilter: Record "CGR Vehicle"; var Board: Record "CGR Vehicle" temporary): Integer
    var
        Taken: Integer;
    begin
        Board := VehicleFilter;
        if Board.FindSet() then
            repeat
                Taken += 1;
            until Board.Next() = 0;
        exit(Taken);
    end;
}
