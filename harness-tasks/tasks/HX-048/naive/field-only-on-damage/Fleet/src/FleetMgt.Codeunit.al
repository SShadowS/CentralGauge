codeunit 70100 "CGR Fleet Mgt"
{
    procedure IsAvailable(VehicleNo: Code[20]): Boolean
    var
        Vehicle: Record "CGR Vehicle";
        Result: Boolean;
        IsHandled: Boolean;
    begin
        OnBeforeIsAvailable(VehicleNo, Result, IsHandled);
        if IsHandled then
            exit(Result);
        if not Vehicle.Get(VehicleNo) then
            exit(false);
        exit(not Vehicle."Checked Out" and not Vehicle.Blocked);
    end;

    procedure NextServiceKm(VehicleNo: Code[20]): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Strategy: Interface "CGR Maintenance Strategy";
    begin
        Vehicle.Get(VehicleNo);
        Strategy := Vehicle.Strategy;
        exit(Strategy.NextServiceKm(Vehicle."Last Service Km"));
    end;

    procedure ReleaseVehicle(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        DamageEntryNo: Integer;
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        if DamageDescription <> '' then
            DamageEntryNo := DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
        Vehicle.Get(VehicleNo);
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        if DamageEntryNo <> 0 then
            Vehicle."Last Damage Entry No." := DamageEntryNo;
        Vehicle.Modify(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeIsAvailable(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    begin
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure MarkCheckedOut(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
    end;
}
