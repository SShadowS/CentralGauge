codeunit 70103 "CGR Fleet Return Handler"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure HandleVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        if DamageDescription <> '' then begin
            DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
            exit;
        end;
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        Vehicle.Modify(true);
    end;
}
