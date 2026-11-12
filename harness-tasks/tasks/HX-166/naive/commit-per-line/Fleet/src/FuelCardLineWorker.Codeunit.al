codeunit 70189 "CGR Fuel Card Line Worker"
{
    var
        LineEntryCode: Code[20];
        LineVehicleNo: Code[20];
        LineAmountText: Text;
        UnknownVehicleErr: Label 'Vehicle %1 does not exist.', Comment = '%1 = vehicle number';
        BadAmountErr: Label 'Fuel card amount %1 cannot be read.', Comment = '%1 = amount text';

    procedure SetLine(EntryCode: Code[20]; VehicleNo: Code[20]; AmountText: Text)
    begin
        LineEntryCode := EntryCode;
        LineVehicleNo := VehicleNo;
        LineAmountText := AmountText;
    end;

    trigger OnRun()
    var
        FuelLine: Record "CGR Fuel Card Line";
        Vehicle: Record "CGR Vehicle";
        Amount: Decimal;
    begin
        if not Vehicle.Get(LineVehicleNo) then
            Error(UnknownVehicleErr, LineVehicleNo);
        if not Evaluate(Amount, LineAmountText) then
            Error(BadAmountErr, LineAmountText);
        if Amount < 0 then
            Error(BadAmountErr, LineAmountText);
        FuelLine.Init();
        FuelLine."Entry Code" := LineEntryCode;
        FuelLine."Vehicle No." := LineVehicleNo;
        FuelLine.Amount := Amount;
        FuelLine.Insert(true);
    end;
}
