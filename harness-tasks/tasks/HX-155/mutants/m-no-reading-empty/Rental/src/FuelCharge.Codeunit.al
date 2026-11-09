codeunit 70275 "CGR Fuel Charge"
{
    var
        FuelLevelsTxt: Label 'Full,Three quarters,Half,Quarter,Empty';
        FuelQst: Label 'Fuel level at return:';
        NotReturnedErr: Label 'Rental contract %1 must be returned before fuel is charged.', Comment = '%1 = contract number';

    procedure ChargeFuel(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Choice: Integer;
        LevelPct: Integer;
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Returned then
            Error(NotReturnedErr, ContractNo);
        if AlreadyCharged(ContractNo) then
            exit;
        if GuiAllowed() then begin
            Choice := StrMenu(FuelLevelsTxt, 1, FuelQst);
            if Choice = 0 then
                exit;
            LevelPct := 100 - (Choice - 1) * 25;
        end else begin
            LevelPct := 0;
            OnGetFuelLevel(Contract."Vehicle No.", LevelPct);
        end;
        if LevelPct < 100 then
            WriteCharge(Contract, LevelPct);
    end;

    local procedure AlreadyCharged(ContractNo: Code[20]): Boolean
    var
        Entry: Record "CGR Fuel Charge Entry";
    begin
        Entry.SetRange("Contract No.", ContractNo);
        exit(not Entry.IsEmpty());
    end;

    local procedure WriteCharge(Contract: Record "CGR Rental Contract"; LevelPct: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        Entry: Record "CGR Fuel Charge Entry";
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Setup.GetOrCreate();
        Entry.Init();
        Entry."Contract No." := Contract."No.";
        Entry.Litres := Vehicle."Tank Litres" * (100 - LevelPct) / 100;
        Entry.Amount := Round(Entry.Litres * Setup."Fuel Price per Litre", 0.01);
        Entry.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnGetFuelLevel(VehicleNo: Code[20]; var LevelPct: Integer)
    begin
    end;
}
