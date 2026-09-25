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
        if DamageDescription <> '' then
            DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        if DamageDescription <> '' then
            Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
