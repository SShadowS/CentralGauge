codeunit 70100 "CGR Fleet Mgt"
{
    var
        VehicleExistsErr: Label 'Vehicle %1 already exists.', Comment = '%1 = vehicle number';

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

    procedure ChangeVehicleNo(OldNo: Code[20]; NewNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        CoreEvents: Codeunit "CGR Core Events";
    begin
        if NewVehicle.Get(NewNo) then
            Error(VehicleExistsErr, NewNo);
        Vehicle.Get(OldNo);
        NewVehicle.Init();
        NewVehicle.TransferFields(Vehicle);
        NewVehicle."No." := NewNo;
        NewVehicle.Insert();
        DamageEntry.SetRange("Vehicle No.", OldNo);
        DamageEntry.ModifyAll("Vehicle No.", NewNo);
        Vehicle.Delete();
        CoreEvents.RaiseVehicleNoChanged(OldNo, NewNo);
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
