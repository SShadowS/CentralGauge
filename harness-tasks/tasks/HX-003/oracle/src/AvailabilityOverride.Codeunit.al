codeunit 85201 "HX3 Availability Override"
{
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure ForceAvailable(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    begin
        Result := true;
        IsHandled := true;
    end;
}
