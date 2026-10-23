codeunit 86941 "HX074 Lending Partner"
{
    EventSubscriberInstance = Manual;

    var
        LentVehicleNo: Code[20];
        LentAvailable: Boolean;

    procedure HX74Decide(VehicleNo: Code[20]; IsVehicleAvailable: Boolean)
    begin
        LentVehicleNo := VehicleNo;
        LentAvailable := IsVehicleAvailable;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure HX74DecideAvailability(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    begin
        if (LentVehicleNo = '') or (VehicleNo <> LentVehicleNo) then
            exit;
        Result := LentAvailable;
        IsHandled := true;
    end;
}
