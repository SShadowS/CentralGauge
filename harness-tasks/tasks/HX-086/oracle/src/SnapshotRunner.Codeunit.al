codeunit 87181 "HX086 Snapshot Runner"
{
    var
        Board: Record "CGR Vehicle" temporary;
        RunVehicleFilter: Text;
        TakenCount: Integer;

    trigger OnRun()
    var
        VehicleFilter: Record "CGR Vehicle";
        FleetBoard: Codeunit "CGR Fleet Board";
    begin
        VehicleFilter.SetFilter("No.", RunVehicleFilter);
        TakenCount := FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board);
    end;

    procedure HX86SetVehicleFilter(NewFilter: Text)
    begin
        RunVehicleFilter := NewFilter;
        TakenCount := -1;
    end;

    procedure HX86AddBoardRow(Row: Record "CGR Vehicle")
    begin
        Board := Row;
        Board.Insert();
    end;

    procedure HX86Taken(): Integer
    begin
        exit(TakenCount);
    end;

    procedure HX86BoardCount(): Integer
    begin
        Board.Reset();
        exit(Board.Count());
    end;

    procedure HX86GetBoardRow(VehicleNo: Code[20]; var Row: Record "CGR Vehicle"): Boolean
    begin
        Board.Reset();
        if not Board.Get(VehicleNo) then
            exit(false);
        Row := Board;
        exit(true);
    end;
}
