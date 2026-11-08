codeunit 70255 "CGR Return Desk"
{
    var
        OpenDamagesMsg: Label 'Vehicle %1 has %2 open damages. Inspect it before it is rented again.', Comment = '%1 = vehicle, %2 = number of damages';
        ChargeExcessQst: Label 'Charge %1 excess km?', Comment = '%1 = excess km';

    procedure BookReturn(ContractNo: Code[20]; ReturnKm: Integer)
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ExcessKm: Integer;
        DoCharge: Boolean;
    begin
        RentalMgt.Return(ContractNo, ReturnKm, '');
        Contract.Get(ContractNo);
        WarnOpenDamages(Contract."Vehicle No.");

        ExcessKm := (Contract."Return Km" - Contract."Start Km") - AllowedKm(Contract);
        if ExcessKm <= 0 then
            exit;
        if GuiAllowed() then
            DoCharge := Confirm(ChargeExcessQst, true, ExcessKm);
        if DoCharge then
            ChargeExcess(Contract, ExcessKm);
    end;

    local procedure WarnOpenDamages(VehicleNo: Code[20])
    var
        Damage: Record "CGR Damage Entry";
    begin
        Damage.SetRange("Vehicle No.", VehicleNo);
        Damage.SetRange(Repaired, false);
        if not Damage.IsEmpty() then
            Message(OpenDamagesMsg, VehicleNo, Damage.Count());
    end;

    local procedure AllowedKm(Contract: Record "CGR Rental Contract"): Integer
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        exit((Contract."End Date" - Contract."Start Date" + 1) * Setup."Km Allowance per Day");
    end;

    local procedure ChargeExcess(Contract: Record "CGR Rental Contract"; ExcessKm: Integer)
    var
        Setup: Record "CGR Setup";
        Charge: Record "CGR Return Excess Charge";
    begin
        Setup.GetOrCreate();
        Charge.Init();
        Charge."Contract No." := Contract."No.";
        Charge."Excess Km" := ExcessKm;
        Charge.Amount := Round(ExcessKm * Setup."Excess Km Rate", 0.01);
        Charge.Insert(true);
    end;
}
