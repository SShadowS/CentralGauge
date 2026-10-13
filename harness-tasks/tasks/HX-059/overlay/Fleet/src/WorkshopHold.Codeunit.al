codeunit 70117 "CGR Workshop Hold"
{
    SingleInstance = true;
    EventSubscriberInstance = Manual;

    var
        HeldVehicles: List of [Code[20]];

    procedure HoldVehicles(VehicleNos: List of [Code[20]])
    var
        VehicleNo: Code[20];
    begin
        foreach VehicleNo in VehicleNos do
            if not HeldVehicles.Contains(VehicleNo) then
                HeldVehicles.Add(VehicleNo);
    end;

    procedure ReleaseAll()
    begin
        Clear(HeldVehicles);
    end;

    procedure IsHeld(VehicleNo: Code[20]): Boolean
    begin
        exit(HeldVehicles.Contains(VehicleNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure KeepHeldVehicleFromDesk(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    begin
        if not IsHeld(VehicleNo) then
            exit;
        Result := false;
        IsHandled := true;
    end;
}
