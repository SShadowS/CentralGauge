codeunit 70201 "CGR Rental Fleet Subscribers"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure SuspendRentals(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        if not SessionContext.RentalsSuspended() then
            exit;
        Result := false;
        IsHandled := true;
    end;
}
