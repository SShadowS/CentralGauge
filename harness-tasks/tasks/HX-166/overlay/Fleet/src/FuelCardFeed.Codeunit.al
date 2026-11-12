codeunit 70188 "CGR Fuel Card Feed"
{
    var
        UnknownVehicleErr: Label 'Vehicle %1 does not exist.', Comment = '%1 = vehicle number';
        BadAmountErr: Label 'Fuel card amount %1 cannot be read.', Comment = '%1 = amount text';

    procedure ImportFuelCardFile(EntryCodes: List of [Code[20]]; VehicleNos: List of [Code[20]]; AmountTexts: List of [Text]) Accepted: Integer
    var
        LineIndex: Integer;
    begin
        for LineIndex := 1 to EntryCodes.Count() do
            if ImportFuelCardLine(EntryCodes.Get(LineIndex), VehicleNos.Get(LineIndex), AmountTexts.Get(LineIndex)) then
                Accepted += 1;
    end;

    local procedure ImportFuelCardLine(EntryCode: Code[20]; VehicleNo: Code[20]; AmountText: Text): Boolean
    begin
        ClearLastError();
        exit(TryStoreFuelCardLine(EntryCode, VehicleNo, AmountText));
    end;

    [TryFunction]
    local procedure TryStoreFuelCardLine(EntryCode: Code[20]; VehicleNo: Code[20]; AmountText: Text)
    var
        FuelLine: Record "CGR Fuel Card Line";
        Vehicle: Record "CGR Vehicle";
        Amount: Decimal;
    begin
        if not Vehicle.Get(VehicleNo) then
            Error(UnknownVehicleErr, VehicleNo);
        if not Evaluate(Amount, AmountText) then
            Error(BadAmountErr, AmountText);
        if Amount < 0 then
            Error(BadAmountErr, AmountText);
        FuelLine.Init();
        FuelLine."Entry Code" := EntryCode;
        FuelLine."Vehicle No." := VehicleNo;
        FuelLine.Amount := Amount;
        FuelLine.Insert(true);
    end;
}
