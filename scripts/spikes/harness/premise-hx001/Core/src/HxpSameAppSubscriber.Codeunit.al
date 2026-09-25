// SPIKE (throwaway): harness bench M4-00 premise probe
codeunit 50103 "HXP Same App Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"HXP Events", 'OnDamageSameApp', '', false, false)]
    local procedure BlockVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "HXP Vehicle";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
