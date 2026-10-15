codeunit 70123 "CGR Fleet Board"
{
    procedure SnapshotFreeVehicles(var Board: Record "CGR Vehicle" temporary): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Taken: Integer;
    begin
        Board.Reset();
        Board.DeleteAll();
        Vehicle.SetRange("Checked Out", false);
        Vehicle.SetRange(Blocked, false);
        if Vehicle.FindSet() then
            repeat
                Board := Vehicle;
                Board.Insert();
                Taken += 1;
            until Vehicle.Next() = 0;
        exit(Taken);
    end;

    procedure SnapshotDamagedVehicles(var Board: Record "CGR Vehicle" temporary): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Taken: Integer;
    begin
        Board.Reset();
        Board.DeleteAll();
        Vehicle.SetFilter("Open Damages", '>0');
        if Vehicle.FindSet() then
            repeat
                Board := Vehicle;
                Board.Insert();
                Taken += 1;
            until Vehicle.Next() = 0;
        exit(Taken);
    end;
}
