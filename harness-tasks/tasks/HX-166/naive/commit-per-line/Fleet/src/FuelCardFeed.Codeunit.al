codeunit 70188 "CGR Fuel Card Feed"
{
    procedure ImportFuelCardFile(EntryCodes: List of [Code[20]]; VehicleNos: List of [Code[20]]; AmountTexts: List of [Text]) Accepted: Integer
    var
        Worker: Codeunit "CGR Fuel Card Line Worker";
        LineIndex: Integer;
    begin
        for LineIndex := 1 to EntryCodes.Count() do begin
            Clear(Worker);
            Worker.SetLine(EntryCodes.Get(LineIndex), VehicleNos.Get(LineIndex), AmountTexts.Get(LineIndex));
            Commit();
            if Worker.Run() then
                Accepted += 1;
        end;
    end;
}
