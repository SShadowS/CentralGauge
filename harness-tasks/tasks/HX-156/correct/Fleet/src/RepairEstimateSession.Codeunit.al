codeunit 70130 "CGR Repair Estimate Session"
{
    SingleInstance = true;

    var
        TempLine: Record "CGR Repair Estimate Line" temporary;
        LastEntryNo: Integer;

    procedure AddEstimateLine(VehicleNo: Code[20]; Description: Text[50]; Amount: Decimal): Integer
    var
        LineNo: Integer;
    begin
        TempLine.Reset();
        TempLine.SetRange("Vehicle No.", VehicleNo);
        if TempLine.FindLast() then
            LineNo := TempLine."Line No.";
        LineNo += 1;
        TempLine.Reset();
        LastEntryNo += 1;
        TempLine.Init();
        TempLine."Entry No." := LastEntryNo;
        TempLine."Vehicle No." := VehicleNo;
        TempLine."Line No." := LineNo;
        TempLine.Description := Description;
        TempLine.Amount := Amount;
        TempLine.Insert(true);
        exit(LineNo);
    end;

    procedure GetEstimateLines(var Lines: Record "CGR Repair Estimate Line" temporary)
    begin
        TempLine.Reset();
        Lines.Copy(TempLine, true);
    end;

    procedure Total(VehicleNo: Code[20]): Decimal
    begin
        exit(SumEstimateLines(TempLine, VehicleNo));
    end;

    procedure Apply(VehicleNo: Code[20]): Boolean
    var
        Vehicle: Record "CGR Vehicle";
        Applier: Codeunit "CGR Repair Estimate Apply";
    begin
        Vehicle.Get(VehicleNo);
        Applier.SetApplyVehicle(VehicleNo);
        TempLine.Reset();
        if not Applier.Run(TempLine) then
            exit(false);
        TempLine.Reset();
        TempLine.SetRange("Vehicle No.", VehicleNo);
        TempLine.DeleteAll();
        exit(true);
    end;

    procedure Reset()
    begin
        TempLine.Reset();
        TempLine.DeleteAll();
        LastEntryNo := 0;
    end;

    local procedure SumEstimateLines(var Lines: Record "CGR Repair Estimate Line" temporary; VehicleNo: Code[20]) Result: Decimal
    begin
        Lines.SetRange("Vehicle No.", VehicleNo);
        if Lines.FindSet() then
            repeat
                Result += Lines.Amount;
            until Lines.Next() = 0;
    end;
}
