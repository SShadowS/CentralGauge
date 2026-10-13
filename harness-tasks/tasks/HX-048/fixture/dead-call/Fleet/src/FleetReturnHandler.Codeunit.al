codeunit 70103 "CGR Fleet Return Handler"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure HandleVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        DamageEntryNo: Integer;
    begin
        if ReturnKm < 0 then begin
            FleetMgt.ReleaseVehicle(VehicleNo, ReturnKm, DamageDescription);
            exit;
        end;
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        Vehicle.Modify(true);
        if DamageDescription <> '' then
            DamageEntryNo := DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
        Vehicle.Get(VehicleNo);
        Vehicle."Last Damage Entry No." := DamageEntryNo;
        Vehicle.Modify(true);
    end;
}
