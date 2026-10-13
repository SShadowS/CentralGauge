codeunit 70227 "CGR Inspection Lending"
{
    SingleInstance = true;
    EventSubscriberInstance = Manual;

    var
        LentVehicles: List of [Code[20]];
        Running: Boolean;

    procedure SetVehicles(VehicleNos: List of [Code[20]])
    var
        VehicleNo: Code[20];
    begin
        Clear(LentVehicles);
        foreach VehicleNo in VehicleNos do
            if not LentVehicles.Contains(VehicleNo) then
                LentVehicles.Add(VehicleNo);
        Running := true;
    end;

    procedure StopLending()
    begin
        Clear(LentVehicles);
        Running := false;
    end;

    procedure IsRunning(): Boolean
    begin
        exit(Running);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure LendListedVehicle(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not LentVehicles.Contains(VehicleNo) then
            exit;
        Result := Vehicle.Get(VehicleNo) and not Vehicle."Checked Out";
        IsHandled := true;
    end;
}
