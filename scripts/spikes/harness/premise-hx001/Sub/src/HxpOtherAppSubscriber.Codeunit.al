// SPIKE (throwaway): harness bench M4-00 premise probe
codeunit 50150 "HXP Other App Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"HXP Events", 'OnDamageOtherApp', '', false, false)]
    local procedure BlockVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "HXP Vehicle";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"HXP Events", 'OnDamageByVar', '', false, false)]
    local procedure BlockPassedVehicle(var Vehicle: Record "HXP Vehicle")
    begin
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
