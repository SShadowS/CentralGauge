codeunit 70103 "CGR Fleet Return Handler"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure HandleVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        FleetMgt.ReleaseVehicle(VehicleNo, ReturnKm, DamageDescription);
    end;
}
